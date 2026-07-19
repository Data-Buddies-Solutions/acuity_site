import { describe, expect, it } from "bun:test";

import { settleCanonicalCallLegs } from "../prisma-call-resource-settlement";

const now = new Date("2026-07-19T12:00:20.000Z");

describe("canonical call resource settlement", () => {
  it("completes a deferred source hangup when target settlement fails its transfer", async () => {
    let commandReads = 0;
    let legReads = 0;
    const completedCalls: unknown[] = [];
    const transaction = {
      callCenterCall: {
        findFirst: async () => ({
          direction: "INBOUND",
          id: "call-1",
          legs: [{ endedAt: new Date(now.getTime() - 1_000), status: "ENDED" }],
          status: "CONNECTED",
          winningLegId: "source-leg",
        }),
        findUnique: async () => ({ practiceId: "practice-1" }),
        update: async () => ({}),
        updateMany: async (input: unknown) => {
          completedCalls.push(input);
          return { count: 1 };
        },
      },
      callCenterCallLeg: {
        findMany: async () => {
          legReads += 1;
          return legReads === 1
            ? [
                {
                  id: "target-leg",
                  providerCallControlId: null,
                  status: "RINGING",
                },
              ]
            : [];
        },
        updateMany: async () => ({ count: 1 }),
      },
      callCenterCommand: {
        findMany: async () => {
          commandReads += 1;
          return commandReads === 1
            ? [
                {
                  attemptCount: 1,
                  callId: "call-1",
                  id: "transfer-1",
                  leg: { id: "target-leg" },
                  practiceId: "practice-1",
                  status: "SENT",
                  type: "TRANSFER_AGENT",
                },
              ]
            : [];
        },
        findUnique: async () => ({
          arguments: { sourceLegId: "source-leg" },
          callId: "call-1",
          practiceId: "practice-1",
          status: "FAILED",
          type: "TRANSFER_AGENT",
        }),
        updateMany: async () => ({ count: 1 }),
      },
      callCenterEvent: {
        upsert: async () => ({ revision: BigInt(1) }),
      },
    };

    await expect(
      settleCanonicalCallLegs(transaction as never, {
        callId: "call-1",
        legIds: ["target-leg"],
        now,
        reason: "AGENT_STARTED_OUTBOUND",
      }),
    ).resolves.toEqual([]);
    expect(completedCalls).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
        where: expect.objectContaining({ winningLegId: "source-leg" }),
      }),
    ]);
  });
});
