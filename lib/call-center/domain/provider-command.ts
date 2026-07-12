export const PROVIDER_COMMAND_MAX_ATTEMPTS = 5;
export const PROVIDER_COMMAND_SENDING_LEASE_MS = 60_000;

const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

export type DialAgentDispatchData = {
  arguments: {
    agentSessionId: string;
    endpointId: string;
  };
  callId: string;
  commandId: string;
  idempotencyKey: string;
  legId: string;
  practiceId: string;
  /** Resolved at claim time; these provider values are not command arguments. */
  provider: {
    connectionId: string;
    from: string;
    linkTo: string;
    sipUri: string;
    timeoutSeconds: number;
  };
  type: "DIAL_AGENT";
};

export type ProviderCommandDispatchData = DialAgentDispatchData;

export type ProviderCommandClaim = {
  /** One-based attempt number after the durable claim is acquired. */
  attemptCount: number;
  command: ProviderCommandDispatchData;
};

export type ProviderSendErrorClassification =
  | {
      category: "RETRYABLE";
      code: "PROVIDER_RATE_LIMITED" | "SENDING_OUTCOME_AMBIGUOUS";
    }
  | {
      category: "TERMINAL";
      code: "PROVIDER_AUTHORIZATION_FAILED" | "PROVIDER_VALIDATION_FAILED";
    }
  | { category: "UNKNOWN"; code: "PROVIDER_UNKNOWN" };

export type ProviderCommandStatus =
  "PENDING" | "SENDING" | "SENT" | "CONFIRMED" | "FAILED";

export type ProviderCommandMarkSentResult =
  "MARKED" | "ALREADY_SENT" | "ALREADY_CONFIRMED" | "STALE";

export type ProviderCommandFailurePlan = {
  nextAttemptAt: Date | null;
  retryScheduled: boolean;
};

/**
 * A provider callback may confirm the command between send completion and the
 * dispatcher's write. That callback is authoritative and must never regress.
 */
export function decideProviderCommandMarkSent(
  status: ProviderCommandStatus,
  currentAttemptCount: number,
  claimedAttemptCount: number,
): ProviderCommandMarkSentResult {
  if (status === "CONFIRMED") return "ALREADY_CONFIRMED";
  if (currentAttemptCount !== claimedAttemptCount) return "STALE";
  if (status === "SENDING") return "MARKED";
  if (status === "SENT") return "ALREADY_SENT";
  return "STALE";
}

export function providerCommandRetryAt(
  attemptCount: number,
  now: Date,
  { baseMs = RETRY_BASE_MS, maxMs = RETRY_MAX_MS } = {},
) {
  const exponent = Math.max(0, attemptCount - 1);
  return new Date(now.getTime() + Math.min(maxMs, baseMs * 2 ** exponent));
}

/** Unknown outcomes stop automatic retries until an operator classifies them. */
export function planProviderCommandFailure(
  error: ProviderSendErrorClassification,
  attemptCount: number,
  now: Date,
  maxAttempts = PROVIDER_COMMAND_MAX_ATTEMPTS,
): ProviderCommandFailurePlan {
  const retryScheduled = error.category === "RETRYABLE" && attemptCount < maxAttempts;
  return {
    nextAttemptAt: retryScheduled ? providerCommandRetryAt(attemptCount, now) : null,
    retryScheduled,
  };
}
