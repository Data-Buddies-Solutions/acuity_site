export const CALL_REVIEW_JUDGE_VERSION = "harness_3";

export type ReviewStatus = "pending" | "running" | "completed" | "failed";

export type HallucinationLabel = "none" | "minor" | "major";
export type ToolPathLabel = "correct" | "questionable" | "incorrect";
export type ResolutionPathLabel = "optimal" | "acceptable" | "inefficient" | "failed";
export type OutcomeLabel = "resolved" | "partially_resolved" | "unresolved";
export type Severity = "low" | "medium" | "high";

export type DeterministicFlag =
  | "practice_fact_without_lookup_knowledge"
  | "spoken_claim_conflicts_with_tool_output"
  | "cancel_claim_without_cancel_appt"
  | "book_claim_without_book_appt"
  | "reschedule_claim_without_reschedule_appt"
  | "confirm_details_without_confirm_appt_or_context"
  | "availability_claim_without_get_availability"
  | "insurance_claim_without_check_insurance"
  | "update_insurance_without_explicit_change_intent"
  | "tool_error_followed_by_success_claim"
  | "redundant_same_tool_same_args"
  | "premature_close_after_interrupt"
  | "runtime_error"
  | "fallback_model_used";

export type JudgeFindingType =
  | "unsupported_fact"
  | "wrong_tool"
  | "missed_required_tool"
  | "redundant_tool_call"
  | "intent_misread"
  | "inefficient_back_and_forth"
  | "premature_commitment"
  | "poor_recovery"
  | "conversation_oddity"
  | "observability_gap";

export interface ReviewEvidence {
  turns?: number[] | null;
  quote?: string | null;
  toolName?: string | null;
}

export interface JudgeFinding {
  type: JudgeFindingType;
  severity: Severity;
  title: string;
  whyItMatters: string;
  evidence: ReviewEvidence;
}

export interface JudgeResult {
  summary: string;
  passed: boolean;
  outcome: OutcomeLabel;
  labels: {
    hallucination: HallucinationLabel;
    toolPath: ToolPathLabel;
    resolutionPath: ResolutionPathLabel;
  };
  scores: {
    grounding: 1 | 2 | 3 | 4 | 5;
    toolUseCorrectness: 1 | 2 | 3 | 4 | 5;
    workflowEfficiency: 1 | 2 | 3 | 4 | 5;
    intentHandling: 1 | 2 | 3 | 4 | 5;
    resolutionQuality: 1 | 2 | 3 | 4 | 5;
    conversationQuality: 1 | 2 | 3 | 4 | 5;
  };
  topIssue: {
    type: JudgeFindingType;
    title: string;
  } | null;
  findings: JudgeFinding[];
  nearMisses: string[];
  recommendedActions: Array<{
    owner: "prompt" | "tooling" | "workflow" | "knowledge_base" | "ui";
    priority: Severity;
    action: string;
  }> | null;
}

export interface DeterministicFinding {
  flag: DeterministicFlag;
  severity: Severity;
  title: string;
  evidence: ReviewEvidence;
}

export interface NormalizedReviewTranscriptTurn {
  turn: number;
  role: "user" | "assistant";
  text: string;
  createdAt: number | string | null;
}

export interface NormalizedReviewToolEvent {
  turn: number;
  name: string;
  args: unknown;
  result: unknown;
  isError: boolean;
  createdAt: number | string | null;
}

export interface NormalizedReviewToolExecution {
  toolName: string;
  status: "success" | "error" | "unknown";
  outputClass: string | null;
  createdAt: string | null;
}

export interface NormalizedReviewInput {
  callId: string;
  portalCallId: string;
  officePhone: string;
  callerPhoneRedacted: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  metrics: {
    durationSec: number;
    totalTurns: number;
    interruptions: number;
    toolCalls: number;
    toolErrors: number;
    runtimeErrors: number;
    fallbackUsed: boolean;
  };
  summarySignals: {
    bookedAppointment: boolean;
    cancelledAppointment: boolean;
    confirmedAppointment: boolean;
    transferred: boolean;
  };
  callerContext: {
    phoneLookupStatus: "verified" | "multiple_matches" | "no_match" | "unknown";
    hadPreloadedAppointments: boolean;
    preloadedAppointments: Array<{
      date: string | null;
      time: string | null;
      provider: string | null;
      facility: string | null;
    }>;
    officeName: string | null;
  };
  deterministicFlags: DeterministicFlag[];
  deterministicFindings: DeterministicFinding[];
  transcript: NormalizedReviewTranscriptTurn[];
  toolEvents: NormalizedReviewToolEvent[];
  toolExecutions: NormalizedReviewToolExecution[];
  runtimeSignals: {
    closeReason: string | null;
    falseInterruptions: number;
    overlappingSpeech: number;
    errors: unknown[];
  };
  stateSignals: unknown;
}

