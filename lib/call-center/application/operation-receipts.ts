export type OperationReceiptData = Record<string, boolean | number | string | null>;

export type OperationReceiptEvent = {
  aggregateId: string;
  aggregateType: "CALL" | "AGENT_SESSION" | "TASK" | "CONFIGURATION";
  actorUserId: string | null;
  data: OperationReceiptData;
  occurredAt: Date;
  revision: bigint;
};

export type OperationReceiptInput = {
  actorUserId: string;
  aggregateId: string;
  aggregateType: OperationReceiptEvent["aggregateType"];
  idempotencyKey: string;
  practiceId: string;
  targetFingerprint: string;
  type: string;
};

const TARGET_FINGERPRINT_FIELD = "operationTargetFingerprint";

export interface OperationReceiptTransaction {
  appendReceipt(
    input: OperationReceiptInput,
    data: OperationReceiptData,
    now: Date,
  ): Promise<OperationReceiptEvent>;
  findReceipt(
    practiceId: string,
    type: string,
    idempotencyKey: string,
  ): Promise<OperationReceiptEvent | null>;
  lockReceiptKey(practiceId: string, type: string, idempotencyKey: string): Promise<void>;
}

export class OperationReceiptError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OperationReceiptError";
  }
}

export type OperationReceipt = OperationReceiptData & {
  occurredAt: string;
  replayed: boolean;
  revision: string;
};

function toReceipt(event: OperationReceiptEvent, replayed: boolean): OperationReceipt {
  const { [TARGET_FINGERPRINT_FIELD]: _fingerprint, ...data } = event.data;
  return {
    ...data,
    occurredAt: event.occurredAt.toISOString(),
    replayed,
    revision: event.revision.toString(),
  };
}

/**
 * Runs one authenticated operation and appends its receipt in the caller's
 * transaction. The key lock serializes retries even when two requests target
 * different aggregates. The callback must perform every state change and
 * durable provider-command insert through the same transaction object.
 */
export async function executeIdempotentOperation<
  TTransaction extends OperationReceiptTransaction,
>(
  transaction: TTransaction,
  input: OperationReceiptInput,
  perform: (transaction: TTransaction) => Promise<OperationReceiptData>,
  now = new Date(),
): Promise<OperationReceipt> {
  await transaction.lockReceiptKey(input.practiceId, input.type, input.idempotencyKey);
  const existing = await transaction.findReceipt(
    input.practiceId,
    input.type,
    input.idempotencyKey,
  );
  if (existing) {
    if (
      existing.aggregateType !== input.aggregateType ||
      existing.aggregateId !== input.aggregateId ||
      existing.actorUserId !== input.actorUserId ||
      existing.data[TARGET_FINGERPRINT_FIELD] !== input.targetFingerprint
    ) {
      throw new OperationReceiptError(
        "Idempotency key was already used for another target",
        409,
      );
    }
    return toReceipt(existing, true);
  }

  const data = await perform(transaction);
  const event = await transaction.appendReceipt(
    input,
    { ...data, [TARGET_FINGERPRINT_FIELD]: input.targetFingerprint },
    now,
  );
  return toReceipt(event, false);
}
