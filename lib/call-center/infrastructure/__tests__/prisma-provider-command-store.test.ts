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
  commandUpdatedAt = now,
  callStatus = "RINGING",
  callDirection = "INBOUND",
  customerLegs = [
    {
      id: "customer-leg",
      kind: "CUSTOMER" as const,
      providerCallControlId: "customer-control-1",
      status: "BRIDGED",
    },
  ],
  dependencyStatus = null,
  legKind = "AGENT",
  legStatus = "CREATED",
  memberUserId = "user-1",
  sessionState = "ACTIVE",
  targetLegStatus = legStatus,
  transferEligibleUserId = memberUserId,
  winningLegId,
}: {
  accessLocationIds?: string[];
  arguments?: Record<string, unknown>;
  commandErrorCode?: string | null;
  commandStatus?: "PENDING" | "SENDING" | "SENT" | "CONFIRMED" | "FAILED";
  commandType?:
    | "ANSWER_CUSTOMER"
    | "START_RINGBACK"
    | "DIAL_AGENT"
    | "TRANSFER_AGENT"
    | "STOP_PLAYBACK"
    | "START_HOLD_MUSIC"
    | "STOP_HOLD_MUSIC"
    | "HANGUP_LEG"
    | "PLAY_VOICEMAIL_GREETING"
    | "START_RECORDING";
  commandUpdatedAt?: Date;
  callStatus?:
    | "RECEIVED"
    | "QUEUED"
    | "RINGING"
    | "CONNECTED"
    | "COMPLETED"
    | "VOICEMAIL"
    | "ABANDONED"
    | "FAILED";
  callDirection?: "INBOUND" | "OUTBOUND";
  customerLegs?: Array<{
    id: string;
    kind: "CUSTOMER";
    providerCallControlId: string;
    status: string;
  }>;
  dependencyStatus?: "PENDING" | "SENT" | "CONFIRMED" | "FAILED" | null;
  legKind?: "AGENT" | "CUSTOMER";
  legStatus?: "CREATED" | "ANSWERED" | "BRIDGED" | "ENDED";
  memberUserId?: string | null;
  sessionState?: "ACTIVE" | "OFFERED";
  targetLegStatus?:
    "ANSWERED" | "BRIDGED" | "CREATED" | "DIALING" | "ENDED" | "FAILED" | "RINGING";
  transferEligibleUserId?: string | null;
  winningLegId?: string | null;
} = {}) {
  let updates = 0;
  let currentTargetLegStatus = targetLegStatus;
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
    $queryRaw: async (query: { values?: unknown[] }) => {
      operations.push(
        query.values?.includes("CALL_CENTER:practice-1") ? "practice.lock" : "row.lock",
      );
      return [{ id: "command-1" }];
    },
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
      findFirst: async ({
        where,
      }: {
        where: {
          id?: string | Record<string, unknown>;
          status?: { in: string[] };
        };
      }) =>
        where.id
          ? where.id === "source-leg"
            ? {
                callId: "call-1",
                endpoint: { userId: "source-user" },
                endpointId: "source-endpoint",
                id: "source-leg",
                kind: "AGENT",
                providerCallControlId: "source-control-1",
                status: "BRIDGED",
              }
            : where.id === "leg-1"
              ? !where.status || where.status.in.includes(currentTargetLegStatus)
                ? { id: "leg-1" }
                : null
              : (customerLegs.find(({ id }) => id === where.id) ?? null)
          : (customerLegs[0] ?? null),
      findMany: async () => customerLegs,
      updateMany: async ({
        data,
        where,
      }: {
        data: { status?: typeof currentTargetLegStatus };
        where: { id?: string; status?: { in: string[] } };
      }) => {
        operations.push("leg.reject");
        if (
          where.id === "leg-1" &&
          (!where.status || where.status.in.includes(currentTargetLegStatus))
        ) {
          currentTargetLegStatus = data.status ?? currentTargetLegStatus;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    callCenterCommand: {
      findMany: async () => [],
      findUnique: async () => ({
        arguments: commandArguments,
        attemptCount: 0,
        call: {
          direction: callDirection,
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
          winningLegId:
            winningLegId === undefined
              ? commandType === "TRANSFER_AGENT"
                ? "source-leg"
                : null
              : winningLegId,
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
          providerCallControlId: ["DIAL_AGENT", "TRANSFER_AGENT"].includes(commandType)
            ? null
            : "customer-control-1",
          status: currentTargetLegStatus,
        },
        practice: {
          callCenterSettings: { telnyxConnectionId: "connection-1" },
        },
        practiceId: "practice-1",
        status: commandStatus,
        type: commandType,
        updatedAt: commandUpdatedAt,
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
    callCenterQueueMember: {
      findFirst: async ({ where }: { where: { userId?: string } }) =>
        where.userId === transferEligibleUserId ? { id: "membership-1" } : null,
    },
    practiceMembership: {
      findUnique: async () => ({
        locationScope: "SELECTED",
        locations: accessLocationIds.map((locationId) => ({ locationId })),
      }),
    },
  };
  return {
    operations,
    targetLegStatus: () => currentTargetLegStatus,
    tx,
    updates: () => updates,
  };
}

describe("Prisma provider command store", () => {
  it("locks the practice before claiming call, queue, command, or endpoint rows", async () => {
    const fake = transaction({ commandStatus: "SENT" });
    const store = new PrismaProviderCommandStore((operation) =>
      operation(fake.tx as never),
    );

    await store.claim({
      commandId: "command-1",
      now,
      staleBefore: new Date(now.getTime() - 60_000),
    });

    expect(fake.operations.slice(0, 2)).toEqual(["practice.lock", "row.lock"]);
  });

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

  it("claims one cold transfer against the current source leg", async () => {
    const fake = transaction({
      arguments: {
        agentSessionId: "session-1",
        endpointId: "endpoint-1",
        providerSourceLegId: "customer-leg",
        sourceLegId: "source-leg",
      },
      callStatus: "CONNECTED",
      commandType: "TRANSFER_AGENT",
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
      attemptCount: 1,
      command: {
        arguments: {
          agentSessionId: "session-1",
          endpointId: "endpoint-1",
          providerSourceLegId: "customer-leg",
          sourceLegId: "source-leg",
        },
        provider: {
          callControlId: "customer-control-1",
          sipUri: "sip:agent-1@example.test",
          strategy: "TRANSFER",
          timeoutSeconds: 20,
        },
        type: "TRANSFER_AGENT",
      },
    });
  });

  it("claims a cold transfer for an agent in another same-location queue", async () => {
    const fake = transaction({
      arguments: {
        agentSessionId: "session-1",
        endpointId: "endpoint-1",
        providerSourceLegId: "customer-leg",
        sourceLegId: "source-leg",
      },
      callStatus: "CONNECTED",
      commandType: "TRANSFER_AGENT",
      memberUserId: null,
      sessionState: "OFFERED",
      transferEligibleUserId: "user-1",
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
      command: { type: "TRANSFER_AGENT" },
    });
  });

  it("reclaims an answered cold transfer after an interrupted send", async () => {
    const fake = transaction({
      arguments: {
        agentSessionId: "session-1",
        endpointId: "endpoint-1",
        providerSourceLegId: "customer-leg",
        sourceLegId: "source-leg",
      },
      callStatus: "CONNECTED",
      commandStatus: "SENDING",
      commandType: "TRANSFER_AGENT",
      commandUpdatedAt: new Date(now.getTime() - 120_000),
      sessionState: "OFFERED",
      targetLegStatus: "ANSWERED",
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
      attemptCount: 1,
      command: { type: "TRANSFER_AGENT" },
    });
    expect(fake.operations).not.toContain("command.reject");
  });

  it("terminally settles an answered transfer target when retry authorization changed", async () => {
    const fake = transaction({
      arguments: {
        agentSessionId: "session-1",
        endpointId: "endpoint-1",
        providerSourceLegId: "customer-leg",
        sourceLegId: "source-leg",
      },
      callStatus: "CONNECTED",
      commandStatus: "SENDING",
      commandType: "TRANSFER_AGENT",
      commandUpdatedAt: new Date(now.getTime() - 120_000),
      memberUserId: null,
      sessionState: "OFFERED",
      targetLegStatus: "ANSWERED",
    });
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
    expect(fake.targetLegStatus()).toBe("FAILED");
  });

  it("claims an answered direct outbound leg without a winner", async () => {
    const fake = transaction({
      arguments: {
        agentSessionId: "session-1",
        endpointId: "endpoint-1",
        providerSourceLegId: "source-leg",
        sourceLegId: "source-leg",
      },
      callDirection: "OUTBOUND",
      callStatus: "CONNECTED",
      commandType: "TRANSFER_AGENT",
      sessionState: "OFFERED",
      winningLegId: null,
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
        provider: {
          callControlId: "source-control-1",
          connectionId: "connection-1",
          from: "+17865550101",
          strategy: "DIAL_BRIDGE",
        },
      },
    });
  });

  it("links an inbound dial to the first live customer leg", async () => {
    const fake = transaction({
      customerLegs: [
        {
          id: "customer-1",
          kind: "CUSTOMER",
          providerCallControlId: "original-customer",
          status: "ANSWERED",
        },
        {
          id: "customer-2",
          kind: "CUSTOMER",
          providerCallControlId: "duplicate-customer",
          status: "ANSWERED",
        },
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

  it("keeps an inbound dial pending until the customer leg is answered", async () => {
    const fake = transaction({
      customerLegs: [],
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
    ).resolves.toBeNull();
    expect(fake.operations).not.toContain("command.reject");
    expect(fake.operations).not.toContain("leg.reject");
    expect(fake.updates()).toBe(0);
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

  it("claims hold music commands only against an active agent leg", async () => {
    for (const commandType of ["START_HOLD_MUSIC", "STOP_HOLD_MUSIC"] as const) {
      const fake = transaction({
        arguments: {},
        callStatus: "CONNECTED",
        commandType,
        legKind: "AGENT",
        legStatus: "BRIDGED",
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
          arguments: {},
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
