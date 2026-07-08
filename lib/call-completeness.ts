import type { CallSummaryData, ChatHistoryItem, TurnRecord } from "@/lib/call-types";

export type CallCompletenessStatus =
  | "complete"
  | "in_progress"
  | "livekit_recovered"
  | "missing_transcript"
  | "webhook_error";

export type CallCompleteness = {
  description: string | null;
  hasRuntimeData: boolean;
  hasTranscript: boolean;
  hasWebhookFallback: boolean;
  label: string | null;
  status: CallCompletenessStatus;
};

type CallCompletenessOptions = {
  linkedWebhookFailed?: boolean;
  status?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasTextContent(content: ChatHistoryItem["content"]) {
  return Boolean(
    content?.some((part) =>
      typeof part === "string" ? nonEmptyText(part) : nonEmptyText(part.transcript),
    ),
  );
}

function hasSessionTranscript(items: unknown) {
  return Array.isArray(items)
    ? items.some((item) => {
        if (!isRecord(item) || item.type !== "message") {
          return false;
        }

        const role = item.role;
        if (role !== "user" && role !== "assistant") {
          return false;
        }

        return hasTextContent(item.content as ChatHistoryItem["content"]);
      })
    : false;
}

function hasTurnTranscript(turns: unknown) {
  return Array.isArray(turns)
    ? turns.some((turn) => {
        if (!isRecord(turn)) {
          return false;
        }

        return nonEmptyText(turn.callerText) || nonEmptyText(turn.agentText);
      })
    : false;
}

function hasArrayData(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

export function getCallCompleteness(
  data: unknown,
  options: CallCompletenessOptions = {},
): CallCompleteness {
  const record = isRecord(data)
    ? (data as CallSummaryData & Record<string, unknown>)
    : null;
  const sessionItems = record?.sessionReport?.chat_history?.items;
  const turns = record?.turns as TurnRecord[] | undefined;
  const hasTranscript = hasSessionTranscript(sessionItems) || hasTurnTranscript(turns);
  const hasWebhookFallback = isRecord(record?.webhookFallback);
  const hasRuntimeData = Boolean(
    record?.sessionReport ||
    hasArrayData(turns) ||
    hasArrayData(record?.toolExecutions) ||
    hasArrayData(record?.appointmentActions) ||
    record?.llmSummary ||
    record?.sessionEvents,
  );

  if (options.linkedWebhookFailed) {
    return {
      description:
        "LiveKit sent webhook data for this call, but at least one linked webhook event failed to process.",
      hasRuntimeData,
      hasTranscript,
      hasWebhookFallback,
      label: "Webhook issue",
      status: "webhook_error",
    };
  }

  if (options.status === "IN_PROGRESS") {
    return {
      description: null,
      hasRuntimeData,
      hasTranscript,
      hasWebhookFallback,
      label: null,
      status: "in_progress",
    };
  }

  if (hasTranscript) {
    return {
      description: null,
      hasRuntimeData,
      hasTranscript,
      hasWebhookFallback,
      label: null,
      status: "complete",
    };
  }

  if (hasWebhookFallback) {
    return {
      description:
        "LiveKit captured this call, but the runtime transcript and action report did not arrive.",
      hasRuntimeData,
      hasTranscript,
      hasWebhookFallback,
      label: "LiveKit recovered",
      status: "livekit_recovered",
    };
  }

  return {
    description: hasRuntimeData
      ? "Runtime data arrived, but no transcript messages were available."
      : "No runtime transcript or action report has arrived for this call.",
    hasRuntimeData,
    hasTranscript,
    hasWebhookFallback,
    label: "Transcript missing",
    status: "missing_transcript",
  };
}

export function isCallCompletenessIssue(completeness: CallCompleteness) {
  return completeness.status !== "complete" && completeness.status !== "in_progress";
}
