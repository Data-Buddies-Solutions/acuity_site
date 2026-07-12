import { describe, expect, it } from "bun:test";

import {
  executeIdempotentOperation,
  OperationReceiptError,
  type OperationReceiptData,
  type OperationReceiptEvent,
  type OperationReceiptInput,
  type OperationReceiptTransaction,
} from "../operation-receipts";

const now = new Date("2026-07-12T12:00:00.000Z");
const input: OperationReceiptInput = {
  actorUserId: "user-1",
  aggregateId: "call-1",
  aggregateType: "CALL",
  idempotencyKey: "request-1",
  practiceId: "practice-1",
  targetFingerprint: "call-1:endpoint-1",
  type: "CALL_CLAIM_REQUESTED",
};

class MemoryOperationTransaction implements OperationReceiptTransaction {
  appendCount = 0;
  performCount = 0;
  private event: OperationReceiptEvent | null = null;

  async appendReceipt(
    receiptInput: OperationReceiptInput,
    data: OperationReceiptData,
    occurredAt: Date,
  ) {
    this.appendCount += 1;
    this.event = {
      aggregateId: receiptInput.aggregateId,
      aggregateType: receiptInput.aggregateType,
      data,
      occurredAt,
      revision: BigInt(42),
    };
    return this.event;
  }

  async findReceipt() {
    return this.event;
  }

  async lockReceiptKey() {}
}

class MemoryOperationDatabase {
  appendCount = 0;
  event: OperationReceiptEvent | null = null;
  performCount = 0;
  private tail = Promise.resolve();

  async run() {
    const previous = this.tail;
    let release = () => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    const database = this;
    const transaction: OperationReceiptTransaction = {
      appendReceipt: async (receiptInput, data, occurredAt) => {
        database.appendCount += 1;
        database.event = {
          aggregateId: receiptInput.aggregateId,
          aggregateType: receiptInput.aggregateType,
          data,
          occurredAt,
          revision: BigInt(42),
        };
        return database.event;
      },
      findReceipt: async () => database.event,
      lockReceiptKey: async () => previous,
    };

    try {
      return await executeIdempotentOperation(
        transaction,
        input,
        async () => {
          database.performCount += 1;
          await Promise.resolve();
          return { callId: "call-1", commandId: "command-1" };
        },
        now,
      );
    } finally {
      release();
    }
  }
}

describe("durable operation receipts", () => {
  it("runs once and replays the original sanitized receipt", async () => {
    const transaction = new MemoryOperationTransaction();
    const perform = async () => {
      transaction.performCount += 1;
      return { callId: "call-1", commandId: "command-1" };
    };

    const first = await executeIdempotentOperation(transaction, input, perform, now);
    const replay = await executeIdempotentOperation(
      transaction,
      input,
      perform,
      new Date(now.getTime() + 10_000),
    );

    expect(first).toEqual({
      callId: "call-1",
      commandId: "command-1",
      occurredAt: now.toISOString(),
      replayed: false,
      revision: "42",
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(transaction.performCount).toBe(1);
    expect(transaction.appendCount).toBe(1);
  });

  it("rejects reuse for another target before running the operation", async () => {
    const transaction = new MemoryOperationTransaction();
    await executeIdempotentOperation(transaction, input, async () => ({ ok: true }), now);

    const conflicting = {
      ...input,
      targetFingerprint: "call-1:endpoint-2",
    };
    await expect(
      executeIdempotentOperation(transaction, conflicting, async () => {
        throw new Error("must not run");
      }),
    ).rejects.toEqual(
      new OperationReceiptError(
        "Idempotency key was already used for another target",
        409,
      ),
    );
  });

  it("serializes concurrent retries into one operation and one receipt", async () => {
    const database = new MemoryOperationDatabase();
    const receipts = await Promise.all(Array.from({ length: 12 }, () => database.run()));

    expect(database.performCount).toBe(1);
    expect(database.appendCount).toBe(1);
    expect(receipts.filter(({ replayed }) => !replayed)).toHaveLength(1);
    expect(receipts.every(({ revision }) => revision === "42")).toBe(true);
  });
});
