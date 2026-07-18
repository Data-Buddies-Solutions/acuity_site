import { describe, expect, it } from "bun:test";

import type { Prisma } from "@/generated/prisma/client";
import { routeActiveInboundCall } from "@/lib/call-center/application/active-inbound-routing";

import { PrismaActiveInboundRoutingStore } from "../prisma-active-inbound-routing-store";

const now = new Date("2026-07-12T12:00:00.000Z");

function fakeDatabase({ failedReservation = false } = {}) {
  const operations: string[] = [];
  const commands: Array<Record<string, unknown>> = [];
  let routingEvent: Record<string, unknown> | null = null;
  let legSequence = 0;
  let stateVersion = 4;

  const sessions = [
    {
      audioReady: true,
      callLegs: [],
      connectionState: "READY" as const,
      endpoint: {
        enabled: true,
        id: "endpoint-1",
        locationId: "location-1",
        providerCredentialId: "credential-1",
        sipUsername: "agent-1",
        userId: "user-1",
      },
      endpointId: "endpoint-1",
      id: "session-1",
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      microphoneReady: true,
      occupied: false,
      offeredCallId: "older-ringing-call",
      presence: "AVAILABLE" as const,
      stateVersion: 2,
      userId: "user-1",
    },
    {
      audioReady: true,
      callLegs: [],
      connectionState: "READY" as const,
      endpoint: {
        enabled: true,
        id: "endpoint-2",
        locationId: "location-1",
        providerCredentialId: "credential-2",
        sipUsername: "agent-2",
        userId: "user-2",
      },
      endpointId: "endpoint-2",
      id: "session-2",
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      microphoneReady: true,
      occupied: false,
      offeredCallId: null,
      presence: "AVAILABLE" as const,
      stateVersion: 7,
      userId: "user-2",
    },
  ];
  const queue = {
    enabled: true,
    id: "queue-1",
    locations: [{ locationId: "location-1" }],
    maxWaitSec: 30,
    members: [
      { enabled: true, userId: "user-1" },
      { enabled: true, userId: "user-2" },
    ],
    ringTimeoutSec: 20,
  };
  const transaction = {
    $queryRaw: async (query: { strings: readonly string[] }) => {
      const sql = query.strings.join("");
      operations.push(sql.includes("call_center_queue") ? "queue.lock" : "call.lock");
      return [];
    },
    callCenterAgentSession: {
      findMany: async () => {
        operations.push("sessions.load");
        return sessions;
      },
      findFirst: async ({ where }: { where: { id: string } }) => {
        operations.push(`session.revalidate:${where.id}`);
        return failedReservation && where.id === "session-2" ? null : { id: where.id };
      },
    },
    callCenterCall: {
      findFirst: async ({ select }: { select: Record<string, unknown> }) => {
        if (select.effectOwner) {
          operations.push("context.load");
          return {
            direction: "INBOUND",
            effectOwner: "CANONICAL",
            id: "call-1",
            practiceId: "practice-1",
            queueId: "queue-1",
            status: "RECEIVED",
          };
        }
        operations.push("call.revalidate");
        return {
          deadlineAt: null,
          queuedAt: null,
          queueDeadlineAt: null,
          stateVersion,
        };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        operations.push("call.update");
        expect(data).toMatchObject({
          deadlineAt: new Date("2026-07-12T12:00:20.000Z"),
          queueDeadlineAt: new Date("2026-07-12T12:00:20.000Z"),
          status: "QUEUED",
        });
        expect(data).not.toHaveProperty("firstRingAt");
        stateVersion += 1;
        return { stateVersion };
      },
    },
    callCenterCallLeg: {
      count: async () => {
        operations.push("legs.count");
        return 0;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        legSequence += 1;
        operations.push(`leg.create:${String(data.agentSessionId)}`);
        return { id: `leg-${legSequence}` };
      },
      findMany: async () => {
        operations.push("customer-leg.load");
        return [{ id: "customer-leg-1" }];
      },
    },
    callCenterCommand: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        commands.push(data);
        const type = String(data.type);
        operations.push(`command.create:${type}`);
        return { id: `command-${commands.length}` };
      },
      findMany: async () => [
        {
          callId: "call-1",
          dependsOnCommandId: null,
          id: "answer-existing",
          practiceId: "practice-1",
          status: "CONFIRMED",
          type: "ANSWER_CUSTOMER",
        },
        {
          callId: "call-1",
          dependsOnCommandId: "answer-existing",
          id: "ringback-existing",
          practiceId: "practice-1",
          status: "SENT",
          type: "START_RINGBACK",
        },
      ],
    },
    callCenterEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (data.type !== "CALL_ROUTING_ACTIVE_STARTED") {
          operations.push(`session-event.create:${String(data.aggregateId)}`);
          return { data: data.data, occurredAt: data.occurredAt, revision: BigInt(18) };
        }
        operations.push("routing-event.create");
        routingEvent = {
          data: data.data,
          occurredAt: data.occurredAt,
          revision: BigInt(19),
        };
        return routingEvent;
      },
      findUnique: async () => {
        operations.push("routing-event.find");
        return routingEvent;
      },
    },
    callCenterQueue: {
      findFirst: async () => {
        operations.push("queue.load");
        return queue;
      },
    },
  } as unknown as Prisma.TransactionClient;

  return {
    commands,
    operations,
    store: new PrismaActiveInboundRoutingStore((operation) => operation(transaction)),
  };
}

