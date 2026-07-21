import { describe, expect, it } from "bun:test";

import { startOutboundCall } from "@/lib/call-center/application/start-outbound-call";
import { startCanonicalOutbound } from "@/lib/call-center/call-center";

import {
  blocksOutboundStart,
  isOutboundScopeAllowed,
  PrismaStartOutboundCallStore,
} from "../prisma-start-outbound-call-store";

const actor = {
  allowedLocationIds: [],
  hasAllLocationAccess: true,
  practiceId: "practice-1",
  userId: "user-1",
};

const outboundInput = {
  clientInstanceId: "browser-1",
  destination: "+15555550123",
  idempotencyKey: "operation-1",
  numberId: "number-1",
  queueId: "queue-1",
};

function outboundTransaction(now: Date) {
  const commands: Array<{
    arguments: Record<string, unknown>;
    id: string;
    type: string;
  }> = [];
  const transaction = {
    $executeRaw: async () => [],
    $queryRaw: async () => [],
    callCenterAgentSession: {
      findFirst: async () => ({
        audioReady: true,
        browserSessionId: "browser-1",
        connectionState: "READY",
        endpoint: {
          enabled: true,
          id: "endpoint-1",
          locationId: null,
          providerCredentialId: "credential-1",
          sipUsername: "agent-1@example.test",
          userId: "user-1",
        },
        endpointId: "endpoint-1",
        id: "session-1",
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        microphoneReady: true,
        practiceId: "practice-1",
        presence: "AVAILABLE",
        userId: "user-1",
      }),
    },
    callCenterCall: {
      create: async ({ data }: { data: { id: string } }) => ({
        id: data.id,
        stateVersion: 0,
      }),
    },
    callCenterCallLeg: {
      create: async () => ({}),
      findFirst: async () => null,
    },
    callCenterCommand: {
      create: async ({
        data,
      }: {
        data: { arguments: Record<string, unknown>; id: string; type: string };
      }) => {
        commands.push(data);
        return data;
      },
    },
    callCenterEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        actorUserId: data.actorUserId ?? null,
        aggregateId: data.aggregateId,
        aggregateType: data.aggregateType,
        data: data.data,
        occurredAt: data.occurredAt,
        revision: BigInt(1),
      }),
      findUnique: async () => null,
    },
    callCenterNumber: {
      findFirst: async () => ({
        id: "number-1",
        practicePhoneNumber: {
          locationId: null,
          phoneNumber: "+15555550101",
          practiceId: "practice-1",
        },
      }),
    },
    callCenterQueue: {
      findFirst: async () => ({
        id: "queue-1",
        locations: [],
        members: [{ id: "membership-1" }],
        name: "Queue",
      }),
    },
  };
  return { commands, transaction };
}

describe("canonical outbound scope", () => {
  it("connects the agent before dispatching the customer dial", async () => {
    const now = new Date("2026-07-21T12:00:00.000Z");
    const fake = outboundTransaction(now);
    const store = new PrismaStartOutboundCallStore((operation) =>
      operation(fake.transaction as never),
    );
    const dispatched: string[] = [];

    await startCanonicalOutbound(
      {
        create: (currentActor, input, currentNow) =>
          startOutboundCall(store, currentActor, input, currentNow),
        dispatch: async (commandId) => {
          const command = fake.commands.find(({ id }) => id === commandId);
          dispatched.push(command?.type ?? "UNKNOWN");
          return { commandId, markSent: "MARKED", status: "DISPATCHED" };
        },
        prepare: async () => [],
      },
      actor,
      outboundInput,
      now,
    );

    expect(dispatched).toEqual(["DIAL_AGENT"]);
    expect(fake.commands[0]?.arguments).toEqual({
      agentSessionId: "session-1",
      endpointId: "endpoint-1",
      timeoutSeconds: 20,
    });
  });

  it("locks the practice before reading or mutating outbound state", async () => {
    const operations: string[] = [];
    const transaction = {
      $queryRaw: async (query: { values?: unknown[] }) => {
        if (query.values?.includes("CALL_CENTER:practice-1")) {
          operations.push("practice.lock");
        }
        return [];
      },
      callCenterEvent: {
        findUnique: async () => {
          operations.push("receipt.read");
          return {
            actorUserId: "user-1",
            aggregateId: "call-1",
            aggregateType: "CALL",
            data: {},
            occurredAt: new Date("2026-07-19T12:00:00.000Z"),
            revision: BigInt(1),
          };
        },
      },
    };
    const store = new PrismaStartOutboundCallStore((operation) =>
      operation(transaction as never),
    );

    await store.prepareOutboundCleanup(
      {
        allowedLocationIds: ["location-1"],
        hasAllLocationAccess: false,
        practiceId: "practice-1",
        userId: "user-1",
      },
      {
        clientInstanceId: "browser-1",
        destination: "+15555550123",
        idempotencyKey: "operation-1",
        numberId: "number-1",
        queueId: "queue-1",
      },
      new Date("2026-07-19T12:00:00.000Z"),
    );

    expect(operations).toEqual(["practice.lock", "receipt.read"]);
  });

  it("requires both endpoint and number inside a location-scoped queue", () => {
    const base = {
      actorAllowedLocationIds: ["location-1", "location-2"],
      actorHasAllLocationAccess: false,
      endpointLocationId: "location-1",
      numberLocationId: "location-2",
      queueLocationIds: ["location-1", "location-2"],
    };
    expect(isOutboundScopeAllowed(base)).toBe(true);
    expect(isOutboundScopeAllowed({ ...base, numberLocationId: "location-3" })).toBe(
      false,
    );
    expect(isOutboundScopeAllowed({ ...base, endpointLocationId: null })).toBe(false);
  });

  it("supports a practice-wide queue for a practice-wide actor", () => {
    expect(
      isOutboundScopeAllowed({
        actorAllowedLocationIds: [],
        actorHasAllLocationAccess: true,
        endpointLocationId: null,
        numberLocationId: null,
        queueLocationIds: [],
      }),
    ).toBe(true);
  });

  it("fails closed for locationless resources under restricted access", () => {
    const base = {
      actorAllowedLocationIds: ["location-1"],
      actorHasAllLocationAccess: false,
      endpointLocationId: "location-1",
      numberLocationId: "location-1",
      queueLocationIds: [],
    };
    expect(isOutboundScopeAllowed(base)).toBe(true);
    expect(isOutboundScopeAllowed({ ...base, numberLocationId: null })).toBe(false);
    expect(isOutboundScopeAllowed({ ...base, endpointLocationId: null })).toBe(false);
  });

  it("blocks active calls and pending outbound starts without blocking inbound offers", () => {
    expect(blocksOutboundStart({ direction: "INBOUND", status: "ANSWERED" })).toBe(true);
    expect(blocksOutboundStart({ direction: "OUTBOUND", status: "CREATED" })).toBe(true);
    expect(blocksOutboundStart({ direction: "OUTBOUND", status: "RINGING" })).toBe(true);
    expect(blocksOutboundStart({ direction: "INBOUND", status: "RINGING" })).toBe(false);
    expect(blocksOutboundStart({ direction: "OUTBOUND", status: "ENDED" })).toBe(false);
  });
});
