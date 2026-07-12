import {
  planProviderCommandFailure,
  PROVIDER_COMMAND_MAX_ATTEMPTS,
  PROVIDER_COMMAND_SENDING_LEASE_MS,
  type ProviderCommandClaim,
  type ProviderCommandDispatchData,
  type ProviderCommandMarkSentResult,
  type ProviderSendErrorClassification,
} from "@/lib/call-center/domain/provider-command";

export interface ProviderCommandDispatchStore {
  claim(input: {
    commandId: string;
    maxAttempts: number;
    now: Date;
    staleBefore: Date;
  }): Promise<ProviderCommandClaim | null>;
  fail(input: {
    attemptCount: number;
    commandId: string;
    errorCode: ProviderSendErrorClassification["code"];
    nextAttemptAt: Date | null;
    now: Date;
  }): Promise<boolean>;
  markSent(input: {
    attemptCount: number;
    commandId: string;
    now: Date;
  }): Promise<ProviderCommandMarkSentResult>;
}

export interface ProviderCommandSender {
  send(command: ProviderCommandDispatchData): Promise<void>;
}

export interface ProviderSendErrorClassifier {
  classify(error: unknown): ProviderSendErrorClassification;
}

export type ProviderCommandDispatchResult =
  | { status: "DISABLED" }
  | { status: "NOT_CLAIMED" }
  | {
      commandId: string;
      markSent: Exclude<ProviderCommandMarkSentResult, "STALE">;
      status: "DISPATCHED";
    }
  | { commandId: string; phase: "FAIL" | "MARK_SENT"; status: "STALE" }
  | {
      commandId: string;
      errorCode: ProviderSendErrorClassification["code"];
      nextAttemptAt: Date | null;
      retryScheduled: boolean;
      status: "FAILED";
    };

type Dependencies = {
  classifyError: ProviderSendErrorClassifier;
  clock?: () => Date;
  enabled?: boolean;
  maxAttempts?: number;
  sendingLeaseMs?: number;
  sender: ProviderCommandSender;
  store: ProviderCommandDispatchStore;
};

function classifySafely(
  classifier: ProviderSendErrorClassifier,
  error: unknown,
): ProviderSendErrorClassification {
  try {
    return classifier.classify(error);
  } catch {
    return { category: "UNKNOWN", code: "PROVIDER_UNKNOWN" };
  }
}

/**
 * Claims and sends one durable command. Dispatch is disabled unless explicitly
 * enabled; persistence owns atomic claim and compare-and-set completion writes.
 */
export function createProviderCommandDispatcher({
  classifyError,
  clock = () => new Date(),
  enabled = false,
  maxAttempts = PROVIDER_COMMAND_MAX_ATTEMPTS,
  sendingLeaseMs = PROVIDER_COMMAND_SENDING_LEASE_MS,
  sender,
  store,
}: Dependencies) {
  return async function dispatchProviderCommand(
    commandId: string,
  ): Promise<ProviderCommandDispatchResult> {
    if (!enabled) return { status: "DISABLED" };

    const claimedAt = clock();
    const claim = await store.claim({
      commandId,
      maxAttempts,
      now: claimedAt,
      staleBefore: new Date(claimedAt.getTime() - sendingLeaseMs),
    });
    if (!claim) return { status: "NOT_CLAIMED" };

    try {
      await sender.send(claim.command);
    } catch (error) {
      const classified = classifySafely(classifyError, error);
      const failedAt = clock();
      const failure = planProviderCommandFailure(
        classified,
        claim.attemptCount,
        failedAt,
        maxAttempts,
      );
      const failed = await store.fail({
        attemptCount: claim.attemptCount,
        commandId: claim.command.commandId,
        errorCode: classified.code,
        nextAttemptAt: failure.nextAttemptAt,
        now: failedAt,
      });
      return failed
        ? {
            commandId: claim.command.commandId,
            errorCode: classified.code,
            ...failure,
            status: "FAILED",
          }
        : { commandId: claim.command.commandId, phase: "FAIL", status: "STALE" };
    }

    const markSent = await store.markSent({
      attemptCount: claim.attemptCount,
      commandId: claim.command.commandId,
      now: clock(),
    });
    return markSent === "STALE"
      ? { commandId: claim.command.commandId, phase: "MARK_SENT", status: "STALE" }
      : { commandId: claim.command.commandId, markSent, status: "DISPATCHED" };
  };
}
