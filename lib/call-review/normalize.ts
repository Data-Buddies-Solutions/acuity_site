import type {
  DeterministicFinding,
  NormalizedReviewInput,
  NormalizedReviewToolEvent,
  NormalizedReviewToolExecution,
  NormalizedReviewTranscriptTurn,
} from "@/lib/call-review/types";

const MAX_TEXT_LENGTH = 1200;
const MAX_TRANSCRIPT_ITEMS = 120;
const MAX_TOOL_EVENTS = 100;
const MAX_TOOL_EXECUTIONS = 120;

export type AgentCallReviewSource = {
  id: string;
  callId: string;
  callerPhone: string;
  officePhone: string;
  status: string;
  startedAt: Date | string;
  endedAt: Date | string | null;
  durationSec: number;
  bookedAppointment: boolean;
  cancelledAppointment: boolean;
  confirmedAppointment: boolean;
  transferred: boolean;
  fallbackUsed: boolean;
  interruptionCount: number;
  toolCalls: number;
  toolErrors: number;
  totalTurns: number;
  data: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function limitText(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > MAX_TEXT_LENGTH
    ? `${text.slice(0, MAX_TEXT_LENGTH).trim()} [TRUNCATED]`
    : text;
}

export function redactTextForReview(value: string) {
  return limitText(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .replace(
      /(?<!\d)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/g,
      "[PHONE]",
    )
    .replace(
      /\b(?:date of birth|dob|birth date)\s*(?:is|:)?\s*(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|[a-z]+ \d{1,2},? \d{4})/gi,
      "[DOB]",
    )
    .replace(
      /\b(?:member|subscriber|policy)\s*(?:id|number|#)?\s*(?:is|:)?\s*[a-z0-9-]{4,24}/gi,
      "[MEMBER_ID]",
    );
}

function redactForReview(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return redactTextForReview(value);
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === undefined
  ) {
    return value ?? null;
  }

  if (depth >= 4) {
    return "[TRUNCATED]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => redactForReview(item, depth + 1));
  }

  if (!isRecord(value)) {
    return null;
  }

  const output: Record<string, unknown> = {};
  const entries = Object.entries(value).slice(0, 40);
  for (const [key, child] of entries) {
    if (/audio|audioBase64|audioData|recording|blob/i.test(key)) {
      continue;
    }
    output[key] = redactForReview(child, depth + 1);
  }

  return output;
}

function parseMaybeJson(value: unknown) {
  if (isRecord(value) || Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return value ?? null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function contentText(content: unknown) {
  return asArray(content)
    .map((item) => {
      if (typeof item === "string") return item;
      if (isRecord(item)) {
        return asString(item.transcript) ?? asString(item.text) ?? "";
      }
      return "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function createdAtValue(value: unknown) {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

function isoString(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

function sessionItems(data: unknown) {
  const report = asRecord(asRecord(data)?.sessionReport);
  const history = asRecord(report?.chat_history);
  return asArray(history?.items).filter(isRecord);
}

function normalizeTranscriptFromSession(data: unknown): NormalizedReviewTranscriptTurn[] {
  const transcript: NormalizedReviewTranscriptTurn[] = [];
  let turn = 0;

  for (const item of sessionItems(data)) {
    if (item.type !== "message" || (item.role !== "user" && item.role !== "assistant")) {
      continue;
    }

    const text = contentText(item.content);
    if (!text) continue;

    if (item.role === "user") {
      turn += 1;
    }

    transcript.push({
      createdAt: createdAtValue(item.createdAt),
      role: item.role,
      text: redactTextForReview(text),
      turn: Math.max(turn, 1),
    });
  }

  return transcript.slice(0, MAX_TRANSCRIPT_ITEMS);
}

function normalizeTranscriptFromTurns(data: unknown): NormalizedReviewTranscriptTurn[] {
  const transcript: NormalizedReviewTranscriptTurn[] = [];
  const turns = asArray(asRecord(data)?.turns).filter(isRecord);

  turns.forEach((turnRecord, index) => {
    const turn = Math.max(1, Math.round(asNumber(turnRecord.turn, index + 1)));
    const callerText = asString(turnRecord.callerText);
    const agentText = asString(turnRecord.agentText);

    if (callerText) {
      transcript.push({
        createdAt: createdAtValue(turnRecord.createdAt),
        role: "user",
        text: redactTextForReview(callerText),
        turn,
      });
    }

    if (agentText) {
      transcript.push({
        createdAt: createdAtValue(turnRecord.createdAt),
        role: "assistant",
        text: redactTextForReview(agentText),
        turn,
      });
    }
  });

  return transcript.slice(0, MAX_TRANSCRIPT_ITEMS);
}

function normalizeToolEventsFromTurns(data: unknown): NormalizedReviewToolEvent[] {
  const toolEvents: NormalizedReviewToolEvent[] = [];
  const turns = asArray(asRecord(data)?.turns).filter(isRecord);

  turns.forEach((turnRecord, index) => {
    const turn = Math.max(1, Math.round(asNumber(turnRecord.turn, index + 1)));
    for (const tool of asArray(turnRecord.toolCalls).filter(isRecord)) {
      const name = asString(tool.name) ?? "unknown";
      toolEvents.push({
        args: redactForReview(parseMaybeJson(tool.args)),
        createdAt: createdAtValue(tool.createdAt),
        isError: tool.isError === true,
        name,
        result: redactForReview(parseMaybeJson(tool.result)),
        turn,
      });
    }
  });

  return toolEvents.slice(0, MAX_TOOL_EVENTS);
}

function normalizeToolEventsFromSession(data: unknown): NormalizedReviewToolEvent[] {
  const items = sessionItems(data);
  const outputs = new Map<string, Record<string, unknown>>();
  const toolEvents: NormalizedReviewToolEvent[] = [];
  let turn = 0;

  for (const item of items) {
    if (item.type === "message" && item.role === "user") {
      turn += 1;
    }

    if (item.type === "function_call_output" && typeof item.callId === "string") {
      outputs.set(item.callId, item);
    }
  }

  turn = 0;
  for (const item of items) {
    if (item.type === "message" && item.role === "user") {
      turn += 1;
    }

    if (item.type !== "function_call") {
      continue;
    }

    const callId = asString(item.callId);
    const output = callId ? outputs.get(callId) : null;
    toolEvents.push({
      args: redactForReview(parseMaybeJson(item.args)),
      createdAt: createdAtValue(item.createdAt),
      isError: output?.isError === true,
      name: asString(item.name) ?? "unknown",
      result: redactForReview(parseMaybeJson(output?.output)),
      turn: Math.max(turn, 1),
    });
  }

  return toolEvents.slice(0, MAX_TOOL_EVENTS);
}

function normalizeToolExecutions(data: unknown): NormalizedReviewToolExecution[] {
  return asArray(asRecord(data)?.toolExecutions)
    .filter(isRecord)
    .map((item) => {
      const status: NormalizedReviewToolExecution["status"] =
        item.status === "success" || item.status === "error" ? item.status : "unknown";

      return {
        createdAt: asString(item.createdAt),
        outputClass: asString(item.outputClass),
        status,
        toolName: asString(item.toolName) ?? "unknown",
      };
    })
    .slice(0, MAX_TOOL_EXECUTIONS);
}

function candidateAppointmentArrays(data: unknown) {
  const record = asRecord(data) ?? {};
  const callState = asRecord(record.callState);
  const patientState = asRecord(callState?.patient);
  const sessionReport = asRecord(record.sessionReport);

  return [
    asRecord(record.phoneLookup)?.appointments,
    asRecord(record.preCallContext)?.appointments,
    asRecord(record.callerContext)?.appointments,
    record.preloadedAppointments,
    asRecord(record.context)?.appointments,
    asRecord(sessionReport?.preCallContext)?.appointments,
    callState?.appointments,
    callState?.loadedAppointments,
    patientState?.appointments,
  ];
}

function normalizeAppointment(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;

  const normalized = {
    date:
      asString(record.date) ??
      asString(record.appointmentDate) ??
      asString(record.startDate) ??
      asString(record.start),
    facility:
      asString(record.facility) ?? asString(record.location) ?? asString(record.office),
    provider:
      asString(record.provider) ??
      asString(record.providerName) ??
      asString(record.doctor),
    time:
      asString(record.time) ??
      asString(record.appointmentTime) ??
      asString(record.startTime),
  };

  if (
    !normalized.date &&
    !normalized.time &&
    !normalized.provider &&
    !normalized.facility
  ) {
    return null;
  }

  return {
    date: normalized.date ? redactTextForReview(normalized.date) : null,
    facility: normalized.facility ? redactTextForReview(normalized.facility) : null,
    provider: normalized.provider ? redactTextForReview(normalized.provider) : null,
    time: normalized.time ? redactTextForReview(normalized.time) : null,
  };
}

function extractPreloadedAppointments(data: unknown) {
  const seen = new Set<string>();
  const appointments = candidateAppointmentArrays(data)
    .flatMap((value) => asArray(value))
    .map(normalizeAppointment)
    .filter(
      (
        item,
      ): item is {
        date: string | null;
        facility: string | null;
        provider: string | null;
        time: string | null;
      } => Boolean(item),
    )
    .filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return appointments.slice(0, 8);
}

function phoneLookupStatus(data: unknown, hadPreloadedAppointments: boolean) {
  const record = asRecord(data) ?? {};
  const candidates = [
    asString(asRecord(record.phoneLookup)?.status),
    asString(asRecord(record.preCallContext)?.phoneLookupStatus),
    asString(asRecord(record.callerContext)?.phoneLookupStatus),
    asString(record.phoneLookupStatus),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  if (
    candidates.some((value) =>
      ["verified", "matched", "single_match", "confirmed"].includes(value),
    ) ||
    hadPreloadedAppointments
  ) {
    return "verified";
  }

  if (candidates.some((value) => value.includes("multiple"))) {
    return "multiple_matches";
  }

  if (candidates.some((value) => value.includes("no_match") || value.includes("none"))) {
    return "no_match";
  }

  return "unknown";
}

function deriveOfficeName(data: unknown) {
  const record = asRecord(data) ?? {};
  const callState = asRecord(record.callState);
  return (
    asString(record.officeName) ??
    asString(record.locationName) ??
    asString(asRecord(record.location)?.name) ??
    asString(asRecord(callState?.office)?.name) ??
    null
  );
}

function runtimeSignals(data: unknown) {
  const sessionEvents = asRecord(asRecord(data)?.sessionEvents);
  const close = asRecord(sessionEvents?.close);
  const errors = asArray(sessionEvents?.errors).filter(isRecord);
  const falseInterruptions = asArray(sessionEvents?.falseInterruptions);
  const overlappingSpeech = asArray(sessionEvents?.overlappingSpeech);

  return {
    closeReason: asString(close?.reason),
    errors: errors.map((error) => redactForReview(error)),
    falseInterruptions: falseInterruptions.length,
    overlappingSpeech: overlappingSpeech.length,
  };
}

function stateSignals(data: unknown, preloadedAppointmentCount: number) {
  const record = asRecord(data) ?? {};
  const callState = asRecord(record.callState);
  const identity = asRecord(callState?.identity);
  const appointment = asRecord(callState?.appointment);
  const workflow = asRecord(callState?.workflow);

  return redactForReview({
    activeOffice: asString(callState?.activeOffice),
    appointmentStatus:
      asString(appointment?.status) ?? asString(callState?.appointmentStatus),
    identityStatus: asString(identity?.status) ?? asString(callState?.identityStatus),
    language: record.language,
    llmSummary: record.llmSummary,
    patientVerified:
      asBoolean(callState?.patientVerified) ??
      asBoolean(identity?.verified) ??
      asBoolean(callState?.verifiedPatient),
    preloadedAppointmentCount,
    waitingFor: asString(callState?.waitingFor),
    workflowCurrent: asString(workflow?.current) ?? asString(callState?.workflowCurrent),
  });
}

export function hasReviewSourceMaterial(data: unknown) {
  const record = asRecord(data);
  if (!record) return false;

  const turns = asArray(record.turns).filter(isRecord);
  if (
    turns.some(
      (turn) =>
        asString(turn.callerText) ||
        asString(turn.agentText) ||
        asArray(turn.toolCalls).length > 0,
    )
  ) {
    return true;
  }

  if (
    sessionItems(data).some(
      (item) =>
        item.type === "message" ||
        item.type === "function_call" ||
        item.type === "function_call_output",
    )
  ) {
    return true;
  }

  return asArray(record.toolExecutions).length > 0;
}

export function hasReviewMaterial(input: NormalizedReviewInput) {
  return (
    input.transcript.length > 0 ||
    input.toolEvents.length > 0 ||
    input.toolExecutions.length > 0
  );
}

export function shouldQueueAgentCallReview(input: {
  dataPayload: unknown;
  status: string;
}) {
  return input.status !== "IN_PROGRESS" && hasReviewSourceMaterial(input.dataPayload);
}

export function buildNormalizedReviewInputFromAgentCall(
  call: AgentCallReviewSource,
  deterministicFindings: DeterministicFinding[] = [],
): NormalizedReviewInput {
  const data = call.data;
  const transcriptFromSession = normalizeTranscriptFromSession(data);
  const transcript =
    transcriptFromSession.length > 0
      ? transcriptFromSession
      : normalizeTranscriptFromTurns(data);
  const toolEventsFromTurns = normalizeToolEventsFromTurns(data);
  const toolEvents =
    toolEventsFromTurns.length > 0
      ? toolEventsFromTurns
      : normalizeToolEventsFromSession(data);
  const toolExecutions = normalizeToolExecutions(data);
  const runtime = runtimeSignals(data);
  const preloadedAppointments = extractPreloadedAppointments(data);
  const hadPreloadedAppointments = preloadedAppointments.length > 0;
  const deterministicFlags = deterministicFindings.map((finding) => finding.flag);

  return {
    callId: call.callId,
    callerContext: {
      hadPreloadedAppointments,
      officeName: deriveOfficeName(data),
      phoneLookupStatus: phoneLookupStatus(data, hadPreloadedAppointments),
      preloadedAppointments,
    },
    callerPhoneRedacted: redactTextForReview(call.callerPhone),
    deterministicFindings,
    deterministicFlags,
    endedAt: isoString(call.endedAt),
    metrics: {
      durationSec: call.durationSec,
      fallbackUsed: call.fallbackUsed,
      interruptions: call.interruptionCount,
      runtimeErrors: runtime.errors.length,
      toolCalls: call.toolCalls || toolEvents.length || toolExecutions.length,
      toolErrors:
        call.toolErrors ||
        toolEvents.filter((tool) => tool.isError).length ||
        toolExecutions.filter((tool) => tool.status === "error").length,
      totalTurns:
        call.totalTurns || transcript.filter((item) => item.role === "user").length,
    },
    officePhone: call.officePhone,
    portalCallId: call.id,
    runtimeSignals: runtime,
    startedAt: isoString(call.startedAt) ?? new Date().toISOString(),
    stateSignals: stateSignals(data, preloadedAppointments.length),
    status: call.status,
    summarySignals: {
      bookedAppointment: call.bookedAppointment,
      cancelledAppointment: call.cancelledAppointment,
      confirmedAppointment: call.confirmedAppointment,
      transferred: call.transferred,
    },
    toolEvents,
    toolExecutions,
    transcript,
  };
}
