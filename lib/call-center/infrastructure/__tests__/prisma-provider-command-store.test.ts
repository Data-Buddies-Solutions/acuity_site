import { describe, expect, it } from "bun:test";

import {
  PrismaProviderCommandStore,
  type ProviderCommandPrismaDelegate,
  type ProviderCommandTransactionRunner,
} from "../prisma-provider-command-store";

const now = new Date("2026-07-12T12:00:00.000Z");

function transaction(routingMode: "LEGACY" | "SHADOW" | "ACTIVE") {
  let updates = 0;
  const tx = {
    $queryRaw: async () => [{ id: "command-1" }],
    callCenterCallLeg: {
      findMany: async () => [{ providerCallControlId: "customer-control-1" }],
    },
    callCenterCommand: {
      findUnique: async () => ({
        arguments: { agentSessionId: "session-1", endpointId: "endpoint-1" },
        attemptCount: 0,
        call: {
          number: { practicePhoneNumber: { phoneNumber: "+17865550101" } },
          queue: { ringTimeoutSec: 20, routingMode },
          status: "RINGING",
        },
        callId: "call-1",
        id: "command-1",
        idempotencyKey: "dial:leg-1",
        leg: {
          agentSessionId: "session-1",
          callId: "call-1",
          endpoint: {
            enabled: true,
            sipUsername: "agent-1@example.test",
          },
          endpointId: "endpoint-1",
          id: "leg-1",
          kind: "AGENT",
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
    },
  };
  return { tx, updates: () => updates };
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
      ).rejects.toThrow("COMMAND_QUEUE_NOT_ACTIVE");
      expect(fake.updates()).toBe(0);
    }
  });

  it("never regresses a callback-confirmed command to SENT", async () => {
    const commands = {
      findMany: async () => [],
      findUnique: async () => ({ attemptCount: 1, status: "CONFIRMED" }),
      updateMany: async () => ({ count: 0 }),
    } as unknown as ProviderCommandPrismaDelegate;
    const store = new PrismaProviderCommandStore(undefined, commands);

    await expect(
      store.markSent({ attemptCount: 1, commandId: "command-1", now }),
    ).resolves.toBe("ALREADY_CONFIRMED");
  });
});