const findingTypes: JudgeFindingType[] = [
  "unsupported_fact",
  "wrong_tool",
  "missed_required_tool",
  "redundant_tool_call",
  "intent_misread",
  "inefficient_back_and_forth",
  "premature_commitment",
  "poor_recovery",
  "conversation_oddity",
  "observability_gap",
];

function isScore(value: unknown): value is 1 | 2 | 3 | 4 | 5 {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isJudgeResult(value: unknown): value is JudgeResult {
  if (!isRecord(value)) return false;

  if (
    typeof value.summary !== "string" ||
    typeof value.passed !== "boolean" ||
    !["resolved", "partially_resolved", "unresolved"].includes(String(value.outcome))
  ) {
    return false;
  }

  const labels = isRecord(value.labels) ? value.labels : null;
  if (
    !labels ||
    !["none", "minor", "major"].includes(String(labels.hallucination)) ||
    !["correct", "questionable", "incorrect"].includes(String(labels.toolPath)) ||
    !["optimal", "acceptable", "inefficient", "failed"].includes(
      String(labels.resolutionPath),
    )
  ) {
    return false;
  }

  const scores = isRecord(value.scores) ? value.scores : null;
  if (
    !scores ||
    !isScore(scores.grounding) ||
    !isScore(scores.toolUseCorrectness) ||
    !isScore(scores.workflowEfficiency) ||
    !isScore(scores.intentHandling) ||
    !isScore(scores.resolutionQuality) ||
    !isScore(scores.conversationQuality)
  ) {
    return false;
  }

  if (
    !Array.isArray(value.findings) ||
    !isStringArray(value.nearMisses) ||
    (value.recommendedActions !== null && !Array.isArray(value.recommendedActions))
  ) {
    return false;
  }

  for (const finding of value.findings) {
    if (
      !isRecord(finding) ||
      !findingTypes.includes(finding.type as JudgeFindingType) ||
      !["low", "medium", "high"].includes(String(finding.severity)) ||
      typeof finding.title !== "string" ||
      typeof finding.whyItMatters !== "string" ||
      !isRecord(finding.evidence)
    ) {
      return false;
    }
  }

  return true;
}

export const CALL_REVIEW_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "passed",
    "outcome",
    "labels",
    "scores",
    "topIssue",
    "findings",
    "nearMisses",
    "recommendedActions",
  ],
  properties: {
    summary: { type: "string" },
    passed: { type: "boolean" },
    outcome: {
      type: "string",
      enum: ["resolved", "partially_resolved", "unresolved"],
    },
    labels: {
      type: "object",
      additionalProperties: false,
      required: ["hallucination", "toolPath", "resolutionPath"],
      properties: {
        hallucination: { type: "string", enum: ["none", "minor", "major"] },
        toolPath: { type: "string", enum: ["correct", "questionable", "incorrect"] },
        resolutionPath: {
          type: "string",
          enum: ["optimal", "acceptable", "inefficient", "failed"],
        },
      },
    },
    scores: {
      type: "object",
      additionalProperties: false,
      required: [
        "grounding",
        "toolUseCorrectness",
        "workflowEfficiency",
        "intentHandling",
        "resolutionQuality",
        "conversationQuality",
      ],
      properties: {
        grounding: { type: "integer", minimum: 1, maximum: 5 },
        toolUseCorrectness: { type: "integer", minimum: 1, maximum: 5 },
        workflowEfficiency: { type: "integer", minimum: 1, maximum: 5 },
        intentHandling: { type: "integer", minimum: 1, maximum: 5 },
        resolutionQuality: { type: "integer", minimum: 1, maximum: 5 },
        conversationQuality: { type: "integer", minimum: 1, maximum: 5 },
      },
    },
    topIssue: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "title"],
          properties: {
            type: { type: "string", enum: findingTypes },
            title: { type: "string" },
          },
        },
      ],
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "severity", "title", "whyItMatters", "evidence"],
        properties: {
          type: { type: "string", enum: findingTypes },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          title: { type: "string" },
          whyItMatters: { type: "string" },
          evidence: {
            type: "object",
            additionalProperties: false,
            required: ["turns", "quote", "toolName"],
            properties: {
              turns: {
                anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }],
              },
              quote: { anyOf: [{ type: "string" }, { type: "null" }] },
              toolName: { anyOf: [{ type: "string" }, { type: "null" }] },
            },
          },
        },
      },
    },
    nearMisses: { type: "array", items: { type: "string" } },
    recommendedActions: {
      anyOf: [
        {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["owner", "priority", "action"],
            properties: {
              owner: {
                type: "string",
                enum: ["prompt", "tooling", "workflow", "knowledge_base", "ui"],
              },
              priority: { type: "string", enum: ["low", "medium", "high"] },
              action: { type: "string" },
            },
          },
        },
        { type: "null" },
      ],
    },
  },
} as const;
