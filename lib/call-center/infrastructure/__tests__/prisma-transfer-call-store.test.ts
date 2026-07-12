import { describe, expect, it } from "bun:test";

import { transferCall } from "@/lib/call-center/application/transfer-call";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

import { PrismaTransferCallStore } from "../prisma-transfer-call-store";

const now = new Date("2026-07-12T12:00:00.000Z");
const actor: QueueAccessActor = {
  allowedLocationIds: [],
  hasAllLocationAccess: true,
  practiceId: "practice-1",
  userId: "source-user",
};

function database({ competingTransfer = false } = {}) {
  let receipt: Record<string, unknown> | null = null;
  let targetLegCreates = 0;
  let commandCreates = 0;
  let commandCreate: Record<string, unknown> | null = null;
  let callUpdate: Record<string, unknown> | null = null;
  let legFinds = 0;
  const targetSession = {
    audioReady: true,
    connectionState: "READY",
    currentCallId: null,
    endpoint: {
      enabled: true,
      id: "target-endpoint",
      locationId: "location-1",
      providerCredentialId: "credential-1",
      sipUsername: "target-agent",
    },
    endpointId: "target-endpoint",
    id: "target-session",
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    microphoneReady: true,
    practiceId: "practice-1",
    presence: "AVAILABLE",
    stateVersion: 3,
    userId: "target-user",
  };
  const call = {
    effectOwner: "CANONICAL",
    id: "call-1",
    number: { practicePhoneNumber: { locationId: "location-1" } },
    practiceId: "practice-1",
    queue: {
      id: "queue-1",
      locations: [],
      members: [{ userId: "target-user" }],
      ringTimeoutSec: 20,
    },
    queueId: "queue-1",
    stateVersion: 7,
    status: "CONNECTED",
    winningLeg: {
      agentSession: {
        currentCallId: "call-1",
        userId: "source-user",
      },
      endpointId: "source-endpoint",
      id: "source-leg",
      kind: "AGENT",
      status: "BRIDGED",
    },
  };

  const transaction = {
    $queryRaw: async () => [],
    callCenterAgentSession: {
      findMany: async () => [targetSession],
      findUnique: async () => targetSession,
      updateMany: async () => ({ count: 1 }),
    },
    callCenterCall: {
      findFirst: async () => call,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        callUpdate = data;
        return { stateVersion: 8 };
      },
    },
    callCenterCallLeg: {
      count: async () => 1,
      create: async () => {
        targetLegCreates += 1;
        return { id: "target-leg" };
      },
      findFirst: async () => {
        legFinds += 1;
        return competingTransfer && legFinds === 1
          ? { id: "competing-target-leg" }
          : null;
      },
    },
    callCenterCommand: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        commandCreates += 1;
        commandCreate = data;
        return { id: "transfer-command" };
      },
    },
    callCenterEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (data.type === "CALL_TRANSFER_REQUESTED") {
          receipt = {
            actorUserId: data.actorUserId,
            aggregateId: data.aggregateId,
            aggregateType: data.aggregateType,
            data: data.data,
            occurredAt: data.occurredAt,
            revision: BigInt(30),
          };
          return receipt;
        }
        return { revision: BigInt(29) };
      },
      findUnique: async () => receipt,
    },
    callCenterQueue: {
      findFirst: async () => ({ id: "queue-1" }),
    },
    practiceMembership: {
      findUnique: async () => ({ locationScope: "ALL", locations: [] }),
    },
  };

  return {
    callUpdate: () => callUpdate,
    commandCreate: () => commandCreate,
    commandCreates: () => commandCreates,
    targetLegCreates: () => targetLegCreates,
    transaction,
  };
}

describe("Prisma canonical transfer store", () => {
  it("atomically reserves one target, persists one replacement dial, and replays", async () => {
    const fake = database();
    const store = new PrismaTransferCallStore((operation) =>
      operation(fake.transaction as never),
    );
    const input = {
      callId: "call-1",
      idempotencyKey: "transfer-1",
      targetEndpointId: "target-endpoint",
    };

    const accepted = await transferCall(store, actor, input, now);
    const replayed = await transferCall(store, actor, input, now);

    expect(accepted).toMatchObject({
      providerCommandId: "transfer-command",
      sourceLegId: "source-leg",
      targetAgentSessionId: "target-session",
      targetLegId: "target-leg",
    });
    expect(replayed).toMatchObject({ replayed: true, revision: "30" });
    expect(fake.targetLegCreates()).toBe(1);
    expect(fake.commandCreates()).toBe(1);
    expect(fake.commandCreate()).toMatchObject({
      arguments: {
        agentSessionId: "target-session",
        endpointId: "target-endpoint",
        replacesLegId: "source-leg",
      },
      idempotencyKey: "transfer:source-leg:target-leg",
      legId: "target-leg",
      type: "DIAL_AGENT",
    });
    expect(fake.callUpdate()).toEqual({
      deadlineAt: new Date("2026-07-12T12:00:20.000Z"),
      stateVersion: { increment: 1 },
    });
  });

  it("rejects a second concurrent target under the same call lock", async () => {
    const fake = database({ competingTransfer: true });
    const store = new PrismaTransferCallStore((operation) =>
      operation(fake.transaction as never),
    );

    await expect(
      transferCall(
        store,
        actor,
        {
          callId: "call-1",
          idempotencyKey: "transfer-competing",
          targetEndpointId: "target-endpoint",
        },
        now,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(fake.targetLegCreates()).toBe(0);
    expect(fake.commandCreates()).toBe(0);
  });
});
