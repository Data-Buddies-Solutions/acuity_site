export const PROVIDER_COMMAND_SENDING_LEASE_MS = 60_000;

type ProviderCommandDispatchBase = {
  callId: string;
  commandId: string;
  idempotencyKey: string;
  legId: string;
  practiceId: string;
};

type ExistingLegProviderTarget = {
  callControlId: string;
};

type AnswerCustomerDispatchData = ProviderCommandDispatchBase & {
  arguments: Record<string, never>;
  provider: ExistingLegProviderTarget;
  type: "ANSWER_CUSTOMER";
};

type StartRingbackDispatchData = ProviderCommandDispatchBase & {
  arguments: { timeoutSeconds: number };
  provider: ExistingLegProviderTarget;
  type: "START_RINGBACK";
};

type StopPlaybackDispatchData = ProviderCommandDispatchBase & {
  arguments: Record<string, never>;
  provider: ExistingLegProviderTarget;
  type: "STOP_PLAYBACK";
};

type StartHoldMusicDispatchData = ProviderCommandDispatchBase & {
  arguments: Record<string, never>;
  provider: ExistingLegProviderTarget;
  type: "START_HOLD_MUSIC";
};

type StopHoldMusicDispatchData = ProviderCommandDispatchBase & {
  arguments: Record<string, never>;
  provider: ExistingLegProviderTarget;
  type: "STOP_HOLD_MUSIC";
};

type HangupLegDispatchData = ProviderCommandDispatchBase & {
  arguments: Record<string, never>;
  provider: ExistingLegProviderTarget;
  type: "HANGUP_LEG";
};

type PlayVoicemailGreetingDispatchData = ProviderCommandDispatchBase & {
  arguments: { greeting: string };
  provider: ExistingLegProviderTarget;
  type: "PLAY_VOICEMAIL_GREETING";
};

type StartRecordingDispatchData = ProviderCommandDispatchBase & {
  arguments: Record<string, never>;
  provider: ExistingLegProviderTarget;
  type: "START_RECORDING";
};

type DialAgentDispatchData = ProviderCommandDispatchBase & {
  arguments: {
    agentSessionId: string;
    endpointId: string;
  };
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

type TransferAgentDispatchData = ProviderCommandDispatchBase & {
  arguments: {
    agentSessionId: string;
    endpointId: string;
    providerSourceLegId: string;
    sourceLegId: string;
  };
  /** Resolved at claim time; provider credentials never enter durable arguments. */
  provider:
    | {
        callControlId: string;
        sipUri: string;
        strategy: "TRANSFER";
        timeoutSeconds: number;
      }
    | {
        callControlId: string;
        connectionId: string;
        from: string;
        sipUri: string;
        strategy: "DIAL_BRIDGE";
        timeoutSeconds: number;
      };
  type: "TRANSFER_AGENT";
};

export type ProviderCommandDispatchData =
  | AnswerCustomerDispatchData
  | StartRingbackDispatchData
  | DialAgentDispatchData
  | TransferAgentDispatchData
  | StopPlaybackDispatchData
  | StartHoldMusicDispatchData
  | StopHoldMusicDispatchData
  | HangupLegDispatchData
  | PlayVoicemailGreetingDispatchData
  | StartRecordingDispatchData;

export type ProviderCommandClaim = {
  /** One-based attempt number after the durable claim is acquired. */
  attemptCount: number;
  command: ProviderCommandDispatchData;
};

export type ProviderSendErrorClassification = {
  code:
    | "PROVIDER_AUTHORIZATION_FAILED"
    | "PROVIDER_RATE_LIMITED"
    | "PROVIDER_UNKNOWN"
    | "PROVIDER_VALIDATION_FAILED"
    | "SENDING_OUTCOME_AMBIGUOUS";
};

export type ProviderCommandStatus =
  "PENDING" | "SENDING" | "SENT" | "CONFIRMED" | "FAILED";

export type ProviderCommandMarkSentResult =
  "MARKED" | "ALREADY_SENT" | "ALREADY_CONFIRMED" | "STALE";

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
