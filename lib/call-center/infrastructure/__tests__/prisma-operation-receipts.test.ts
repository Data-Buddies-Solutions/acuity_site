import { describe, expect, it } from "bun:test";

import { executeIdempotentOperation } from "@/lib/call-center/application/operation-receipts";
import {
  PrismaOperationReceiptTransaction,
  type OperationReceiptPrismaTransaction,
} from "../prisma-operation-receipts";

describe("Prisma durable operation receipts", () => {
  it("locks the key and commits the operation receipt through one transaction", async () => {
    const operations: string[] = [];
    let lockKey: unknown;
    const transaction = {
      $executeRaw: async (query: { values: unknown[] }) => {
        operations.push("receipt.lock");
        [lockKey] = query.values;
        return 1;
      },
      callCenterEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          operations.push("receipt.create");
          return {
            actorUserId: data.actorUserId,
            aggregateId: data.aggregateId,
            aggregateType: data.aggregateType,
            data: data.data,
            occurredAt: data.occurredAt,
            revision: BigInt(7),
          };
        },
        findUnique: async () => {
          operations.push("receipt.find");
          return null;
        },
      },
    } as unknown as OperationReceiptPrismaTransaction;
    const receiptTransaction = Object.assign(
      new PrismaOperationReceiptTransaction(transaction),
      {
        createCommand: async () => {
          operations.push("command.create");
          return { id: "command-1" };
        },
      },
    );

    const receipt = await executeIdempotentOperation(
      receiptTransaction,
      {
        actorUserId: "user-1",
        aggregateId: "call-1",
        aggregateType: "CALL",
        idempotencyKey: "request-1",
        practiceId: "practice-1",
        targetFingerprint: "call-1:endpoint-1",
        type: "CALL_CLAIM_REQUESTED",
      },
      async ({ createCommand }) => {
        const command = await createCommand();
        return { callId: "call-1", commandId: command.id };
      },
      new Date("2026-07-12T12:00:00.000Z"),
    );

    expect(receipt).toMatchObject({
      callId: "call-1",
      commandId: "command-1",
      replayed: false,
      revision: "7",
    });
    expect(operations).toEqual([
      "receipt.lock",
      "receipt.find",
      "command.create",
      "receipt.create",
    ]);
    expect(lockKey).toBe('["practice-1","CALL_CLAIM_REQUESTED","request-1"]');
    expect(String(lockKey)).not.toContain("\u0000");
  });
});
