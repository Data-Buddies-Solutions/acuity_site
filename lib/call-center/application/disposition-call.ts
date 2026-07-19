import {
  executeIdempotentOperation,
  type OperationReceipt,
  type OperationReceiptTransaction,
} from "@/lib/call-center/application/operation-receipts";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

const CALL_DISPOSITION_REQUESTED_EVENT = "CALL_DISPOSITION_REQUESTED";

type CallDisposition =
  "RESOLVED" | "CALLBACK_NEEDED" | "FOLLOW_UP_REQUIRED" | "WRONG_NUMBER" | "OTHER";

export type DispositionCallInput = {
  callId: string;
  disposition: CallDisposition;
  expectedStateVersion: number;
  idempotencyKey: string;
  note: string | null;
  taskIds: string[];
};

export type DispositionCallReceipt = OperationReceipt & {
  callId: string;
  operationType: "DISPOSITION";
  resolvedTaskCount: number;
  stateVersion: number;
  status: "CONFIRMED";
};

export interface DispositionCallTransaction extends OperationReceiptTransaction {
  saveDisposition(
    actor: QueueAccessActor,
    input: DispositionCallInput,
    now: Date,
  ): Promise<{
    callId: string;
    operationType: "DISPOSITION";
    resolvedTaskCount: number;
    stateVersion: number;
    status: "CONFIRMED";
  }>;
}

export interface DispositionCallStore {
  transaction<T>(
    operation: (transaction: DispositionCallTransaction) => Promise<T>,
  ): Promise<T>;
}

export class DispositionCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DispositionCallError";
  }
}

export function dispositionCall(
  store: DispositionCallStore,
  actor: QueueAccessActor,
  input: DispositionCallInput,
  now = new Date(),
): Promise<DispositionCallReceipt> {
  return store.transaction((transaction) =>
    executeIdempotentOperation(
      transaction,
      {
        actorUserId: actor.userId,
        aggregateId: input.callId,
        aggregateType: "CALL",
        idempotencyKey: input.idempotencyKey,
        practiceId: actor.practiceId,
        targetFingerprint: JSON.stringify({
          callId: input.callId,
          disposition: input.disposition,
          note: input.note,
          taskIds: [...input.taskIds].sort(),
        }),
        type: CALL_DISPOSITION_REQUESTED_EVENT,
      },
      (current) => current.saveDisposition(actor, input, now),
      now,
    ),
  ) as Promise<DispositionCallReceipt>;
}
