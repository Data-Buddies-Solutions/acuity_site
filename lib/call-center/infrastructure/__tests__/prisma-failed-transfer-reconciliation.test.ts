import { describe, expect, it } from "bun:test";

import { reconcileFailedTransferWithEndedSource } from "../prisma-failed-transfer-reconciliation";

const now = new Date("2026-07-19T12:00:20.000Z");

function transaction(
  sourceStatus: "BRIDGED" | "ENDED",
  {
    direction = "INBOUND",
    winningLegId = "source-leg",
  }: { direction?: "INBOUND" | "OUTBOUND"; winningLegId?: string | null } = {},
) {
  const updates: unknown[] = [];
  return {
    tx: {
      callCenterCall: {
        findFirst: async () => ({
          id: "call-1",
          direction,
          legs: [
            {
              endedAt: sourceStatus === "ENDED" ? new Date(now.getTime() - 1_000) : null,
              status: sourceStatus,
            },
          ],
          status: "CONNECTED",
          winningLegId,
        }),
        updateMany: async (input: unknown) => {
          updates.push(input);
          return { count: 1 };
        },
      },
      callCenterCallLeg: {
        findMany: async () => [],
      },
      callCenterCommand: {
        findUnique: async () => ({
          arguments: { sourceLegId: "source-leg" },
          callId: "call-1",
          practiceId: "practice-1",
          status: "FAILED",
          type: "TRANSFER_AGENT",
        }),
      },
    },
    updates,
  };
}

describe("failed transfer reconciliation", () => {
  it("completes a call whose deferred source hangup can no longer transfer", async () => {
    const fake = transaction("ENDED");
    await expect(
      reconcileFailedTransferWithEndedSource(
        fake.tx as never,
        {
          commandId: "transfer-1",
          now,
        },
        async () => [],
      ),
    ).resolves.toEqual({ commandIds: [], completed: true });
    expect(fake.updates).toHaveLength(1);
  });

  it("completes a direct outbound call with no winner after its source ends", async () => {
    const fake = transaction("ENDED", { direction: "OUTBOUND", winningLegId: null });
    await expect(
      reconcileFailedTransferWithEndedSource(
        fake.tx as never,
        {
          commandId: "transfer-1",
          now,
        },
        async () => [],
      ),
    ).resolves.toEqual({ commandIds: [], completed: true });
    expect(fake.updates[0]).toMatchObject({
      where: {
        OR: [{ winningLegId: "source-leg" }, { winningLegId: null }],
      },
    });
  });

  it("keeps the original call active when its source remains connected", async () => {
    const fake = transaction("BRIDGED");
    await expect(
      reconcileFailedTransferWithEndedSource(
        fake.tx as never,
        {
          commandId: "transfer-1",
          now,
        },
        async () => [],
      ),
    ).resolves.toEqual({ commandIds: [], completed: false });
    expect(fake.updates).toHaveLength(0);
  });
});