describe("Prisma canonical active inbound routing", () => {
  it("creates one independently auditable dial for every ready agent", async () => {
    const fake = fakeDatabase();
    const result = await routeActiveInboundCall(
      fake.store,
      { callId: "call-1", practiceId: "practice-1" },
      now,
    );

    expect(result).toMatchObject({
      commandIds: ["command-1", "command-2", "command-3", "command-4"],
      dialCommandIds: ["command-3", "command-4"],
      replayed: false,
      stateVersion: 5,
    });
    expect(fake.commands).toHaveLength(4);
    expect(fake.commands[0]).toMatchObject({ type: "ANSWER_CUSTOMER" });
    expect(fake.commands[0]).toMatchObject({
      arguments: {},
      legId: "customer-leg-1",
    });
    expect(fake.commands[0]).not.toHaveProperty("dependsOnCommandId");
    expect(fake.commands[1]).toMatchObject({
      arguments: { timeoutSeconds: 20 },
      dependsOnCommandId: "command-1",
      legId: "customer-leg-1",
      type: "START_RINGBACK",
    });
    expect(fake.commands[2]).toMatchObject({
      dependsOnCommandId: "command-2",
      legId: "leg-1",
      type: "DIAL_AGENT",
    });
    expect(fake.commands[2]?.arguments).toEqual({
      agentSessionId: "session-1",
      endpointId: "endpoint-1",
    });
    expect(fake.commands[3]).toMatchObject({
      dependsOnCommandId: "command-2",
      legId: "leg-2",
      type: "DIAL_AGENT",
    });
    expect(fake.operations.at(-1)).toBe("routing-event.create");
    expect(
      fake.operations.filter((value) => value === "routing-event.create"),
    ).toHaveLength(1);
    expect(JSON.stringify(fake.commands)).not.toContain("credential-");
    expect(JSON.stringify(fake.commands)).not.toContain("agent-1");
    expect(fake.operations).toContain("session.revalidate:session-1");
    expect(fake.operations).toContain("leg.create:session-1");
  });

  it("drops a session that becomes occupied before its leg is created", async () => {
    const fake = fakeDatabase({ failedReservation: true });
    const result = await routeActiveInboundCall(
      fake.store,
      { callId: "call-1", practiceId: "practice-1" },
      now,
    );

    expect(result).toMatchObject({
      commandIds: ["command-1", "command-2", "command-3"],
      dialCommandIds: ["command-3"],
    });
    expect(fake.operations).not.toContain("leg.create:session-2");
    expect(fake.commands.filter(({ type }) => type === "DIAL_AGENT")).toHaveLength(1);
  });

  it("replays exact command IDs from the immutable routing event", async () => {
    const fake = fakeDatabase();
    const first = await routeActiveInboundCall(
      fake.store,
      { callId: "call-1", practiceId: "practice-1" },
      now,
    );
    const replay = await routeActiveInboundCall(
      fake.store,
      { callId: "call-1", practiceId: "practice-1" },
      now,
    );

    expect(replay).toEqual({ ...first, replayed: true });
    expect(
      fake.operations.filter((value) => value === "command.create:DIAL_AGENT"),
    ).toHaveLength(2);
  });

  it("reuses active prerequisites for a later queue round and returns only new dials", async () => {
    const fake = fakeDatabase({ failedReservation: true });
    const result = await routeActiveInboundCall(
      fake.store,
      {
        callId: "call-1",
        practiceId: "practice-1",
        prerequisite: {
          answerCommandId: "answer-existing",
          startRingbackCommandId: "ringback-existing",
        },
        routingKey: "overflow:call-1:queue-1:queue-2",
      },
      now,
    );

    expect(result).toMatchObject({
      answerCommandId: "answer-existing",
      commandIds: ["command-1"],
      dialCommandIds: ["command-1"],
      startRingbackCommandId: "ringback-existing",
    });
    expect(fake.commands).toHaveLength(1);
    expect(fake.commands[0]).toMatchObject({
      dependsOnCommandId: "ringback-existing",
      type: "DIAL_AGENT",
    });
  });
});
