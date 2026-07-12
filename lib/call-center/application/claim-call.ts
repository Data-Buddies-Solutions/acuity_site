import {
  executeIdempotentOperation,
  type OperationReceipt,
  type OperationReceiptData,
  type OperationReceiptTransaction,
} from "@/lib/call-center/application/operation-receipts";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

export const CALL_CLAIM_REQUESTED_EVENT = "CALL_CLAIM_REQUESTED";

export type ClaimCallInput = {
  callId: string;
  clientInstanceId: string;
  endpointId: string;
  expectedSessionStateVersion: number;
  idempotencyKey: string;
};

export interface ClaimCallTransaction extends OperationReceiptTransaction {
  createClaim(
    actor: QueueAccessActor,
    input: ClaimCallInput,
    now: Date,
  ): Promise<OperationReceiptData>;
}

export interface ClaimCallStore {
  transaction<T>(
    operation: (transaction: ClaimCallTransaction) => Promise<T>,
  ): Promise<T>;
}

export class ClaimCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ClaimCallError";
  }
}

function targetFingerprint(input: ClaimCallInput) {
  return JSON.stringify({
    callId: input.callId,
    clientInstanceId: input.clientInstanceId,
    endpointId: input.endpointId,
  });
}

/**
 * Records one manual claim intent and its provider command atomically. The
 * operation receipt owns HTTP replay; the command owns provider-effect replay.
 */
export function claimCall(
  store: ClaimCallStore,
  actor: QueueAccessActor,
  input: ClaimCallInput,
  now = new Date(),
): Promise<OperationReceipt> {
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
        type: CALL_CLAIM_REQUESTED_EVENT,
      },
      (current) => current.createClaim(actor, input, now),
      now,
    ),
  );
}
