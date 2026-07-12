import { describe, expect, it } from "bun:test";

import { PrismaCanonicalVoicemailRecovery } from "../prisma-canonical-voicemail-recovery";

const now = new Date("2026-07-12T12:00:00.000Z");

type Options = {
  currentCallId?: string | null;
  recordingStatus?: "FAILED" | "SENT" | null;
};

function fakeRecovery({
  currentCallId = "call-1",
  recordingStatus = null,
}: Options = {}) {
  let deadlineAt: Date | null = now;
  let endedAt: Date | null = null;
  let sessionCallId = currentCallId;
  let taskUpserts = 0;
  let revision = BigInt(8);
  const commands = [
    {
      attemptCount: 1,
      createdAt: new Date("2026-07-12T11:58:00.000Z"),
      id: "greeting-1",
      nextAttemptAt: null,
      status: "SENT",
      type: "PLAY_VOICEMAIL_GREETING",
    },
    ...(recordingStatus
      ? [
          {
            attemptCount: 1,
            createdAt: new Date("2026-07-12T11:59:00.000Z"),
            id: "recording-1",
            nextAttemptAt: null,
            status: recordingStatus,
            type: "START_RECORDING",
          },
        ]
      : []),
  ];
  const events: string[] = [];
  const transaction = {
    $queryRaw: async (query: unknown) => {
      const sql = Array.isArray((query as { strings?: string[] }).strings)
        ? (query as { strings: string[] }).strings.join(" ")
        : "";
      if (sql.includes('FROM "call_center_call" AS call')) {
        return deadlineAt && deadlineAt <= now
          ? [{ callId: "call-1", practiceId: "practice-1" }]
          : [];
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
              currentCallId: sessionCallId,
              id: "session-1",
              leaseExpiresAt: new Date("2026-07-12T12:01:00.000Z"),
              microphoneReady: true,
              practiceId: "practice-1",
              presence: "BUSY",
              stateVersion: 3,
            },
      update: async () => {
        sessionCallId = null;
        return { stateVersion: 4 };
      },
    },
    callCenterCall: {
      findFirst: async () =>
        deadlineAt
          ? {
              deadlineAt,
              endedAt,
              fromPhone: "+17865550100",
              id: "call-1",
              legs: [
                {
                  agentSessionId: null,
                  id: "customer-leg-1",
                  kind: "CUSTOMER",
                  providerCallControlId: "control-1",
                  status: "ANSWERED",
                },
                {
                  agentSessionId: "session-1",
                  id: "agent-leg-1",
                  kind: "AGENT",
                  providerCallControlId: "control-2",
                  status: recordingStatus ? "ANSWERED" : "ENDED",
                },
              ],
              practiceId: "practice-1",
            }
          : null,
      updateMany: async ({
        data,
      }: {
        data: { deadlineAt?: Date | null; endedAt?: Date };
      }) => {
        if (!deadlineAt) return { count: 0 };
        deadlineAt = data.deadlineAt ?? null;
        if (data.endedAt) endedAt = data.endedAt;
        return { count: 1 };
      },
    },
    callCenterCallLeg: {
      updateMany: async () => ({ count: 1 }),
    },
    callCenterCommand: {
      findMany: async () => [...commands].reverse(),
      findUnique: async ({ where }: { where: { id?: string } }) => {
        const command = commands.find(({ id }) => id === where.id);
        return command
          ? { callId: "call-1", practiceId: "practice-1", type: command.type }
          : null;
      },
      updateMany: async ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where: { id: string };
      }) => {
        const command = commands.find(({ id }) => id === where.id);
        if (!command) return { count: 0 };
        Object.assign(command, data);
        return { count: 1 };
      },
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        const type = String(create.type);
        const existing = commands.find(({ type: candidate }) => candidate === type);
        if (existing) return { id: existing.id };
        const id = type === "START_RECORDING" ? "recording-1" : "hangup-1";
        commands.push({
          attemptCount: 0,
          createdAt: now,
          id,
          nextAttemptAt: null,
          status: "PENDING",
          type,
        });
        return { id };
      },
    },
    callCenterEvent: {
      create: async ({ data }: { data: { type: string } }) => {
        events.push(data.type);
        revision += BigInt(1);
        return { revision };
      },
      findMany: async () => [],
      upsert: async ({ create }: { create: { type: string } }) => {
        events.push(create.type);
        revision += BigInt(1);
        return { revision };
      },
    },
    callCenterTask: {
      upsert: async () => {
        taskUpserts += 1;
        return { id: "task-1" };
      },
    },
  };
  return {
    commands,
    deadlineAt: () => deadlineAt,
    endedAt: () => endedAt,
    events,
    recovery: new PrismaCanonicalVoicemailRecovery((operation) =>
      operation(transaction as never),
    ),
    sessionCallId: () => sessionCallId,
    taskUpserts: () => taskUpserts,
  };
}

describe("canonical voicemail recovery store", () => {
  it("starts recording once when the greeting completion callback is lost", async () => {
    const fake = fakeRecovery();

    await expect(fake.recovery.recoverDue(now, 25)).resolves.toEqual({
      callIds: ["call-1"],
      commandIds: ["recording-1"],
      finalized: 0,
      recordingStarted: 1,
      selected: 1,
    });
    expect(fake.deadlineAt()).toEqual(new Date("2026-07-12T12:02:30.000Z"));
    expect(fake.commands.filter(({ type }) => type === "START_RECORDING")).toHaveLength(
      1,
    );
    expect(fake.taskUpserts()).toBe(0);
  });

  it("finalizes a lost recording callback, creates a task, and releases its owned seat", async () => {
    const fake = fakeRecovery({ recordingStatus: "SENT" });

    await expect(fake.recovery.recoverDue(now, 25)).resolves.toMatchObject({
      callIds: ["call-1"],
      commandIds: ["hangup-1"],
      finalized: 1,
    });
    expect(fake.deadlineAt()).toBeNull();
    expect(fake.endedAt()).toEqual(now);
    expect(fake.sessionCallId()).toBeNull();
    expect(fake.taskUpserts()).toBe(1);
    expect(fake.events).toContain("CALL_VOICEMAIL_RECOVERY_REQUIRED");
    expect(fake.commands.find(({ id }) => id === "recording-1")).toMatchObject({
      errorCode: "VOICEMAIL_RECORDING_CALLBACK_TIMEOUT",
      status: "FAILED",
    });
    await expect(fake.recovery.recoverDue(now, 25)).resolves.toMatchObject({
      selected: 0,
    });
    expect(fake.taskUpserts()).toBe(1);
  });

  it("does not release a seat that has moved to another call", async () => {
    const fake = fakeRecovery({ currentCallId: "call-2", recordingStatus: "SENT" });

    await fake.recovery.recoverDue(now, 1);

    expect(fake.sessionCallId()).toBe("call-2");
  });
});
