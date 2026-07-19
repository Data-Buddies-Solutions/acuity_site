import {
  executeIdempotentOperation,
  type OperationReceipt,
  type OperationReceiptTransaction,
} from "@/lib/call-center/application/operation-receipts";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

export const CALL_TRANSFER_REQUESTED_EVENT = "CALL_TRANSFER_REQUESTED";

export type TransferAgentCallInput = {
  callId: string;
  clientInstanceId: string;
  expectedStateVersion: number;
  idempotencyKey: string;
  targetEndpointId: string;
};

export type TransferAgentCallReceipt = OperationReceipt & {
  callId: string;
  commandId: string;
  operationType: "TRANSFER";
  sourceLegId: string;
  stateVersion: number;
  status: "PENDING";
  targetEndpointId: string;
  targetLegId: string;
};

export type TransferTarget = {
  endpointId: string;
  label: string;
};

export interface TransferAgentCallTransaction extends OperationReceiptTransaction {
  saveTransfer(
    actor: QueueAccessActor,
    input: TransferAgentCallInput,
    now: Date,
  ): Promise<{
    callId: string;
    commandId: string;
    operationType: "TRANSFER";
    sourceLegId: string;
    stateVersion: number;
    status: "PENDING";
    targetEndpointId: string;
    targetLegId: string;
  }>;
}

export interface TransferAgentCallStore {
  listTargets(
    actor: QueueAccessActor,
    input: Pick<TransferAgentCallInput, "callId" | "clientInstanceId">,
    now: Date,
  ): Promise<TransferTarget[]>;
  transaction<T>(
    operation: (transaction: TransferAgentCallTransaction) => Promise<T>,
  ): Promise<T>;
}

export class TransferAgentCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TransferAgentCallError";
  }
}

export function transferAgentCall(
  store: TransferAgentCallStore,
  actor: QueueAccessActor,
  input: TransferAgentCallInput,
  now = new Date(),
): Promise<TransferAgentCallReceipt> {
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
          clientInstanceId: input.clientInstanceId,
          targetEndpointId: input.targetEndpointId,
        }),
        type: CALL_TRANSFER_REQUESTED_EVENT,
      },
      (current) => current.saveTransfer(actor, input, now),
      now,
    ),
  ) as Promise<TransferAgentCallReceipt>;
}

export function listTransferTargets(
  store: TransferAgentCallStore,
  actor: QueueAccessActor,
  input: Pick<TransferAgentCallInput, "callId" | "clientInstanceId">,
  now = new Date(),
) {
  return store.listTargets(actor, input, now);
}
