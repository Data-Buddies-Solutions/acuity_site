import { describe, expect, it } from "bun:test";

import {
  PrismaProviderCommandStore,
  type ProviderCommandTransactionRunner,
} from "../prisma-provider-command-store";

const now = new Date("2026-07-12T12:00:00.000Z");
const noFollowUpReconciliation = async () => ({
  callId: "call-1",
  commandIds: [],
  decision: null,
  status: "APPLIED" as const,
});

function rejectingStore(tx: unknown) {
  return new PrismaProviderCommandStore(
    (operation) => operation(tx as never),
    noFollowUpReconciliation,
  );
}

function transaction({
  accessLocationIds = ["location-1"],
  arguments: commandArguments = {
    agentSessionId: "session-1",
    endpointId: "endpoint-1",
  },
  commandErrorCode = null,
  commandStatus = "PENDING",
  commandType = "DIAL_AGENT",
  callStatus = "RINGING",
  customerLegs = [{ providerCallControlId: "customer-control-1" }],
  dependencyStatus = null,
  effectOwner = "CANONICAL",
  legKind = "AGENT",
  memberUserId = "user-1",
  sessionState = "ACTIVE",
}: {
  accessLocationIds?: string[];
  arguments?: Record<string, unknown>;
  commandErrorCode?: string | null;
  commandStatus?: "PENDING" | "SENDING" | "SENT" | "CONFIRMED" | "FAILED";
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
    | "COMPLETED"
    | "VOICEMAIL"
    | "ABANDONED"
    | "FAILED";
  customerLegs?: Array<{ providerCallControlId: string }>;
  dependencyStatus?: "PENDING" | "SENT" | "CONFIRMED" | "FAILED" | null;
  effectOwner?: "CANONICAL" | "LEGACY";
  legKind?: "AGENT" | "CUSTOMER";
  memberUserId?: string | null;
  sessionState?: "ACTIVE" | "OFFERED";
} = {}) {
  let updates = 0;
  const operations: string[] = [];
  const session = {
    audioReady: true,
    connectionState: "READY",
    endpointId: "endpoint-1",
    id: "session-1",
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    microphoneReady: true,
    practiceId: "practice-1",
    presence: sessionState === "ACTIVE" ? "BUSY" : "AVAILABLE",
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
      findFirst: async ({ where }: { where: { id?: string } }) =>
        where.id
          ? where.id === "leg-1"
            ? { id: "leg-1" }
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
          },
          status: callStatus,
          winningLegId: null,
        },
        callId: "call-1",
        dependsOnCommand: dependencyStatus
          ? {
              callId: "call-1",
              practiceId: "practice-1",
              status: dependencyStatus,
            }
          : null,
        errorCode: commandErrorCode,
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
        practice: {
          callCenterSettings: { telnyxConnectionId: "connection-1" },
        },
        practiceId: "practice-1",
        status: commandStatus,
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
  it("reports settled and failed commands without sending them again", async () => {
    for (const commandStatus of ["SENT", "CONFIRMED"] as const) {
      const fake = transaction({ commandStatus });
      const store = new PrismaProviderCommandStore((operation) =>
        operation(fake.tx as never),
      );
      await expect(
        store.claim({
          commandId: "command-1",
          now,
          staleBefore: new Date(now.getTime() - 60_000),
        }),
      ).resolves.toEqual({ commandId: "command-1", settled: true });
      expect(fake.updates()).toBe(0);
    }

    const failed = transaction({
      commandErrorCode: "PROVIDER_VALIDATION_FAILED",
      commandStatus: "FAILED",
    });
    const store = new PrismaProviderCommandStore((operation) =>
      operation(failed.tx as never),
    );
    await expect(
      store.claim({
        commandId: "command-1",
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toEqual({
      commandId: "command-1",
      errorCode: "PROVIDER_VALIDATION_FAILED",
      followUpCommandIds: [],
      rejected: true,
    });
    expect(failed.updates()).toBe(0);
  });

  it("claims one dial with provider details resolved only in memory", async () => {
    const fake = transaction({ sessionState: "OFFERED" });
    const runner: ProviderCommandTransactionRunner = (operation) =>
      operation(fake.tx as never);
    const store = new PrismaProviderCommandStore(runner);

    await expect(
      store.claim({
        commandId: "command-1",
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

  it("links an inbound dial to the first live customer leg", async () => {
    const fake = transaction({
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
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toMatchObject({
      command: { provider: { linkTo: "original-customer" } },
    });
  });

  it("rejects provider effects for a non-canonical call", async () => {
    const legacyCall = transaction({ effectOwner: "LEGACY" });
    const store = rejectingStore(legacyCall.tx);
    await expect(
      store.claim({
        commandId: "command-1",
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toMatchObject({
      errorCode: "COMMAND_CALL_NOT_CANONICAL",
      rejected: true,
    });
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
      const fake = transaction({
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

  it("returns voicemail commands when ringback is rejected before send", async () => {
    const fake = transaction({
      arguments: { timeoutSeconds: 0 },
      commandType: "START_RINGBACK",
      legKind: "CUSTOMER",
    });
    const store = new PrismaProviderCommandStore(
      (operation) => operation(fake.tx as never),
      async () => ({
        callId: "call-1",
        commandIds: ["stop-command", "voicemail-command"],
        decision: null,
        status: "APPLIED",
      }),
    );

    await expect(
      store.claim({
        commandId: "command-1",
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toEqual({
      commandId: "command-1",
      errorCode: "COMMAND_ARGUMENTS_INVALID",
      followUpCommandIds: ["stop-command", "voicemail-command"],
      rejected: true,
    });
  });

  it("waits for a predecessor to be sent or confirmed", async () => {
    for (const dependencyStatus of ["PENDING"] as const) {
      const fake = transaction({
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
          now,
          staleBefore: new Date(now.getTime() - 60_000),
        }),
      ).resolves.toBeNull();
      expect(fake.updates()).toBe(0);
      expect(fake.operations).not.toContain("command.reject");
    }

    for (const dependencyStatus of ["SENT", "CONFIRMED"] as const) {
      const fake = transaction({
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
          now,
          staleBefore: new Date(now.getTime() - 60_000),
        }),
      ).resolves.toMatchObject({ command: { type: "START_RECORDING" } });
    }
  });

  it("terminally rejects a command whose prerequisite cannot recover", async () => {
    const fake = transaction({
      arguments: {},
      commandType: "START_RECORDING",
      dependencyStatus: "FAILED",
      legKind: "CUSTOMER",
    });
    const store = rejectingStore(fake.tx);

    await expect(
      store.claim({
        commandId: "command-1",
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toMatchObject({
      errorCode: "COMMAND_DEPENDENCY_FAILED",
      rejected: true,
    });
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
      const fake = transaction({
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
          now,
          staleBefore: new Date(now.getTime() - 60_000),
        }),
      ).resolves.toMatchObject({ command: { type: commandType } });
    }
  });

  it("rejects an invalid command without mutating its unrelated leg", async () => {
    const fake = transaction({ legKind: "CUSTOMER" });
    const store = rejectingStore(fake.tx);

    await expect(
      store.claim({
        commandId: "command-1",
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toMatchObject({
      errorCode: "COMMAND_AGENT_LEG_INVALID",
      rejected: true,
    });
    expect(fake.operations).toContain("command.reject");
    expect(fake.operations).not.toContain("leg.reject");
    expect(fake.operations).not.toContain("session.release");
  });

  it("terminally rejects the actual agent leg when its dial command is invalid", async () => {
    const fake = transaction({
      arguments: {
        agentSessionId: "session-1",
        endpointId: "different-endpoint",
      },
    });
    const store = rejectingStore(fake.tx);

    await expect(
      store.claim({
        commandId: "command-1",
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toMatchObject({
      errorCode: "COMMAND_AGENT_LEG_INVALID",
      rejected: true,
    });
    expect(fake.operations).toContain("command.reject");
    expect(fake.operations).toContain("leg.reject");
    expect(fake.operations).not.toContain("session.release");
  });

  it("rechecks agent membership before the provider effect", async () => {
    const fake = transaction({ memberUserId: null, sessionState: "OFFERED" });
    const store = rejectingStore(fake.tx);

    await expect(
      store.claim({
        commandId: "command-1",
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toMatchObject({
      errorCode: "COMMAND_AGENT_MEMBERSHIP_INVALID",
      rejected: true,
    });
    expect(fake.operations).toContain("leg.reject");
    expect(fake.operations).not.toContain("session.release");
    expect(fake.updates()).toBe(0);
  });

  it("rechecks practice location access before the provider effect", async () => {
    const fake = transaction({ accessLocationIds: [], sessionState: "OFFERED" });
    const store = rejectingStore(fake.tx);

    await expect(
      store.claim({
        commandId: "command-1",
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      }),
    ).resolves.toMatchObject({
      errorCode: "COMMAND_AGENT_LOCATION_ACCESS_INVALID",
      rejected: true,
    });
    expect(fake.operations).not.toContain("session.release");
    expect(fake.updates()).toBe(0);
  });

  it("never regresses a callback-confirmed command to SENT", async () => {
    const commands = {
      findMany: async () => [],
      findUnique: async () => ({ attemptCount: 1, status: "CONFIRMED" }),
      updateMany: async () => ({ count: 0 }),
    };
    const store = new PrismaProviderCommandStore((operation) =>
      operation({ callCenterCommand: commands } as never),
    );

    await expect(
      store.markSent({ attemptCount: 1, commandId: "command-1", now }),
    ).resolves.toBe("ALREADY_CONFIRMED");
  });

  it("marks the durable provider command sent", async () => {
    const tx = {
      callCenterCommand: {
        updateMany: async () => ({ count: 1 }),
      },
    };
    const store = new PrismaProviderCommandStore((operation) => operation(tx as never));

    await expect(
      store.markSent({ attemptCount: 1, commandId: "command-1", now }),
    ).resolves.toBe("MARKED");
  });

  it("lists only pending and stale sending commands in stable order", async () => {
    let query: unknown;
    const store = new PrismaProviderCommandStore(
      async () => {
        throw new Error("unused");
      },
      noFollowUpReconciliation,
      {
        findMany: async (input: unknown) => {
          query = input;
          return [{ id: "command-1" }, { id: "command-2" }];
        },
      } as never,
    );
    const staleBefore = new Date(now.getTime() - 60_000);

    await expect(store.listDispatchable({ limit: 25, staleBefore })).resolves.toEqual([
      "command-1",
      "command-2",
    ]);
    expect(query).toEqual({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: 25,
      where: {
        call: { effectOwner: "CANONICAL" },
        OR: [
          { status: "PENDING" },
          { status: "SENDING", updatedAt: { lte: staleBefore } },
        ],
      },
    });
  });

  it("reconciles every terminal provider failure without session pointers", async () => {
    const operations: string[] = [];
    const reconciledTypes: string[] = [];
    let targetType: "DIAL_AGENT" | "START_RINGBACK" | "ANSWER_CUSTOMER" = "DIAL_AGENT";
    const tx = {
      $queryRaw: async () => {
        operations.push("lock");
        return [];
      },
      callCenterAgentSession: {
        findUnique: async () => ({
          audioReady: true,
          connectionState: "READY",
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
                leg: { id: "leg-1", kind: "AGENT" },
                practiceId: "practice-1",
                type: targetType,
              }
            : {
                callId: "call-1",
                practiceId: "practice-1",
                type: targetType,
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
    const store = new PrismaProviderCommandStore(
      (operation) => operation(tx as never),
      async () => {
        reconciledTypes.push(targetType);
        return {
          callId: "call-1",
          commandIds: ["voicemail-command"],
          decision: null,
          status: "APPLIED",
        };
      },
    );

    await expect(
      store.fail({
        attemptCount: 5,
        commandId: "command-1",
        errorCode: "PROVIDER_VALIDATION_FAILED",
        now,
      }),
    ).resolves.toEqual({ commandIds: ["voicemail-command"] });
    expect(operations).toContain("leg.fail");
    expect(operations).not.toContain("session.release");
    expect(operations).toContain("event:CALL_AGENT_DIAL_FAILED");

    targetType = "START_RINGBACK";
    await expect(
      store.fail({
        attemptCount: 5,
        commandId: "ringback-command",
        errorCode: "PROVIDER_VALIDATION_FAILED",
        now,
      }),
    ).resolves.toEqual({ commandIds: ["voicemail-command"] });

    targetType = "ANSWER_CUSTOMER";
    await expect(
      store.fail({
        attemptCount: 5,
        commandId: "answer-command",
        errorCode: "PROVIDER_VALIDATION_FAILED",
        now,
      }),
    ).resolves.toEqual({ commandIds: ["voicemail-command"] });
    expect(reconciledTypes).toEqual(["DIAL_AGENT", "START_RINGBACK", "ANSWER_CUSTOMER"]);
  });
});
