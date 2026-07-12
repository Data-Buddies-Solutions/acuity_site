import { describe, expect, it } from "bun:test";

import type { Prisma } from "@/generated/prisma/client";

import { appendCommandOperationStatus } from "../prisma-command-operation-events";

describe("canonical command operation events", () => {
  it("links a command status to the original operation revision", async () => {
    const created: Array<Record<string, unknown>> = [];
    const transaction = {
      callCenterCommand: {
        findUnique: async () => ({
          callId: "call-1",
          practiceId: "practice-1",
          type: "DIAL_AGENT",
        }),
      },
      callCenterEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { revision: BigInt(44) };
        },
        findMany: async () => [
          { actorUserId: "user-1", revision: BigInt(42) },
          { actorUserId: "user-1", revision: BigInt(43) },
        ],
      },
    } as unknown as Prisma.TransactionClient;

    await appendCommandOperationStatus(transaction, {
      attemptCount: 1,
      commandId: "command-1",
      now: new Date("2026-07-12T12:00:00.000Z"),
      status: "SENT",
    });

    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      actorUserId: "user-1",
      aggregateId: "call-1",
      data: {
        operationEventRevision: "42",
        providerCommandId: "command-1",
        status: "SENT",
      },
      idempotencyKey: "command-1:42:SENT:1",
      type: "CALL_OPERATION_STATUS_CHANGED",
    });
    expect(created[1]).toMatchObject({
      data: { operationEventRevision: "43", status: "SENT" },
      idempotencyKey: "command-1:43:SENT:1",
    });
  });

  it("does nothing for a command without a user operation", async () => {
    let creates = 0;
    const transaction = {
      callCenterCommand: {
        findUnique: async () => ({
          callId: "call-1",
          practiceId: "practice-1",
          type: "DIAL_AGENT",
        }),
      },
      callCenterEvent: {
        create: async () => {
          creates += 1;
        },
        findMany: async () => [],
      },
    } as unknown as Prisma.TransactionClient;

    await appendCommandOperationStatus(transaction, {
      attemptCount: 1,
      commandId: "command-1",
      now: new Date(),
      status: "FAILED",
    });
    expect(creates).toBe(0);
  });
});
