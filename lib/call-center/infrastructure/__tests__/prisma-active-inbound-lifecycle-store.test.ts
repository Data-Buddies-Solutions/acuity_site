import { describe, expect, it } from "bun:test";

import type { Prisma } from "@/generated/prisma/client";

import { reconcileActiveInboundCallInTransaction } from "../prisma-active-inbound-lifecycle-store";

const now = new Date("2026-07-12T12:00:20.000Z");

function fakeDatabase({
  agentLegs = [{ id: "agent-ended", kind: "AGENT", status: "ENDED" }] as Array<{
    id: string;
    kind: "AGENT";
    status:
      "CREATED" | "DIALING" | "RINGING" | "ANSWERED" | "BRIDGED" | "ENDED" | "FAILED";
  }>,
  deadlineAt = now as Date | null,
  ringbackStatus = "SENT" as "FAILED" | "SENT",
  voicemailEnabled = true,
  winningLegId = null as string | null,
} = {}) {
  const commands = new Map<string, Record<string, unknown>>();
  const operations: string[] = [];
  const tasks: Array<Record<string, unknown>> = [];
  const call = {
    answeredAt: null,
    deadlineAt,
    direction: "INBOUND" as const,
    effectOwner: "CANONICAL" as const,
    id: "call-1",
    legs: [
      {
        commands: [],
        id: "customer-leg",
        kind: "CUSTOMER" as const,
        status: "ANSWERED",
      },
      ...agentLegs.map((leg) => ({
        ...leg,
        commands: [{ arguments: {} }],
      })),
    ],
    practiceId: "practice-1",
    queue: {
      enabled: true,
      id: "queue-1",
      locations: [],
      members: [],
      voicemailEnabled,
      voicemailGreeting: "Leave a message.",
    },
    queueId: "queue-1",
    stateVersion: 4,
    status: "RINGING" as
      "RECEIVED" | "QUEUED" | "RINGING" | "CONNECTED" | "VOICEMAIL" | "ABANDONED",
    winningLegId,
  };

  const transaction = {
    $queryRaw: async (query: { strings: readonly string[] }) => {
      const sql = query.strings.join("");
      operations.push(sql);
      return sql.includes("SKIP LOCKED")
        ? [{ callId: call.id, practiceId: call.practiceId }]
        : [];
    },
    callCenterAgentSession: {
      findMany: async () => [],
    },
    callCenterCall: {
      findFirst: async () => call,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        operations.push(`call.update:${String(data.status)}`);
        Object.assign(call, data, {
          stateVersion: call.stateVersion + 1,
        });
        return call;
      },
    },
    callCenterCommand: {
      findUnique: async () => ({ status: ringbackStatus }),
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        const key = `${String(create.type)}:${String(create.idempotencyKey)}`;
        operations.push(`command.upsert:${String(create.type)}`);
        const command = commands.get(key) ?? {
          ...create,
          id: `command-${commands.size + 1}`,
        };
        commands.set(key, command);
        return { id: command.id, type: command.type };
      },
    },
    callCenterEvent: {
      findFirst: async () => ({
        data: {
          answerCommandId: "initial-answer",
          startRingbackCommandId: "initial-ringback",
        },
      }),
      findMany: async () => [],
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        operations.push(`event.upsert:${String(create.type)}`);
        return { revision: BigInt(18) };
      },
    },
    callCenterTask: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        operations.push("task.upsert");
        tasks.push(create);
        return { id: "task-1" };
      },
    },
  } as unknown as Prisma.TransactionClient;
  const settleAgentLegs: Parameters<
    typeof reconcileActiveInboundCallInTransaction
  >[3] = async (_transaction, input) => {
    const released = call.legs.filter(
      (leg) => leg.kind === "AGENT" && input.legIds?.includes(leg.id),
    );
    for (const leg of released) {
      leg.status = input.terminalLegStatus ?? "ENDED";
      const idempotencyKey =
        input.hangupIdempotencyKeys?.[leg.id] ??
        `settle:${input.callId}:hangup:${leg.id}`;
      const key = `HANGUP_LEG:${idempotencyKey}`;
      const command = commands.get(key) ?? {
        id: `command-${commands.size + 1}`,
        idempotencyKey,
        legId: leg.id,
        type: "HANGUP_LEG",
      };
      commands.set(key, command);
    }
    operations.push(`agent.settle:${released.map(({ id }) => id).join(",")}`);
    return released.map(({ id }) =>
      String([...commands.values()].find((command) => command.legId === id)?.id),
    );
  };
  const store = {
    reconcile: (
      input: Parameters<typeof reconcileActiveInboundCallInTransaction>[1],
      at: Date,
    ) => reconcileActiveInboundCallInTransaction(transaction, input, at, settleAgentLegs),
  };
  return { call, commands, operations, store, tasks };
}

