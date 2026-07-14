import { describe, expect, it } from "bun:test";

import { settleCanonicalCallLegs } from "../prisma-call-resource-settlement";

const now = new Date("2026-07-14T12:00:00.000Z");

describe("canonical call resource settlement", () => {
  it("terminalizes and releases a failed transfer target exactly once", async () => {
    const call = {
      deadlineAt: new Date("2026-07-14T12:00:30.000Z") as Date | null,
      practiceId: "practice-1",
      stateVersion: 3,
      status: "CONNECTED",
      winningLegId: "source-leg",
    };
    const leg = {
      agentSessionId: "target-session",
      errorCode: null as string | null,
      id: "target-leg",
      providerCallControlId: "target-control",
      status: "RINGING",
    };
    const session = {
      audioReady: true,
      connectionState: "READY",
      currentCallId: null as string | null,
      endpointId: "target-endpoint",
      id: "target-session",
      leaseExpiresAt: new Date("2026-07-14T12:01:00.000Z"),
      microphoneReady: true,
      offeredCallId: "call-1" as string | null,
      practiceId: "practice-1",
      presence: "BUSY",
      readyAt: null as Date | null,
      stateVersion: 4,
    };
    let hangup: { id: string } | null = null;
    let hangupCreates = 0;
    let releaseEvents = 0;
    const transaction = {
      $queryRaw: async () => [],
      callCenterAgentSession: {
        findUnique: async () => ({ ...session }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          session.currentCallId = data.currentCallId as string | null;
          session.offeredCallId = data.offeredCallId as string | null;
          session.presence = data.presence as string;
          session.readyAt = data.readyAt as Date | null;
          session.stateVersion += 1;
          return { stateVersion: session.stateVersion };
        },
      },
      callCenterCall: {
        findUnique: async ({ select }: { select: Record<string, boolean> }) =>
          select.practiceId
            ? { practiceId: call.practiceId }
            : {
                deadlineAt: call.deadlineAt,
                status: call.status,
                winningLegId: call.winningLegId,
              },
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          if (data.deadlineAt === null && call.deadlineAt) {
            call.deadlineAt = null;
            call.stateVersion += 1;
            return { count: 1 };
          }
          return { count: 0 };
        },
      },
      callCenterCallLeg: {
        findFirst: async () => null,
        findMany: async () => [{ ...leg }],
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          if (["ENDED", "FAILED"].includes(leg.status)) return { count: 0 };
          leg.status = data.status as string;
          leg.errorCode = data.errorCode as string;
          return { count: 1 };
        },
      },
      callCenterCommand: {
        findFirst: async () => hangup,
        findMany: async () => [],
        upsert: async () => {
          hangupCreates += 1;
          hangup = { id: "hangup-target" };
          return hangup;
        },
      },
      callCenterEvent: {
        create: async () => {
          releaseEvents += 1;
          return { revision: BigInt(releaseEvents) };
        },
      },
    };

    const input = {
      callId: "call-1",
      legIds: ["target-leg"],
      now,
      reason: "TRANSFER_TIMEOUT",
    } as const;
    const first = await settleCanonicalCallLegs(transaction as never, input);
    const replay = await settleCanonicalCallLegs(transaction as never, input);

    expect(first).toEqual(["hangup-target"]);
    expect(replay).toEqual([]);
    expect(hangupCreates).toBe(1);
    expect(leg).toMatchObject({ errorCode: "TRANSFER_TIMEOUT", status: "ENDED" });
    expect(session).toMatchObject({
      currentCallId: null,
      offeredCallId: null,
      presence: "AVAILABLE",
    });
    expect(call).toMatchObject({ deadlineAt: null, stateVersion: 4 });
    expect(releaseEvents).toBe(1);
  });
});
