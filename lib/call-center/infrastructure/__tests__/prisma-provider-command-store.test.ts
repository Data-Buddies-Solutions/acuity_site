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
    arguments: commandArguments = {
      agentSessionId: "session-1",
      endpointId: "endpoint-1",
    },
    commandType = "DIAL_AGENT",
    callStatus = "RINGING",
    callDirection = "INBOUND",
    customerLegs = [{ providerCallControlId: "customer-control-1" }],
    dependencyNextAttemptAt,
    dependencyStatus = null,
    effectOwner = "CANONICAL",
    legKind = "AGENT",
    memberUserId = "user-1",
    sessionState = "ACTIVE",
    sourceProviderCallControlId = "source-control-1",
    winningLegId,
  }: {
    accessLocationIds?: string[];
    arguments?: Record<string, unknown>;
    commandType?:
      | "ANSWER_CUSTOMER"
      | "START_RINGBACK"
      | "DIAL_AGENT"
      | "STOP_PLAYBACK"
      | "HANGUP_LEG"
      | "PLAY_VOICEMAIL_GREETING"
      | "START_RECORDING";
    callStatus?:
      | "RECEIVED"
      | "QUEUED"
      | "RINGING"
      | "CONNECTED"
      | "WRAP_UP"
      | "COMPLETED"
      | "VOICEMAIL"
      | "ABANDONED"
      | "FAILED";
    callDirection?: "INBOUND" | "OUTBOUND";
    customerLegs?: Array<{ providerCallControlId: string }>;
    dependencyStatus?: "PENDING" | "SENT" | "CONFIRMED" | "FAILED" | null;
    dependencyNextAttemptAt?: Date | null;
    effectOwner?: "CANONICAL" | "LEGACY";
    legKind?: "AGENT" | "CUSTOMER";
    memberUserId?: string | null;
    sessionState?: "ACTIVE" | "OFFERED";
    sourceProviderCallControlId?: string | null;
    winningLegId?: string | null;
  } = {},
) {
  let updates = 0;
  const operations: string[] = [];
  const session = {
    audioReady: true,
    connectionState: "READY",
    currentCallId: sessionState === "ACTIVE" ? "call-1" : null,
    offeredCallId: sessionState === "OFFERED" ? "call-1" : null,
    endpointId: "endpoint-1",
    id: "session-1",
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    microphoneReady: true,
    practiceId: "practice-1",
    presence: sessionState === "ACTIVE" ? "BUSY" : "AVAILABLE",
    stateVersion: 2,
    userId: "user-1",
  };
  const replacesLegId =
    typeof commandArguments.replacesLegId === "string"
      ? commandArguments.replacesLegId
      : null;
  const resolvedWinningLegId = winningLegId === undefined ? replacesLegId : winningLegId;
  const resolvedDependencyNextAttemptAt =
    dependencyNextAttemptAt === undefined && dependencyStatus === "FAILED"
      ? new Date(now.getTime() + 60_000)
      : (dependencyNextAttemptAt ?? null);
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
      findFirst: async ({ where }: { where: { id?: string } }) =>
        where.id
          ? where.id === replacesLegId
            ? { id: replacesLegId, providerCallControlId: sourceProviderCallControlId }
            : null
          : (customerLegs[0] ?? null),
      findMany: async () => customerLegs,
      updateMany: async () => {
        operations.push("leg.reject");
        return { count: 1 };
      },
    },
    callCenterCommand: {
      findMany: async () => [],
      findUnique: async () => ({
        arguments: commandArguments,
        attemptCount: 0,
        call: {
          direction: callDirection,
          effectOwner,
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
          status: callStatus,
          winningLegId: resolvedWinningLegId,
        },
        callId: "call-1",
        dependsOnCommand: dependencyStatus
          ? {
              callId: "call-1",
              nextAttemptAt: resolvedDependencyNextAttemptAt,
              practiceId: "practice-1",
              status: dependencyStatus,
            }
          : null,
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
          providerCallControlId:
            commandType === "DIAL_AGENT" ? null : "customer-control-1",
          status: "CREATED",
        },
        nextAttemptAt: null,
        practice: {
          callCenterSettings: { enabled: true, telnyxConnectionId: "connection-1" },
        },
        practiceId: "practice-1",
        status: "PENDING",
        type: commandType,
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
    const fake = transaction("ACTIVE", { sessionState: "OFFERED" });
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

  it("rechecks the exact bridged source before dispatching a transfer dial", async () => {
    const transferArguments = {
      agentSessionId: "session-1",
      endpointId: "endpoint-1",
      replacesLegId: "source-leg",
    };
    const transfer = transaction("ACTIVE", {
      arguments: transferArguments,
      callStatus: "CONNECTED",
      sessionState: "OFFERED",
    });
    const store = new PrismaProviderCommandStore((operation) =>
      operation(transfer.tx as never),
    );

    await expect(
      store.claim({
        commandId: "command-1",
        maxAttempts: 5,
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toMatchObject({
      command: {
        arguments: transferArguments,
        provider: { linkTo: "customer-control-1" },
        type: "DIAL_AGENT",
      },
    });

    const changedSource = transaction("ACTIVE", {
      arguments: transferArguments,
      callStatus: "CONNECTED",
      winningLegId: "other-source",
    });
    const changedStore = new PrismaProviderCommandStore((operation) =>
      operation(changedSource.tx as never),
    );
    await expect(
      changedStore.claim({
        commandId: "command-1",
        maxAttempts: 5,
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toBeNull();
    expect(changedSource.operations).toContain("leg.reject");
    expect(changedSource.operations).toContain("session.release");
  });

  it("links inbound transfers to the first live customer leg", async () => {
    const fake = transaction("ACTIVE", {
      arguments: {
        agentSessionId: "session-1",
        endpointId: "endpoint-1",
        replacesLegId: "source-leg",
      },
      callStatus: "CONNECTED",
      customerLegs: [
        { providerCallControlId: "original-customer" },
        { providerCallControlId: "duplicate-customer" },
      ],
      sessionState: "OFFERED",
    });
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
    ).resolves.toMatchObject({
      command: { provider: { linkTo: "original-customer" } },
    });
  });

  it("links outbound transfers to the connected source leg", async () => {
    const fake = transaction("ACTIVE", {
      arguments: {
        agentSessionId: "session-1",
        endpointId: "endpoint-1",
        replacesLegId: "source-leg",
      },
      callDirection: "OUTBOUND",
      callStatus: "CONNECTED",
      customerLegs: [],
      sessionState: "OFFERED",
      sourceProviderCallControlId: "outbound-source",
    });
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
    ).resolves.toMatchObject({
      command: { provider: { linkTo: "outbound-source" } },
    });
  });

  it("uses immutable call ownership instead of mutable queue mode", async () => {
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
      ).resolves.toMatchObject({ command: { type: "DIAL_AGENT" } });
      expect(fake.updates()).toBe(1);
    }

    const legacyCall = transaction("ACTIVE", { effectOwner: "LEGACY" });
    const store = new PrismaProviderCommandStore((operation) =>
      operation(legacyCall.tx as never),
    );
    await expect(
      store.claim({
        commandId: "command-1",
        maxAttempts: 5,
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toBeNull();
    expect(legacyCall.operations).toContain("command.reject");
  });

  it("claims initial inbound lifecycle commands with typed sanitized arguments", async () => {
    const cases = [
      ["ANSWER_CUSTOMER", {}, {}],
      ["START_RINGBACK", { timeoutSeconds: 30 }, { timeoutSeconds: 30 }],
      ["STOP_PLAYBACK", {}, {}],
      ["HANGUP_LEG", {}, {}],
      [
        "PLAY_VOICEMAIL_GREETING",
        { greeting: "  Please leave a message.  " },
        { greeting: "Please leave a message." },
      ],
      ["START_RECORDING", {}, {}],
    ] as const;

    for (const [commandType, args, expectedArgs] of cases) {
      const fake = transaction("SHADOW", {
        arguments: args,
        commandType,
        legKind: "CUSTOMER",
      });
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
      ).resolves.toMatchObject({
        command: {
          arguments: expectedArgs,
          provider: { callControlId: "customer-control-1" },
          type: commandType,
        },
      });
    }
  });

  it("waits for a predecessor to be sent or confirmed", async () => {
    for (const dependencyStatus of ["PENDING", "FAILED"] as const) {
      const fake = transaction("ACTIVE", {
        arguments: {},
        commandType: "START_RECORDING",
        dependencyStatus,
        legKind: "CUSTOMER",
      });
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
      expect(fake.operations).not.toContain("command.reject");
    }

    for (const dependencyStatus of ["SENT", "CONFIRMED"] as const) {
      const fake = transaction("ACTIVE", {
        arguments: {},
        commandType: "START_RECORDING",
        dependencyStatus,
        legKind: "CUSTOMER",
      });
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
      ).resolves.toMatchObject({ command: { type: "START_RECORDING" } });
    }
  });

  it("terminally rejects a command whose prerequisite cannot recover", async () => {
    const fake = transaction("ACTIVE", {
      arguments: {},
      commandType: "START_RECORDING",
      dependencyNextAttemptAt: null,
      dependencyStatus: "FAILED",
      legKind: "CUSTOMER",
    });
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
    expect(fake.updates()).toBe(0);
  });

  it("dispatches committed lifecycle effects after their terminal projection", async () => {
    const cases = [
      ["VOICEMAIL", "ANSWER_CUSTOMER", {}],
      ["VOICEMAIL", "START_RINGBACK", { timeoutSeconds: 20 }],
      ["VOICEMAIL", "STOP_PLAYBACK", {}],
      ["VOICEMAIL", "PLAY_VOICEMAIL_GREETING", { greeting: "Please leave a message." }],
      ["VOICEMAIL", "START_RECORDING", {}],
      ["ABANDONED", "STOP_PLAYBACK", {}],
      ["ABANDONED", "HANGUP_LEG", {}],
    ] as const;

    for (const [callStatus, commandType, args] of cases) {
      const fake = transaction("ACTIVE", {
        arguments: args,
        callStatus,
        commandType,
        legKind: "CUSTOMER",
      });
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
      ).resolves.toMatchObject({ command: { type: commandType } });
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
        findMany: async () => [],
        findUnique: async ({ select }: { select: Record<string, unknown> }) =>
          "leg" in select
            ? {
                callId: "call-1",
                leg: { agentSessionId: "session-1", id: "leg-1" },
                practiceId: "practice-1",
                type: "DIAL_AGENT",
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
