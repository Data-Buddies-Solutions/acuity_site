import {
  executeIdempotentOperation,
  type OperationReceipt,
  type OperationReceiptData,
  type OperationReceiptTransaction,
} from "@/lib/call-center/application/operation-receipts";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

export const CALL_END_REQUESTED_EVENT = "CALL_END_REQUESTED";

export type EndCallInput = {
  callId: string;
  clientInstanceId: string;
  idempotencyKey: string;
};

export type EndCallReceipt = OperationReceipt & {
  callId: string;
  commandIdsJson: string;
  status: "ABANDONED" | "COMPLETED" | "REJECTED";
};

export interface EndCallTransaction extends OperationReceiptTransaction {
  endCall(
    actor: QueueAccessActor,
    input: EndCallInput,
    now: Date,
  ): Promise<OperationReceiptData>;
}

export interface EndCallStore {
  transaction<T>(operation: (transaction: EndCallTransaction) => Promise<T>): Promise<T>;
}

export class EndCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "EndCallError";
  }
}

function targetFingerprint(input: EndCallInput) {
  return JSON.stringify({
    callId: input.callId,
    clientInstanceId: input.clientInstanceId,
  });
}

export function endCall(
  store: EndCallStore,
  actor: QueueAccessActor,
  input: EndCallInput,
  now = new Date(),
): Promise<EndCallReceipt> {
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
        type: CALL_END_REQUESTED_EVENT,
      },
      (current) => current.endCall(actor, input, now),
      now,
    ),
  ) as Promise<EndCallReceipt>;
}
