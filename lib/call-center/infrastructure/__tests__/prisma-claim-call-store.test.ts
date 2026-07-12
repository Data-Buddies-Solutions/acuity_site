import { describe, expect, it } from "bun:test";

import type { Prisma } from "@/generated/prisma/client";
import {
  claimCall,
  ClaimCallError,
  type ClaimCallInput,
} from "@/lib/call-center/application/claim-call";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

import { PrismaClaimCallStore } from "../prisma-claim-call-store";

const now = new Date("2026-07-12T12:00:00.000Z");
const actor: QueueAccessActor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const input: ClaimCallInput = {
  callId: "call-1",
  clientInstanceId: "browser-1",
  endpointId: "endpoint-1",
  expectedSessionStateVersion: 2,
  idempotencyKey: "operation-1",
};

function fakeDatabase({
  callLocationId = "location-1" as string | null,
  callStatus = "QUEUED" as "COMPLETED" | "QUEUED" | "RINGING",
  endpointLocationId = "location-1" as string | null,
  effectOwner = "CANONICAL" as "CANONICAL" | "LEGACY",
  existing = false,
  existingCommandStatus = "SENT" as
    "PENDING" | "SENDING" | "SENT" | "CONFIRMED" | "FAILED",
  existingNextAttemptAt = null as Date | null,
  leaseExpired = false,
  lockedMember = true,
  routingMode = "ACTIVE" as "ACTIVE" | "LEGACY" | "SHADOW",
  sessionStateVersion = 2,
  winningLegId = null as string | null,
} = {}) {
  const operations: string[] = [];
  const receipts = new Map<string, Record<string, unknown>>();
  const queue = {
    enabled: true,
    id: "queue-1",
    locations: [{ locationId: "location-1" }],
    maxWaitSec: 30,
    members: [{ id: "member-1" }],
    name: "Optical",
    ringTimeoutSec: 20,
    routingMode,
  };
  const call = {
    direction: "INBOUND" as const,
    effectOwner,
    firstRingAt: null,
    id: "call-1",
    number: { practicePhoneNumber: { locationId: callLocationId } },
    practiceId: "practice-1",
    queue,
    queueId: "queue-1",
    stateVersion: 4,
    status: callStatus as "COMPLETED" | "QUEUED" | "RINGING",
    winningLegId,
  };
  const session = {
    audioReady: true,
    browserSessionId: "browser-1",
    connectionState: "READY" as const,
    currentCallId: null,
    offeredCallId: existing ? "call-1" : null,
    endpoint: {
      enabled: true,
      id: "endpoint-1",
      locationId: endpointLocationId,
      providerCredentialId: "credential-1",
      sipUsername: "seat-1",
    },
    endpointId: "endpoint-1",
    id: "session-1",
    leaseExpiresAt: new Date(now.getTime() + (leaseExpired ? -1 : 60_000)),
    microphoneReady: true,
    practiceId: "practice-1",
    presence: "AVAILABLE" as const,
    stateVersion: sessionStateVersion,
    userId: "user-1",
  };
  const transaction = {
    $queryRaw: async (query: { strings: readonly string[] }) => {
      const sql = query.strings.join("");
      const table = ["call", "queue", "endpoint", "agent_session"].find((name) =>
        sql.includes(`call_center_${name}`),
      );
      operations.push(table ? `${table}.lock` : "receipt.lock");
      return [];
    },
    callCenterAgentSession: {
      findFirst: async () => session,
      update: async () => {
        operations.push("session.update");
        session.offeredCallId = "call-1";
        session.stateVersion += 1;
        return { stateVersion: session.stateVersion };
      },
    },
    callCenterCall: {
      findFirst: async () => call,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        operations.push("call.update");
        expect(data).toEqual({ stateVersion: { increment: 1 } });
        call.stateVersion += 1;
        return { stateVersion: call.stateVersion };
      },
    },
    callCenterCallLeg: {
      count: async () => 0,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        operations.push("leg.create");
        expect(data).toMatchObject({
          agentSessionId: "session-1",
          callId: "call-1",
          endpointId: "endpoint-1",
          status: "CREATED",
        });
        return { id: "leg-1" };
      },
      findFirst: async () =>
        existing
          ? {
              commands: [
                {
                  id: "command-existing",
                  nextAttemptAt: existingNextAttemptAt,
                  status: existingCommandStatus,
                },
              ],
              id: "leg-existing",
            }
          : null,
    },
    callCenterCommand: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        operations.push("command.create");
        expect(data).toMatchObject({
          arguments: {
            agentSessionId: "session-1",
            endpointId: "endpoint-1",
            purpose: "CLAIM",
          },
          idempotencyKey: "dial:leg-1",
          type: "DIAL_AGENT",
        });
        expect(JSON.stringify(data)).not.toContain("credential-1");
        expect(JSON.stringify(data)).not.toContain("seat-1");
        return { id: "command-1" };
      },
    },
    callCenterEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const receipt = data.type === "CALL_CLAIM_REQUESTED";
        operations.push(receipt ? "receipt.create" : `event.create:${data.type}`);
        const event = {
          actorUserId: data.actorUserId,
          aggregateId: data.aggregateId,
          aggregateType: data.aggregateType,
          data: data.data,
          occurredAt: data.occurredAt,
          revision: BigInt(receipts.size + 10),
        };
        if (receipt) receipts.set(String(data.idempotencyKey), event);
        return event;
      },
      findUnique: async ({
        where,
      }: {
        where: Record<string, Record<string, string>>;
      }) => {
        operations.push("receipt.find");
        return receipts.get(where.practiceId_type_idempotencyKey.idempotencyKey) ?? null;
      },
    },
    callCenterQueue: {
      findFirst: async () => queue,
      findUnique: async () => ({
        ...queue,
        members: lockedMember ? queue.members : [],
      }),
    },
  } as unknown as Prisma.TransactionClient;
  const store = new PrismaClaimCallStore((operation) => operation(transaction));
  return { operations, receipts, store };
}