describe("Prisma ACTIVE inbound lifecycle", () => {
  it("keeps the persisted winner and durably hangs up only live losers", async () => {
    const fake = fakeDatabase({
      agentLegs: [
        { id: "winner", kind: "AGENT", status: "BRIDGED" },
        { id: "late-bridge", kind: "AGENT", status: "BRIDGED" },
        { id: "ended-loser", kind: "AGENT", status: "ENDED" },
      ],
      deadlineAt: new Date("2026-07-12T12:00:40.000Z"),
      winningLegId: "winner",
    });

    const result = await fake.store.reconcile(
      {
        callId: "call-1",
        practiceId: "practice-1",
        processedBridgeLegId: "late-bridge",
      },
      now,
    );

    expect(result.decision?.winningLegId).toBe("winner");
    expect(fake.call.deadlineAt).toBeNull();
    expect(fake.call.winningLegId).toBe("winner");
    expect([...fake.commands.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dependsOnCommandId: "initial-ringback",
          legId: "customer-leg",
          type: "STOP_PLAYBACK",
        }),
        expect.objectContaining({ legId: "late-bridge", type: "HANGUP_LEG" }),
      ]),
    );
    expect(fake.call.legs.find(({ id }) => id === "late-bridge")?.status).toBe("ENDED");
    expect(fake.operations.some((operation) => operation.includes("agent_session"))).toBe(
      false,
    );
  });

  it("elects the bridge processed under the call lock without timestamp ordering", async () => {
    const fake = fakeDatabase({
      agentLegs: [
        { id: "older-provider-time", kind: "AGENT", status: "BRIDGED" },
        { id: "processed-first", kind: "AGENT", status: "BRIDGED" },
      ],
      deadlineAt: new Date("2026-07-12T12:00:40.000Z"),
    });

    await fake.store.reconcile(
      {
        callId: "call-1",
        practiceId: "practice-1",
        processedBridgeLegId: "processed-first",
      },
      now,
    );

    expect(fake.call.winningLegId).toBe("processed-first");
  });

  it("starts voicemail without depending on failed ringback", async () => {
    const fake = fakeDatabase({
      agentLegs: [{ id: "agent-failed", kind: "AGENT", status: "FAILED" }],
      deadlineAt: new Date("2026-07-12T12:00:40.000Z"),
      ringbackStatus: "FAILED",
    });

    const result = await fake.store.reconcile(
      {
        callId: "call-1",
        practiceId: "practice-1",
        processedBridgeLegId: null,
      },
      now,
    );

    expect(result.decision?.disposition).toBe("VOICEMAIL");
    expect([...fake.commands.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dependsOnCommandId: null,
          type: "STOP_PLAYBACK",
        }),
        expect.objectContaining({
          dependsOnCommandId: "command-1",
          type: "PLAY_VOICEMAIL_GREETING",
        }),
      ]),
    );
  });

  it("abandons without voicemail and creates one deduplicated missed-call task", async () => {
    const fake = fakeDatabase({ voicemailEnabled: false });

    await fake.store.reconcile(
      {
        callId: "call-1",
        practiceId: "practice-1",
        processedBridgeLegId: null,
      },
      now,
    );

    expect(fake.call.status).toBe("ABANDONED");
    expect([...fake.commands.values()]).toEqual([
      expect.objectContaining({
        dependsOnCommandId: "initial-ringback",
        legId: "customer-leg",
        type: "STOP_PLAYBACK",
      }),
      expect.objectContaining({
        dependsOnCommandId: "command-1",
        legId: "customer-leg",
        type: "HANGUP_LEG",
      }),
    ]);
    expect(fake.tasks).toEqual([
      expect.objectContaining({
        callId: "call-1",
        dedupeKey: "active:call-1:task:missed-call",
        kind: "MISSED_CALL",
        sourceEventRevision: BigInt(18),
      }),
    ]);
    expect(
      fake.operations.indexOf("event.upsert:CALL_ACTIVE_LIFECYCLE_RECONCILED"),
    ).toBeLessThan(fake.operations.indexOf("task.upsert"));
  });
});
