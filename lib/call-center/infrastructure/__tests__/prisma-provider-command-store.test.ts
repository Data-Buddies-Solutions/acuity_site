import { describe, expect, it } from "bun:test";

import {
  PrismaProviderCommandStore,
  type ProviderCommandPrismaDelegate,
  type ProviderCommandTransactionRunner,
} from "../prisma-provider-command-store";

const now = new Date("2026-07-12T12:00:00.000Z");

function transaction(
  routingMode: "LEGACY" | "SHADOW" | "ACTIVE",
  {
    accessLocationIds = ["location-1"],
    legKind = "AGENT",
    memberUserId = "user-1",
  }: {
    accessLocationIds?: string[];
    legKind?: "AGENT" | "CUSTOMER";
    memberUserId?: string | null;
  } = {},
) {
  let updates = 0;
  const operations: string[] = [];
  const session = {
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
    userId: "user-1",
  };
  const tx = {
    $queryRaw: async () => [{ id: "command-1" }],
    callCenterAgentSession: {
      findUnique: async () => session,
      update: async () => {
        operations.push("session.release");
        return { stateVersion: 3 };
      },
    },
    callCenterCall: {
      findUnique: async () => ({ queueId: "queue-1" }),
      update: async () => ({ stateVersion: 2 }),
    },
    callCenterCallLeg: {
      findMany: async () => [{ providerCallControlId: "customer-control-1" }],
      updateMany: async () => {
        operations.push("leg.reject");
        return { count: 1 };
      },
    },
    callCenterCommand: {
      findUnique: async () => ({
        arguments: { agentSessionId: "session-1", endpointId: "endpoint-1" },
        attemptCount: 0,
        call: {
          number: {
            practicePhoneNumber: {
              locationId: "location-1",
              phoneNumber: "+17865550101",
            },
          },
          queue: {
            enabled: true,
            locations: [{ locationId: "location-1" }],
            members: memberUserId ? [{ userId: memberUserId }] : [],
            ringTimeoutSec: 20,
            routingMode,
          },
          status: "RINGING",
        },
        callId: "call-1",
        id: "command-1",
        idempotencyKey: "dial:leg-1",
        leg: {
          agentSession: session,
          agentSessionId: "session-1",
          callId: "call-1",
          endpoint: {
            enabled: true,
            locationId: "location-1",
            sipUsername: "agent-1@example.test",
          },
          endpointId: "endpoint-1",
          id: "leg-1",
          kind: legKind,
        },
        nextAttemptAt: null,
        practice: {
          callCenterSettings: { enabled: true, telnyxConnectionId: "connection-1" },
        },
        practiceId: "practice-1",
        status: "PENDING",
        type: "DIAL_AGENT",
        updatedAt: now,
      }),
      update: async () => {
        updates += 1;
        return { attemptCount: 1 };
      },
      updateMany: async () => {
        operations.push("command.reject");
        return { count: 1 };
      },
    },
    callCenterEvent: {
      create: async () => ({ revision: BigInt(2) }),
      findMany: async () => [{ actorUserId: "user-1", revision: BigInt(1) }],
    },
    practiceMembership: {
      findUnique: async () => ({
        locationScope: "SELECTED",
        locations: accessLocationIds.map((locationId) => ({ locationId })),
      }),
    },
  };
  return { operations, tx, updates: () => updates };
}

