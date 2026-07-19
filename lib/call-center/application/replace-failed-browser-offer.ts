import {
  executeIdempotentOperation,
  type OperationReceipt,
  type OperationReceiptTransaction,
} from "@/lib/call-center/application/operation-receipts";
import { dispatchProviderCommandGraph } from "@/lib/call-center/application/dispatch-provider-command";
import { dispatchProviderCommand } from "@/lib/call-center/application/provider-command-runtime";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

export const BROWSER_OFFER_REPLACED_EVENT = "CALL_BROWSER_OFFER_REPLACED";

export type FailedBrowserOfferRecoveryInput = {
  agentSessionId: string;
  callId: string;
  callLegId: string;
  clientInstanceId: string;
  idempotencyKey: string;
  reason: "CALL_DOES_NOT_EXIST" | "SDK_CALL_TERMINAL" | "SESSION_NOT_REATTACHED";
  recoveryGeneration: number;
};

export type FailedBrowserOfferRecoveryContext = {
  call: {
    deadlineAt: Date | null;
    direction: "INBOUND" | "OUTBOUND";
    id: string;
    practiceId: string;
    queueId: string | null;
    status:
      | "ABANDONED"
      | "COMPLETED"
      | "CONNECTED"
      | "FAILED"
      | "QUEUED"
      | "RECEIVED"
      | "RINGING"
      | "VOICEMAIL";
    voicemailStartedAt: Date | null;
    winningLegId: string | null;
  };
  leg: {
    agentSessionId: string | null;
    attemptNumber: number;
    endpointId: string | null;
    id: string;
    isCurrent: boolean;
    kind: "AGENT" | "CUSTOMER";
    providerCallControlId: string | null;
    status:
      "ANSWERED" | "BRIDGED" | "CREATED" | "DIALING" | "ENDED" | "FAILED" | "RINGING";
  };
  session: {
    browserSessionId: string;
    endpointId: string;
    id: string;
    leaseExpiresAt: Date;
    userId: string;
  };
};

type ReplacementGraph = {
  dialCommandId: string;
  hangupCommandId: string;
  newCallLegId: string;
  stateVersion: number;
};

export interface FailedBrowserOfferRecoveryTransaction extends OperationReceiptTransaction {
  createReplacement(
    context: FailedBrowserOfferRecoveryContext,
    input: FailedBrowserOfferRecoveryInput,
    now: Date,
  ): Promise<ReplacementGraph>;
  loadContext(
    actor: QueueAccessActor,
    input: FailedBrowserOfferRecoveryInput,
  ): Promise<FailedBrowserOfferRecoveryContext | null>;
}

export interface FailedBrowserOfferRecoveryStore {
  withTransaction<T>(
    work: (transaction: FailedBrowserOfferRecoveryTransaction) => Promise<T>,
  ): Promise<T>;
}

export class FailedBrowserOfferRecoveryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FailedBrowserOfferRecoveryError";
  }
}

export type FailedBrowserOfferRecoveryReceipt = OperationReceipt & {
  callId: string;
  deadlineAt: string;
  dialCommandId: string;
  hangupCommandId: string;
  newCallLegId: string;
  oldCallLegId: string;
  operationType: "BROWSER_OFFER_REPLACEMENT";
  reason: FailedBrowserOfferRecoveryInput["reason"];
  stateVersion: number;
};

function assertRecoverable(
  context: FailedBrowserOfferRecoveryContext | null,
  actor: QueueAccessActor,
  input: FailedBrowserOfferRecoveryInput,
  now: Date,
): asserts context is FailedBrowserOfferRecoveryContext {
  if (
    !context ||
    context.call.id !== input.callId ||
    context.call.practiceId !== actor.practiceId ||
    context.leg.id !== input.callLegId
  ) {
    throw new FailedBrowserOfferRecoveryError("Call offer not found", 404);
  }
  if (
    context.session.id !== input.agentSessionId ||
    context.session.userId !== actor.userId ||
    context.session.browserSessionId !== input.clientInstanceId ||
    context.leg.agentSessionId !== context.session.id ||
    context.leg.endpointId !== context.session.endpointId
  ) {
    throw new FailedBrowserOfferRecoveryError(
      "Call offer is owned by another session",
      403,
    );
  }
  if (
    context.call.direction !== "INBOUND" ||
    context.call.status !== "RINGING" ||
    context.call.winningLegId ||
    context.call.voicemailStartedAt ||
    !context.call.queueId ||
    !context.call.deadlineAt ||
    context.call.deadlineAt <= now ||
    context.leg.kind !== "AGENT" ||
    !context.leg.isCurrent ||
    !["CREATED", "DIALING", "RINGING"].includes(context.leg.status) ||
    !context.leg.providerCallControlId ||
    context.session.leaseExpiresAt <= now
  ) {
    throw new FailedBrowserOfferRecoveryError(
      "Call offer can no longer be replaced",
      409,
    );
  }
}

function targetFingerprint(input: FailedBrowserOfferRecoveryInput) {
  return JSON.stringify({
    agentSessionId: input.agentSessionId,
    callId: input.callId,
    callLegId: input.callLegId,
    clientInstanceId: input.clientInstanceId,
    reason: input.reason,
    recoveryGeneration: input.recoveryGeneration,
  });
}

export function replaceFailedBrowserOffer(
  store: FailedBrowserOfferRecoveryStore,
  actor: QueueAccessActor,
  input: FailedBrowserOfferRecoveryInput,
  now = new Date(),
): Promise<FailedBrowserOfferRecoveryReceipt> {
  return store.withTransaction(async (transaction) => {
    const receipt = await executeIdempotentOperation(
      transaction,
      {
        actorUserId: actor.userId,
        aggregateId: input.callId,
        aggregateType: "CALL",
        idempotencyKey: input.idempotencyKey,
        practiceId: actor.practiceId,
        targetFingerprint: targetFingerprint(input),
        type: BROWSER_OFFER_REPLACED_EVENT,
      },
      async () => {
        const context = await transaction.loadContext(actor, input);
        assertRecoverable(context, actor, input, now);
        const replacement = await transaction.createReplacement(context, input, now);
        return {
          callId: context.call.id,
          deadlineAt: context.call.deadlineAt!.toISOString(),
          ...replacement,
          oldCallLegId: context.leg.id,
          operationType: "BROWSER_OFFER_REPLACEMENT",
          reason: input.reason,
        };
      },
      now,
    );
    return receipt as FailedBrowserOfferRecoveryReceipt;
  });
}

export async function recoverFailedBrowserOffer(
  store: FailedBrowserOfferRecoveryStore,
  actor: QueueAccessActor,
  input: FailedBrowserOfferRecoveryInput,
  now = new Date(),
  dispatch: typeof dispatchProviderCommand = dispatchProviderCommand,
) {
  const receipt = await replaceFailedBrowserOffer(store, actor, input, now);
  await dispatchProviderCommandGraph({
    commandIds: [receipt.hangupCommandId, receipt.dialCommandId],
    dispatch,
  });
  return receipt;
}
