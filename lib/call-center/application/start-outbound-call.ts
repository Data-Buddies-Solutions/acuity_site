import {
  executeIdempotentCreation,
  type OperationReceipt,
  type OperationReceiptData,
  type OperationReceiptTransaction,
} from "@/lib/call-center/application/operation-receipts";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

export const CALL_OUTBOUND_REQUESTED_EVENT = "CALL_OUTBOUND_REQUESTED";

export type StartOutboundCallInput = {
  clientInstanceId: string;
  destination: string;
  idempotencyKey: string;
  numberId: string;
  queueId: string;
};

export type StartOutboundCallReceipt = OperationReceipt & {
  agentSessionId: string;
  callId: string;
  cleanupCommandIds?: string;
  clientState: string;
  endpointId: string;
  from: string;
  legId: string;
  operationType: "OUTBOUND";
  stateVersion: number;
  status: "CONFIRMED";
  to: string;
};

export type StartOutboundCallResponse = Omit<
  StartOutboundCallReceipt,
  "cleanupCommandIds"
>;

export interface StartOutboundCallTransaction extends OperationReceiptTransaction {
  createOutboundCall(
    actor: QueueAccessActor,
    input: StartOutboundCallInput,
    now: Date,
  ): Promise<{ aggregateId: string; data: OperationReceiptData }>;
}

export interface StartOutboundCallStore {
  transaction<T>(
    operation: (transaction: StartOutboundCallTransaction) => Promise<T>,
  ): Promise<T>;
}

export class StartOutboundCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StartOutboundCallError";
  }
}

function targetFingerprint(input: StartOutboundCallInput) {
  return JSON.stringify({
    clientInstanceId: input.clientInstanceId,
    destination: input.destination,
    numberId: input.numberId,
    queueId: input.queueId,
  });
}

/** Persists the complete outbound intent before the browser starts media. */
export function startOutboundCall(
  store: StartOutboundCallStore,
  actor: QueueAccessActor,
  input: StartOutboundCallInput,
  now = new Date(),
): Promise<StartOutboundCallReceipt> {
  return store.transaction((transaction) =>
    executeIdempotentCreation(
      transaction,
      {
        actorUserId: actor.userId,
        aggregateType: "CALL",
        idempotencyKey: input.idempotencyKey,
        practiceId: actor.practiceId,
        targetFingerprint: targetFingerprint(input),
        type: CALL_OUTBOUND_REQUESTED_EVENT,
      },
      (current) => current.createOutboundCall(actor, input, now),
      now,
    ),
  ) as Promise<StartOutboundCallReceipt>;
}