describe("Prisma provider command store", () => {
  it("claims one ACTIVE dial with provider details resolved only in memory", async () => {
    const fake = transaction("ACTIVE");
    const runner: ProviderCommandTransactionRunner = (operation) =>
      operation(fake.tx as never);
    const store = new PrismaProviderCommandStore(runner);

    await expect(
      store.claim({
        commandId: "command-1",
        maxAttempts: 5,
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toMatchObject({
      attemptCount: 1,
      command: {
        arguments: { agentSessionId: "session-1", endpointId: "endpoint-1" },
        commandId: "command-1",
        provider: {
          connectionId: "connection-1",
          from: "+17865550101",
          linkTo: "customer-control-1",
          sipUri: "sip:agent-1@example.test",
          timeoutSeconds: 20,
        },
      },
    });
    expect(fake.updates()).toBe(1);
  });

  it("refuses provider effects for LEGACY and SHADOW queues", async () => {
    for (const mode of ["LEGACY", "SHADOW"] as const) {
      const fake = transaction(mode);
      const store = new PrismaProviderCommandStore((operation) =>
        operation(fake.tx as never),
      );

      await expect(
        store.claim({
          commandId: "command-1",
          maxAttempts: 5,
          now,
          staleBefore: new Date(now.getTime() - 60_000),
        }),
      ).resolves.toBeNull();
      expect(fake.updates()).toBe(0);
      expect(fake.operations).toContain("command.reject");
      expect(fake.operations).toContain("session.release");
    }
  });

  it("rejects an invalid command without mutating its unrelated leg", async () => {
    const fake = transaction("ACTIVE", { legKind: "CUSTOMER" });
    const store = new PrismaProviderCommandStore((operation) =>
      operation(fake.tx as never),
    );

    await expect(
      store.claim({
        commandId: "command-1",
        maxAttempts: 5,
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toBeNull();
    expect(fake.operations).toContain("command.reject");
    expect(fake.operations).not.toContain("leg.reject");
    expect(fake.operations).not.toContain("session.release");
  });

  it("rechecks agent membership before the provider effect", async () => {
    const fake = transaction("ACTIVE", { memberUserId: null });
    const store = new PrismaProviderCommandStore((operation) =>
      operation(fake.tx as never),
    );

    await expect(
      store.claim({
        commandId: "command-1",
        maxAttempts: 5,
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toBeNull();
    expect(fake.operations).toContain("leg.reject");
    expect(fake.operations).toContain("session.release");
    expect(fake.updates()).toBe(0);
  });

  it("rechecks practice location access before the provider effect", async () => {
    const fake = transaction("ACTIVE", { accessLocationIds: [] });
    const store = new PrismaProviderCommandStore((operation) =>
      operation(fake.tx as never),
    );

    await expect(
      store.claim({
        commandId: "command-1",
        maxAttempts: 5,
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toBeNull();
    expect(fake.operations).toContain("session.release");
    expect(fake.updates()).toBe(0);
  });

  it("never regresses a callback-confirmed command to SENT", async () => {
    const commands = {
      findMany: async () => [],
      findUnique: async () => ({ attemptCount: 1, status: "CONFIRMED" }),
      updateMany: async () => ({ count: 0 }),
    } as unknown as ProviderCommandPrismaDelegate;
    const store = new PrismaProviderCommandStore(
      (operation) => operation({ callCenterCommand: commands } as never),
      commands,
    );

    await expect(
      store.markSent({ attemptCount: 1, commandId: "command-1", now }),
    ).resolves.toBe("ALREADY_CONFIRMED");
  });

  it("publishes sent state for the original user operation", async () => {
    const events: Array<Record<string, unknown>> = [];
    const tx = {
      callCenterCommand: {
        findUnique: async () => ({
          callId: "call-1",
          practiceId: "practice-1",
          type: "DIAL_AGENT",
        }),
        updateMany: async () => ({ count: 1 }),
      },
      callCenterEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          events.push(data);
          return { revision: BigInt(2) };
        },
        findMany: async () => [{ actorUserId: "user-1", revision: BigInt(1) }],
      },
    };
    const store = new PrismaProviderCommandStore((operation) => operation(tx as never));

    await expect(
      store.markSent({ attemptCount: 1, commandId: "command-1", now }),
    ).resolves.toBe("MARKED");
    expect(events).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          operationEventRevision: "1",
          status: "SENT",
        }),
        type: "CALL_OPERATION_STATUS_CHANGED",
      }),
    );
  });

  it("releases a terminally failed dial reservation", async () => {
    const operations: string[] = [];
    const tx = {
      $queryRaw: async () => {
        operations.push("lock");
        return [];
      },
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
        findUnique: async ({ select }: { select: Record<string, unknown> }) =>
          "leg" in select
            ? {
                callId: "call-1",
                leg: { agentSessionId: "session-1", id: "leg-1" },
                practiceId: "practice-1",
              }
            : {
                callId: "call-1",
                practiceId: "practice-1",
                type: "DIAL_AGENT",
              },
        updateMany: async () => {
          operations.push("command.fail");
          return { count: 1 };
        },
      },
      callCenterEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          operations.push(`event:${data.type}`);
          return { revision: BigInt(2) };
        },
        findMany: async () => [{ actorUserId: "user-1", revision: BigInt(1) }],
      },
    };
    const store = new PrismaProviderCommandStore((operation) => operation(tx as never));

    await expect(
      store.fail({
        attemptCount: 5,
        commandId: "command-1",
        errorCode: "PROVIDER_VALIDATION_FAILED",
        nextAttemptAt: null,
        now,
      }),
    ).resolves.toBe(true);
    expect(operations).toContain("leg.fail");
    expect(operations).toContain("session.release");
    expect(operations).toContain("event:CALL_OPERATION_STATUS_CHANGED");
  });
});
