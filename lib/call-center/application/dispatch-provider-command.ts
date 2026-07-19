import {
  PROVIDER_COMMAND_SENDING_LEASE_MS,
  type ProviderCommandClaim,
  type ProviderCommandDispatchData,
  type ProviderCommandMarkSentResult,
  type ProviderSendErrorClassification,
} from "@/lib/call-center/domain/provider-command";

export interface ProviderCommandDispatchStore {
  claim(input: {
    commandId: string;
    now: Date;
    staleBefore: Date;
  }): Promise<
    | ProviderCommandClaim
    | ProviderCommandRejectedClaim
    | ProviderCommandSettledClaim
    | null
  >;
  fail(input: {
    attemptCount: number;
    commandId: string;
    errorCode: ProviderSendErrorClassification["code"];
    now: Date;
  }): Promise<{ commandIds: string[] } | null>;
  markSent(input: {
    attemptCount: number;
    commandId: string;
    now: Date;
  }): Promise<ProviderCommandMarkSentResult>;
}

export type ProviderCommandRejectedClaim = {
  commandId: string;
  errorCode: string;
  followUpCommandIds: string[];
  rejected: true;
};

export type ProviderCommandSettledClaim = {
  commandId: string;
  settled: true;
};

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
      errorCode: "PROVIDER_RATE_LIMITED" | "SENDING_OUTCOME_AMBIGUOUS";
      status: "DEFERRED";
    }
  | { commandId: string; status: "SETTLED" }
  | (Omit<ProviderCommandRejectedClaim, "rejected"> & { status: "REJECTED" })
  | {
      commandId: string;
      markSent: Exclude<ProviderCommandMarkSentResult, "STALE">;
      status: "DISPATCHED";
    }
  | { commandId: string; phase: "FAIL" | "MARK_SENT"; status: "STALE" }
  | {
      commandId: string;
      errorCode: ProviderSendErrorClassification["code"];
      followUpCommandIds: string[];
      status: "FAILED";
    };

export type ProviderCommandGraphResult = {
  attempted: number;
  deferred: string[];
  dispatched: number;
  failures: Array<{ commandId: string; errorCode: string }>;
};

type Dependencies = {
  classifyError: ProviderSendErrorClassifier;
  clock?: () => Date;
  enabled?: boolean;
  sendingLeaseMs?: number;
  sender: ProviderCommandSender;
  store: ProviderCommandDispatchStore;
};

export async function dispatchProviderCommandGraph({
  commandIds,
  dispatch,
  limit = Number.POSITIVE_INFINITY,
}: {
  commandIds: string[];
  dispatch(commandId: string): Promise<ProviderCommandDispatchResult>;
  limit?: number;
}): Promise<ProviderCommandGraphResult> {
  const known = new Set<string>();
  const pending = new Set<string>();
  const overflow = new Set<string>();
  const failures: ProviderCommandGraphResult["failures"] = [];
  let dispatched = 0;

  const enqueue = (commandId: string) => {
    if (!commandId || known.has(commandId) || overflow.has(commandId)) return;
    if (known.size >= limit) {
      overflow.add(commandId);
      return;
    }
    known.add(commandId);
    pending.add(commandId);
  };
  commandIds.forEach(enqueue);

  while (pending.size > 0) {
    const round = [...pending];
    pending.clear();
    const results = await Promise.all(
      round.map(async (commandId) => {
        try {
          return { commandId, result: await dispatch(commandId) };
        } catch {
          return { commandId, result: null };
        }
      }),
    );
    let progressed = false;

    for (const { commandId, result } of results) {
      if (result?.status === "DISPATCHED" || result?.status === "SETTLED") {
        dispatched += 1;
        progressed = true;
      } else if (result?.status === "FAILED" || result?.status === "REJECTED") {
        failures.push({ commandId, errorCode: result.errorCode });
        result.followUpCommandIds.forEach(enqueue);
        progressed = true;
      } else {
        pending.add(commandId);
      }
    }
    if (!progressed) break;
  }

  return {
    attempted: known.size,
    deferred: [...pending, ...overflow],
    dispatched,
    failures,
  };
}

function classifySafely(
  classifier: ProviderSendErrorClassifier,
  error: unknown,
): ProviderSendErrorClassification {
  try {
    return classifier.classify(error);
  } catch {
    return { code: "PROVIDER_UNKNOWN" };
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
      now: claimedAt,
      staleBefore: new Date(claimedAt.getTime() - sendingLeaseMs),
    });
    if (!claim) return { status: "NOT_CLAIMED" };
    if ("settled" in claim) {
      return { commandId: claim.commandId, status: "SETTLED" };
    }
    if ("rejected" in claim) {
      return {
        commandId: claim.commandId,
        errorCode: claim.errorCode,
        followUpCommandIds: claim.followUpCommandIds,
        status: "REJECTED",
      };
    }

    try {
      await sender.send(claim.command);
    } catch (error) {
      const classified = classifySafely(classifyError, error);
      if (
        classified.code === "SENDING_OUTCOME_AMBIGUOUS" ||
        classified.code === "PROVIDER_RATE_LIMITED"
      ) {
        return {
          commandId: claim.command.commandId,
          errorCode: classified.code,
          status: "DEFERRED",
        };
      }
      const failedAt = clock();
      const failed = await store.fail({
        attemptCount: claim.attemptCount,
        commandId: claim.command.commandId,
        errorCode: classified.code,
        now: failedAt,
      });
      return failed
        ? {
            commandId: claim.command.commandId,
            errorCode: classified.code,
            followUpCommandIds: failed.commandIds,
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