describe("Prisma canonical manual claim", () => {
  it("reserves one session and appends the operation receipt last", async () => {
    const fake = fakeDatabase();
    const receipt = await claimCall(fake.store, actor, input, now);

    expect(receipt).toMatchObject({
      agentSessionId: "session-1",
      callId: "call-1",
      endpointId: "endpoint-1",
      legId: "leg-1",
      operationType: "CLAIM",
      providerCommandId: "command-1",
      replayed: false,
      stateVersion: 5,
      status: "PENDING",
    });
    expect(fake.operations).toEqual([
      "receipt.lock",
      "receipt.find",
      "call.lock",
      "queue.lock",
      "endpoint.lock",
      "agent_session.lock",
      "leg.create",
      "command.create",
      "session.update",
      "call.update",
      "event.create:CALL_CLAIM_STARTED",
      "event.create:AGENT_SESSION_CALL_OFFERED",
      "receipt.create",
    ]);
  });

  it("refuses a non-canonical call without creating provider intent", async () => {
    const fake = fakeDatabase({ effectOwner: "LEGACY" });

    await expect(claimCall(fake.store, actor, input, now)).rejects.toEqual(
      new ClaimCallError("Canonical routing does not own this call", 409),
    );
    expect(fake.operations).not.toContain("command.create");
    expect(fake.operations).not.toContain("receipt.create");
  });

  it("reuses a canonical leg after global activation regardless of queue mode", async () => {
    const fake = fakeDatabase({ existing: true, routingMode: "LEGACY" });

    await expect(claimCall(fake.store, actor, input, now)).resolves.toMatchObject({
      legId: "leg-existing",
      providerCommandId: "command-existing",
    });
    expect(fake.operations).not.toContain("command.create");
  });

  it("refuses a stale browser session", async () => {
    const fake = fakeDatabase({ sessionStateVersion: 3 });

    await expect(claimCall(fake.store, actor, input, now)).rejects.toEqual(
      new ClaimCallError("Agent session changed; refresh and try again", 409),
    );
    expect(fake.operations).not.toContain("command.create");
  });

  it("uses membership re-read after the queue lock", async () => {
    const fake = fakeDatabase({ lockedMember: false });

    await expect(claimCall(fake.store, actor, input, now)).rejects.toEqual(
      new ClaimCallError("Agent queue membership is required", 403),
    );
    expect(fake.operations).not.toContain("command.create");
  });

  it("reuses a live same-session leg across a different operation key", async () => {
    const fake = fakeDatabase({ existing: true });
    const receipt = await claimCall(
      fake.store,
      actor,
      { ...input, idempotencyKey: "operation-2" },
      now,
    );

    expect(receipt).toMatchObject({
      legId: "leg-existing",
      providerCommandId: "command-existing",
      status: "SENT",
    });
    expect(fake.operations).not.toContain("leg.create");
    expect(fake.operations).not.toContain("command.create");
    expect(fake.operations.at(-1)).toBe("receipt.create");
  });

  it("accepts a stale UI version after automatic routing reserved the same session", async () => {
    const fake = fakeDatabase({ existing: true, sessionStateVersion: 5 });

    await expect(
      claimCall(fake.store, actor, { ...input, idempotencyKey: "operation-2" }, now),
    ).resolves.toMatchObject({
      legId: "leg-existing",
      providerCommandId: "command-existing",
    });
  });

  it("reports a scheduled retry as pending across HTTP and realtime", async () => {
    const fake = fakeDatabase({
      existing: true,
      existingCommandStatus: "FAILED",
      existingNextAttemptAt: new Date(now.getTime() + 1_000),
    });

    await expect(
      claimCall(fake.store, actor, { ...input, idempotencyKey: "operation-2" }, now),
    ).resolves.toMatchObject({ status: "PENDING" });
  });

  it("replays one exact key without running the mutation twice", async () => {
    const fake = fakeDatabase();
    const first = await claimCall(fake.store, actor, input, now);
    const replay = await claimCall(fake.store, actor, input, now);

    expect(replay).toEqual({ ...first, replayed: true });
    expect(
      fake.operations.filter((operation) => operation === "command.create"),
    ).toHaveLength(1);
  });

  it("refuses terminal, won, and expired claim races", async () => {
    for (const options of [
      { callStatus: "COMPLETED" as const },
      { winningLegId: "leg-winner" },
      { leaseExpired: true },
    ]) {
      const fake = fakeDatabase(options);
      await expect(claimCall(fake.store, actor, input, now)).rejects.toBeInstanceOf(
        ClaimCallError,
      );
      expect(fake.operations).not.toContain("command.create");
    }
  });

  it("requires both the call and endpoint inside selected-location access", async () => {
    for (const options of [
      { callLocationId: "location-2" },
      { endpointLocationId: "location-2" },
    ]) {
      const fake = fakeDatabase(options);
      await expect(claimCall(fake.store, actor, input, now)).rejects.toBeInstanceOf(
        ClaimCallError,
      );
      expect(fake.operations).not.toContain("command.create");
    }
  });
});
