import { describe, expect, it } from "bun:test";

import { PrismaOutboundInitiationRecovery } from "../prisma-outbound-initiation-recovery";

const now = new Date("2026-07-12T20:00:00.000Z");

function fakeRecovery(currentCallId: string | null = "call-1") {
  let due = true;
  let releasedCallId = currentCallId;
  const events: Array<{ data: Record<string, unknown> }> = [];
  const transaction = {
    $queryRaw: async (query: unknown) => {
      const sql = Array.isArray((query as { strings?: string[] }).strings)
        ? (query as { strings: string[] }).strings.join(" ")
        : "";
      if (sql.includes('FROM "call_center_call" AS call')) {
        return due ? [{ callId: "call-1", practiceId: "practice-1" }] : [];
      }
      return [];
    },
    callCenterAgentSession: {
      findUnique: async ({ select }: { select: Record<string, boolean> }) =>
        "endpointId" in select
          ? { endpointId: "endpoint-1" }
          : {
              audioReady: true,
              connectionState: "READY",
              currentCallId: releasedCallId,
              id: "session-1",
              leaseExpiresAt: new Date("2026-07-12T20:01:00.000Z"),
              microphoneReady: true,
              practiceId: "practice-1",
              presence: "BUSY",
              stateVersion: 4,
            },
      update: async () => {
        releasedCallId = null;
        return { stateVersion: 5 };
      },
    },
    callCenterCall: {
      updateMany: async () => {
        if (!due) return { count: 0 };
        due = false;
        return { count: 1 };
      },
    },
    callCenterCallLeg: {
      findMany: async () => [{ agentSessionId: "session-1", id: "leg-1" }],
      updateMany: async () => ({ count: 1 }),
    },
    callCenterEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push({ data });
        return data;
      },
    },
  };
  return {
    events,
    releasedCallId: () => releasedCallId,
    recovery: new PrismaOutboundInitiationRecovery((operation) =>
      operation(transaction as never),
    ),
  };
}

describe("outbound initiation recovery", () => {
  it("terminalizes a no-callback intent and releases its owned session once", async () => {
    const fake = fakeRecovery();

    await expect(fake.recovery.recoverDue(now, 25)).resolves.toEqual({
      callIds: ["call-1"],
      recovered: 1,
    });
    expect(fake.releasedCallId()).toBeNull();
    expect(fake.events.map(({ data }) => data.type)).toEqual([
      "AGENT_SESSION_CALL_RELEASED",
      "CALL_OUTBOUND_INITIATION_FAILED",
    ]);
    await expect(fake.recovery.recoverDue(now, 25)).resolves.toEqual({
      callIds: [],
      recovered: 0,
    });
  });

  it("does not release a session that now owns another call", async () => {
    const fake = fakeRecovery("call-2");

    await fake.recovery.recoverDue(now, 1);

    expect(fake.releasedCallId()).toBe("call-2");
    expect(fake.events.map(({ data }) => data.type)).toEqual([
      "CALL_OUTBOUND_INITIATION_FAILED",
    ]);
  });
});
