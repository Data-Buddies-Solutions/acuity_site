import { describe, expect, it } from "bun:test";

import {
  forceTerminalDueInboundCallInTransaction,
  recoverDueOutboundCallInTransaction,
} from "../prisma-overdue-call-recovery";

describe("overdue outbound call recovery", () => {
  it("terminalizes an outbound call that never receives provider lifecycle evidence", async () => {
    const now = new Date("2026-07-25T12:01:00.000Z");
    const events: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const settlements: Record<string, unknown>[] = [];
    const transaction = {
      $queryRaw: async () => [],
      callCenterCall: {
        findFirst: async () => ({
          deadlineAt: new Date("2026-07-25T12:00:30.000Z"),
          direction: "OUTBOUND",
          hardDeadlineAt: null,
          id: "call-1",
          practiceId: "practice-1",
          status: "RECEIVED",
        }),
        update: async (input: Record<string, unknown>) => {
          updates.push(input);
        },
      },
      callCenterEvent: {
        upsert: async (input: Record<string, unknown>) => {
          events.push(input);
        },
      },
    };

    await expect(
      recoverDueOutboundCallInTransaction(
        transaction as never,
        {
          callId: "call-1",
          direction: "OUTBOUND",
          practiceId: "practice-1",
          status: "RECEIVED",
        },
        now,
        async (_transaction, input) => {
          settlements.push(input as never);
          return ["hangup-1"];
        },
      ),
    ).resolves.toEqual({ status: "APPLIED" });

    expect(settlements).toEqual([
      expect.objectContaining({
        callId: "call-1",
        includeCustomerLegs: true,
        reason: "OUTBOUND_DEADLINE_EXPIRED",
      }),
    ]);
    expect(updates).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ endedAt: now, status: "FAILED" }),
      }),
    ]);
    expect(events).toEqual([
      expect.objectContaining({
        create: expect.objectContaining({ type: "CALL_OUTBOUND_DEADLINE_EXPIRED" }),
      }),
    ]);
  });

  it("terminalizes an overdue voicemail and upserts one missed-call action", async () => {
    const now = new Date("2026-07-25T12:05:00.000Z");
    const tasks: Record<string, unknown>[] = [];
    const transaction = {
      callCenterCall: {
        findFirst: async () => ({
          deadlineAt: new Date("2026-07-25T12:04:00.000Z"),
          direction: "INBOUND",
          hardDeadlineAt: null,
          id: "call-1",
          practiceId: "practice-1",
          status: "VOICEMAIL",
        }),
        update: async () => undefined,
      },
      callCenterEvent: {
        upsert: async (input: Record<string, unknown>) => {
          if (
            (input.create as { type?: string } | undefined)?.type ===
            "CALL_VOICEMAIL_DEADLINE_EXPIRED"
          ) {
            return { revision: BigInt(42) };
          }
          return { revision: BigInt(43) };
        },
      },
      callCenterTask: {
        upsert: async (input: Record<string, unknown>) => {
          tasks.push(input);
          return { id: "task-1" };
        },
      },
    };

    await expect(
      forceTerminalDueInboundCallInTransaction(
        transaction as never,
        {
          callId: "call-1",
          direction: "INBOUND",
          practiceId: "practice-1",
          status: "VOICEMAIL",
        },
        now,
        "VOICEMAIL_DEADLINE_EXPIRED",
        async () => ["hangup-1"],
      ),
    ).resolves.toEqual({ status: "APPLIED" });

    expect(tasks).toEqual([
      expect.objectContaining({
        create: expect.objectContaining({
          dedupeKey: "voicemail:call-1",
          kind: "MISSED_CALL",
          sourceEventRevision: BigInt(42),
        }),
      }),
    ]);
  });
});
