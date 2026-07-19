import { describe, expect, it } from "bun:test";

import type { FailedBrowserOfferRecoveryContext } from "../../application/replace-failed-browser-offer";
import { PrismaFailedBrowserOfferRecoveryTransaction } from "../prisma-failed-browser-offer-recovery";

const now = new Date("2026-07-19T12:00:10.000Z");
const context: FailedBrowserOfferRecoveryContext = {
  call: {
    deadlineAt: new Date("2026-07-19T12:00:20.000Z"),
    direction: "INBOUND",
    id: "call-1",
    practiceId: "practice-1",
    queueId: "queue-1",
    status: "RINGING",
    voicemailStartedAt: null,
    winningLegId: null,
  },
  leg: {
    agentSessionId: "session-1",
    attemptNumber: 1,
    endpointId: "endpoint-1",
    id: "leg-1",
    isCurrent: true,
    kind: "AGENT",
    providerCallControlId: "control-1",
    status: "RINGING",
  },
  session: {
    browserSessionId: "browser-1",
    endpointId: "endpoint-1",
    id: "session-1",
    leaseExpiresAt: new Date("2026-07-19T12:01:00.000Z"),
    userId: "user-1",
  },
};
const input = {
  agentSessionId: "session-1",
  callId: "call-1",
  callLegId: "leg-1",
  clientInstanceId: "browser-1",
  idempotencyKey: "recover-1",
  reason: "CALL_DOES_NOT_EXIST" as const,
  recoveryGeneration: 2,
};

describe("Prisma failed browser offer recovery", () => {
  it("writes one failed old leg and one dependent hangup-to-dial graph", async () => {
    const legWrites: Array<Record<string, unknown>> = [];
    const commandWrites: Array<Record<string, unknown>> = [];
    const callUpdates: Array<Record<string, unknown>> = [];
    const transaction = {
      callCenterCall: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          callUpdates.push(data);
          return { stateVersion: 8 };
        },
      },
      callCenterCallLeg: {
        aggregate: async () => ({ _max: { attemptNumber: 1 } }),
        create: async ({ data }: { data: Record<string, unknown> }) => {
          legWrites.push(data);
          return { id: "leg-2" };
        },
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          legWrites.push(data);
          return { count: 1 };
        },
      },
      callCenterCommand: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          commandWrites.push(data);
          return { id: commandWrites.length === 1 ? "hangup-1" : "dial-1" };
        },
      },
    };
    const recovery = new PrismaFailedBrowserOfferRecoveryTransaction(
      transaction as never,
    );

    await expect(recovery.createReplacement(context, input, now)).resolves.toEqual({
      dialCommandId: "dial-1",
      hangupCommandId: "hangup-1",
      newCallLegId: "leg-2",
      stateVersion: 8,
    });
    expect(legWrites).toEqual([
      { errorCode: "CALL_DOES_NOT_EXIST", status: "FAILED" },
      expect.objectContaining({
        agentSessionId: "session-1",
        attemptNumber: 2,
        callId: "call-1",
        endpointId: "endpoint-1",
        status: "CREATED",
      }),
    ]);
    expect(commandWrites).toEqual([
      expect.objectContaining({
        callId: "call-1",
        legId: "leg-1",
        type: "HANGUP_LEG",
      }),
      expect.objectContaining({
        callId: "call-1",
        dependsOnCommandId: "hangup-1",
        legId: "leg-2",
        type: "DIAL_AGENT",
      }),
    ]);
    expect(callUpdates).toEqual([{ stateVersion: { increment: 1 } }]);
    expect(callUpdates[0]).not.toHaveProperty("deadlineAt");
  });
});
