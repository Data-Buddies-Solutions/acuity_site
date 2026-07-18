import { describe, expect, it } from "bun:test";

import {
  failProviderCommandDependents,
  settleProviderCommandsForTerminalLeg,
} from "../prisma-provider-command-failures";

const now = new Date("2026-07-12T12:00:00.000Z");

describe("provider command dependency failures", () => {
  it("terminally fails the full dependent chain without session pointers", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const operations: string[] = [];
    let reads = 0;
    const ringback = {
      attemptCount: 0,
      callId: "call-1",
      id: "ringback-command",
      leg: null,
      nextAttemptAt: null,
      practiceId: "practice-1",
      status: "PENDING",
      type: "START_RINGBACK",
    } as const;
    const dial = {
      attemptCount: 0,
      callId: "call-1",
      id: "dial-command",
      leg: { agentSessionId: "session-1", id: "agent-leg" },
      nextAttemptAt: null,
      practiceId: "practice-1",
      status: "PENDING",
      type: "DIAL_AGENT",
    } as const;
    const transaction = {
      $queryRaw: async () => [],
      callCenterAgentSession: {
        findUnique: async () => ({
          audioReady: true,
          connectionState: "READY",
          currentCallId: "call-1",
          endpointId: "endpoint-1",
          id: "session-1",
          leaseExpiresAt: new Date(now.getTime() + 60_000),
          microphoneReady: true,
          practiceId: "practice-1",
          presence: "BUSY",
          stateVersion: 2,
        }),
        update: async () => {
          operations.push("session.release");
          return { stateVersion: 3 };
        },
      },
      callCenterCall: {
        findUnique: async () => ({
          deadlineAt: null,
          status: "RINGING",
          winningLegId: null,
        }),
        update: async () => {
          operations.push("call.update");
          return {};
        },
      },
      callCenterCallLeg: {
        updateMany: async () => {
          operations.push("leg.fail");
          return { count: 1 };
        },
      },
      callCenterCommand: {
        findMany: async () => {
          reads += 1;
          if (reads === 1) return [ringback];
          if (reads === 2) return [dial];
          return [];
        },
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === dial.id
            ? { callId: "call-1", practiceId: "practice-1", type: "DIAL_AGENT" }
            : {
                callId: "call-1",
                practiceId: "practice-1",
                type: "START_RINGBACK",
              },
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return { count: 1 };
        },
      },
      callCenterEvent: {
        create: async () => ({ revision: BigInt(1) }),
        findMany: async () => [],
      },
    };

    await expect(
      failProviderCommandDependents(transaction as never, {
        commandId: "answer-command",
        now,
      }),
    ).resolves.toEqual(["ringback-command", "dial-command"]);
    expect(updates).toEqual([
      expect.objectContaining({
        errorCode: "COMMAND_DEPENDENCY_FAILED",
        nextAttemptAt: null,
        status: "FAILED",
      }),
      expect.objectContaining({
        errorCode: "COMMAND_DEPENDENCY_FAILED",
        nextAttemptAt: null,
        status: "FAILED",
      }),
    ]);
    expect(operations).toContain("leg.fail");
    expect(operations).not.toContain("session.release");
  });

  it("confirms a cleanup effect already satisfied by a terminal provider leg", async () => {
    const updates: Array<Record<string, unknown>> = [];
    let reads = 0;
    const transaction = {
      callCenterCommand: {
        findMany: async () => {
          reads += 1;
          return reads === 1
            ? [
                {
                  attemptCount: 1,
                  callId: "call-1",
                  id: "stop-command",
                  leg: null,
                  nextAttemptAt: null,
                  practiceId: "practice-1",
                  status: "SENT",
                  type: "STOP_PLAYBACK",
                },
              ]
            : [];
        },
        findUnique: async () => ({
          callId: "call-1",
          practiceId: "practice-1",
          type: "STOP_PLAYBACK",
        }),
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return { count: 1 };
        },
      },
    };

    await expect(
      settleProviderCommandsForTerminalLeg(transaction as never, {
        legId: "customer-leg",
        now,
      }),
    ).resolves.toEqual([]);
    expect(updates).toEqual([
      expect.objectContaining({
        errorCode: null,
        nextAttemptAt: null,
        status: "CONFIRMED",
      }),
    ]);
  });
});
