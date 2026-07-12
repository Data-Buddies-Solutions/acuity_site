import {
  executeIdempotentOperation,
  type OperationReceipt,
  type OperationReceiptData,
  type OperationReceiptTransaction,
} from "@/lib/call-center/application/operation-receipts";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

export const CALL_TRANSFER_REQUESTED_EVENT = "CALL_TRANSFER_REQUESTED";

export type TransferCallInput = {
  callId: string;
  idempotencyKey: string;
  targetEndpointId: string;
};

export type TransferCallReceipt = OperationReceipt & {
  callId: string;
  operationType: "TRANSFER";
  providerCommandId: string;
  sourceLegId: string;
  stateVersion: number;
  status: "PENDING" | "SENT" | "CONFIRMED" | "FAILED";
  targetAgentSessionId: string;
  targetEndpointId: string;
  targetLegId: string;
};

export interface TransferCallTransaction extends OperationReceiptTransaction {
  createTransfer(
    actor: QueueAccessActor,
    input: TransferCallInput,
    now: Date,
  ): Promise<OperationReceiptData>;
}

export interface TransferCallStore {
  transaction<T>(
    operation: (transaction: TransferCallTransaction) => Promise<T>,
  ): Promise<T>;
}

export class TransferCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TransferCallError";
  }
}

function targetFingerprint(input: TransferCallInput) {
  return JSON.stringify({
    callId: input.callId,
    targetEndpointId: input.targetEndpointId,
  });
}

export function transferCall(
  store: TransferCallStore,
  actor: QueueAccessActor,
  input: TransferCallInput,
  now = new Date(),
): Promise<TransferCallReceipt> {
  return store.transaction((transaction) =>
    executeIdempotentOperation(
      transaction,
      {
        actorUserId: actor.userId,
        aggregateId: input.callId,
        aggregateType: "CALL",
        idempotencyKey: input.idempotencyKey,
        practiceId: actor.practiceId,
        targetFingerprint: targetFingerprint(input),
        type: CALL_TRANSFER_REQUESTED_EVENT,
      },
      (current) => current.createTransfer(actor, input, now),
      now,
    ),
  ) as Promise<TransferCallReceipt>;
}
