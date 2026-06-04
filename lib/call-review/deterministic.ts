import type {
  DeterministicFinding,
  NormalizedReviewInput,
  NormalizedReviewToolEvent,
  ReviewEvidence,
  Severity,
} from "@/lib/call-review/types";
import { isSuccessfulToolAction } from "@/lib/tool-action-status";

const PRACTICE_FACT_PATTERN =
  /\b(address|located|location|hours|open|closed|fax|provider|doctor|dr\.|what to bring|parking)\b/i;
const BOOKED_PATTERN =
  /\b(you(?:'re| are) (?:booked|scheduled|all set)|appointment (?:is|has been) (?:booked|scheduled|set)|i (?:booked|scheduled) (?:that|the appointment))\b/i;
const CANCELLED_PATTERN =
  /\b(you(?:'re| are) (?:cancelled|canceled)|appointment (?:is|was|has been) (?:cancelled|canceled)|(?:cancelled|canceled) your appointment)\b/i;
const RESCHEDULED_PATTERN =
  /\b(you(?:'re| are) rescheduled|appointment (?:is|has been) rescheduled|moved your appointment|changed your appointment)\b/i;
const APPOINTMENT_DETAIL_PATTERN =
  /\b(appointment|scheduled|with dr\.|with doctor|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|(?:[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:am|pm|a\.m\.|p\.m\.))\b/i;
const AVAILABILITY_PATTERN =
  /\b(available|opening|slot|we have|i have|there is|there's)\b.*\b(?:[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:am|pm|a\.m\.|p\.m\.)\b/i;
const INSURANCE_CLAIM_PATTERN =
  /\b(we (?:do )?(?:accept|take)|yes,? we (?:accept|take)|accepted|in network|in-network|covered|takes your insurance)\b/i;
const INSURANCE_CONTEXT_PATTERN =
  /\b(insurance|plan|member id|policy|subscriber|aetna|bcbs|blue cross|cigna|humana|medicare|medicaid|united|uhc|vsp|eyemed)\b/i;
const INSURANCE_UPDATE_INTENT_PATTERN =
  /\b(update|change|replace|new|different|add)\b.*\b(insurance|plan|policy|member|subscriber)\b|\b(insurance|plan|policy|member|subscriber)\b.*\b(update|change|replace|new|different|add)\b/i;
const CLOSING_PATTERN = /\b(all set|have a good|take care|sounds good|perfect)\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assistantTurns(input: NormalizedReviewInput) {
  return input.transcript.filter((turn) => turn.role === "assistant" && turn.text);
}

function userText(input: NormalizedReviewInput) {
  return input.transcript
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.text)
    .join(" ");
}

function hasSuccessfulTool(input: NormalizedReviewInput, name: string) {
  if (
    input.toolEvents.some(
      (tool) =>
        tool.name === name &&
        !tool.isError &&
        (name === "book_appt" || name === "reschedule_appt"
          ? isSuccessfulToolAction(tool)
          : true),
    )
  ) {
    return true;
  }

  return input.toolExecutions.some(
    (tool) => tool.toolName === name && tool.status === "success",
  );
}

function hasAnySuccessfulTool(input: NormalizedReviewInput, names: string[]) {
  return names.some((name) => hasSuccessfulTool(input, name));
}

function repeatedToolArgs(input: NormalizedReviewInput) {
  const seen = new Set<string>();

  for (const tool of input.toolEvents) {
    const key = `${tool.name}:${JSON.stringify(tool.args)}`;
    if (seen.has(key)) {
      return tool;
    }
    seen.add(key);
  }

  return null;
}

function resultRecord(tool: NormalizedReviewToolEvent) {
  return isRecord(tool.result) ? tool.result : null;
}

function firstAppointmentResult(tool: NormalizedReviewToolEvent) {
  const result = resultRecord(tool);
  const appointments = Array.isArray(result?.appointments) ? result.appointments : [];
  return appointments.find(isRecord) ?? null;
}

function conflictsWithConfirmResult(input: NormalizedReviewInput) {
  for (const tool of input.toolEvents) {
    if (tool.name !== "confirm_appt" || tool.isError) continue;

    const appointment = firstAppointmentResult(tool);
    if (!appointment) continue;

    const confirmed = appointment.confirmed;
    const facility =
      typeof appointment.facility === "string" ? appointment.facility.toLowerCase() : "";
    const sameTurnText = assistantTurns(input)
      .filter((turn) => turn.turn >= tool.turn && turn.turn <= tool.turn + 1)
      .map((turn) => turn.text.toLowerCase())
      .join(" ");

    if (confirmed === false && /\b(confirmed|all set)\b/i.test(sameTurnText)) {
      return {
        evidence: {
          quote: sameTurnText,
          toolName: "confirm_appt",
          turns: [tool.turn],
        },
        title: "Agent claimed confirmation even though confirm_appt did not confirm it",
      };
    }

    if (facility && sameTurnText && !sameTurnText.includes(facility)) {
      return {
        evidence: {
          quote: sameTurnText,
          toolName: "confirm_appt",
          turns: [tool.turn],
        },
        title: "Agent's spoken appointment details may conflict with confirm_appt output",
      };
    }
  }

  return null;
}

function successClaimAfterToolError(input: NormalizedReviewInput) {
  for (const tool of input.toolEvents) {
    if (!tool.isError) continue;

    const laterText = assistantTurns(input)
      .filter((turn) => turn.turn >= tool.turn)
      .map((turn) => turn.text)
      .join(" ");

    const claimedSuccess =
      (tool.name === "book_appt" && BOOKED_PATTERN.test(laterText)) ||
      (tool.name === "cancel_appt" && CANCELLED_PATTERN.test(laterText)) ||
      (tool.name === "reschedule_appt" && RESCHEDULED_PATTERN.test(laterText)) ||
      (tool.name === "confirm_appt" && /\b(confirmed|all set)\b/i.test(laterText));

    if (claimedSuccess) {
      return {
        evidence: {
          quote: laterText,
          toolName: tool.name,
          turns: [tool.turn],
        },
        title: "Agent made a success claim after a tool error",
      };
    }
  }

  return null;
}

function addFinding(
  findings: DeterministicFinding[],
  input: Omit<DeterministicFinding, "evidence"> & {
    evidence?: ReviewEvidence;
  },
) {
  if (findings.some((finding) => finding.flag === input.flag)) {
    return;
  }

  findings.push({
    evidence: input.evidence ?? { quote: null, toolName: null, turns: null },
    flag: input.flag,
    severity: input.severity,
    title: input.title,
  });
}

function firstAssistantMatch(
  input: NormalizedReviewInput,
  pattern: RegExp,
): { quote: string; turns: number[] } | null {
  const matched = assistantTurns(input).find((turn) => pattern.test(turn.text));
  return matched ? { quote: matched.text, turns: [matched.turn] } : null;
}

export function deriveDeterministicFindings(
  input: NormalizedReviewInput,
): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];
  const assistantText = assistantTurns(input)
    .map((turn) => turn.text)
    .join(" ");
  const callerText = userText(input);
  const hadGroundedAppointmentContext =
    input.callerContext.hadPreloadedAppointments ||
    hasAnySuccessfulTool(input, ["confirm_appt", "book_appt", "reschedule_appt"]);

  if (
    PRACTICE_FACT_PATTERN.test(assistantText) &&
    !hasSuccessfulTool(input, "lookup_knowledge")
  ) {
    const match = firstAssistantMatch(input, PRACTICE_FACT_PATTERN);
    addFinding(findings, {
      evidence: {
        quote: match?.quote ?? null,
        toolName: "lookup_knowledge",
        turns: match?.turns ?? null,
      },
      flag: "practice_fact_without_lookup_knowledge",
      severity: "medium",
      title: "Practice-specific fact was spoken without a knowledge lookup",
    });
  }

  const confirmConflict = conflictsWithConfirmResult(input);
  if (confirmConflict) {
    addFinding(findings, {
      evidence: confirmConflict.evidence,
      flag: "spoken_claim_conflicts_with_tool_output",
      severity: "high",
      title: confirmConflict.title,
    });
  }

  const bookedMatch = firstAssistantMatch(input, BOOKED_PATTERN);
  if (
    bookedMatch &&
    !input.summarySignals.bookedAppointment &&
    !hasAnySuccessfulTool(input, ["book_appt", "reschedule_appt"])
  ) {
    addFinding(findings, {
      evidence: {
        quote: bookedMatch.quote,
        toolName: "book_appt",
        turns: bookedMatch.turns,
      },
      flag: "book_claim_without_book_appt",
      severity: "high",
      title: "Agent claimed an appointment was booked without a successful booking tool",
    });
  }

  const cancelledMatch = firstAssistantMatch(input, CANCELLED_PATTERN);
  if (
    cancelledMatch &&
    !input.summarySignals.cancelledAppointment &&
    !hasSuccessfulTool(input, "cancel_appt") &&
    !hasSuccessfulTool(input, "reschedule_appt")
  ) {
    addFinding(findings, {
      evidence: {
        quote: cancelledMatch.quote,
        toolName: "cancel_appt",
        turns: cancelledMatch.turns,
      },
      flag: "cancel_claim_without_cancel_appt",
      severity: "high",
      title:
        "Agent claimed an appointment was cancelled without a successful cancel tool",
    });
  }

  const rescheduledMatch = firstAssistantMatch(input, RESCHEDULED_PATTERN);
  if (rescheduledMatch && !hasSuccessfulTool(input, "reschedule_appt")) {
    addFinding(findings, {
      evidence: {
        quote: rescheduledMatch.quote,
        toolName: "reschedule_appt",
        turns: rescheduledMatch.turns,
      },
      flag: "reschedule_claim_without_reschedule_appt",
      severity: "high",
      title:
        "Agent claimed an appointment was rescheduled without a successful reschedule tool",
    });
  }

  const appointmentDetails = firstAssistantMatch(input, APPOINTMENT_DETAIL_PATTERN);
  if (appointmentDetails && !hadGroundedAppointmentContext) {
    addFinding(findings, {
      evidence: {
        quote: appointmentDetails.quote,
        toolName: "confirm_appt",
        turns: appointmentDetails.turns,
      },
      flag: "confirm_details_without_confirm_appt_or_context",
      severity: "medium",
      title:
        "Appointment details were spoken without confirm/book tool output or preload",
    });
  }

  const availabilityClaim = firstAssistantMatch(input, AVAILABILITY_PATTERN);
  if (
    availabilityClaim &&
    !hasAnySuccessfulTool(input, ["get_availability", "book_appt", "reschedule_appt"])
  ) {
    addFinding(findings, {
      evidence: {
        quote: availabilityClaim.quote,
        toolName: "get_availability",
        turns: availabilityClaim.turns,
      },
      flag: "availability_claim_without_get_availability",
      severity: "medium",
      title: "Specific availability was spoken without availability or booking output",
    });
  }

  const insuranceClaim = firstAssistantMatch(input, INSURANCE_CLAIM_PATTERN);
  if (
    insuranceClaim &&
    INSURANCE_CONTEXT_PATTERN.test(`${callerText} ${assistantText}`) &&
    !hasSuccessfulTool(input, "check_insurance")
  ) {
    addFinding(findings, {
      evidence: {
        quote: insuranceClaim.quote,
        toolName: "check_insurance",
        turns: insuranceClaim.turns,
      },
      flag: "insurance_claim_without_check_insurance",
      severity: "high",
      title: "Agent made an insurance acceptance claim without check_insurance",
    });
  }

  if (
    hasSuccessfulTool(input, "update_insurance") &&
    !INSURANCE_UPDATE_INTENT_PATTERN.test(callerText)
  ) {
    const tool = input.toolEvents.find((event) => event.name === "update_insurance");
    addFinding(findings, {
      evidence: {
        quote: callerText || null,
        toolName: "update_insurance",
        turns: tool ? [tool.turn] : null,
      },
      flag: "update_insurance_without_explicit_change_intent",
      severity: "high",
      title: "update_insurance ran without clear caller intent to change insurance",
    });
  }

  const errorClaim = successClaimAfterToolError(input);
  if (errorClaim) {
    addFinding(findings, {
      evidence: errorClaim.evidence,
      flag: "tool_error_followed_by_success_claim",
      severity: "high",
      title: errorClaim.title,
    });
  }

  const duplicate = repeatedToolArgs(input);
  if (duplicate) {
    addFinding(findings, {
      evidence: {
        quote: null,
        toolName: duplicate.name,
        turns: [duplicate.turn],
      },
      flag: "redundant_same_tool_same_args",
      severity: "low",
      title: "Same tool was called more than once with the same arguments",
    });
  }

  if (
    input.metrics.interruptions > 0 &&
    assistantTurns(input).some((turn) => CLOSING_PATTERN.test(turn.text))
  ) {
    const match = firstAssistantMatch(input, CLOSING_PATTERN);
    addFinding(findings, {
      evidence: {
        quote: match?.quote ?? null,
        toolName: null,
        turns: match?.turns ?? null,
      },
      flag: "premature_close_after_interrupt",
      severity: "low",
      title: "Call may have closed soon after an interruption",
    });
  }

  if (input.metrics.runtimeErrors > 0) {
    addFinding(findings, {
      evidence: {
        quote: JSON.stringify(input.runtimeSignals.errors.slice(0, 2)),
        toolName: null,
        turns: null,
      },
      flag: "runtime_error",
      severity: "high",
      title: "Runtime reported one or more errors during the call",
    });
  }

  if (input.metrics.fallbackUsed) {
    addFinding(findings, {
      evidence: {
        quote: null,
        toolName: null,
        turns: null,
      },
      flag: "fallback_model_used",
      severity: "low",
      title: "Fallback model was used during the call",
    });
  }

  return findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(severity: Severity) {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}
