import { describe, expect, it } from "bun:test";

import type { ValidatedCallCenterConfiguration } from "@/lib/call-center/application/configuration";
import {
  type ConfigurationPrismaTransaction,
  type ConfigurationReadClient,
  type ConfigurationTransactionRunner,
  PrismaCallCenterConfigurationRepository,
  readCallCenterConfiguration,
} from "@/lib/call-center/infrastructure/prisma-configuration-repository";

type RecordedOperation = { name: string; input: unknown };

function configuration(): ValidatedCallCenterConfiguration {
  return {
    practiceId: "practice-1",
    defaultOutboundNumberId: "number-1",
    queues: [
      {
        id: "queue-1",
        name: "Optical",
        enabled: true,
        voicemailEnabled: true,
        voicemailGreeting: "Leave a message.",
        locationIds: ["location-1"],
        members: [{ userId: "user-1", role: "AGENT", enabled: true }],
      },
      {
        id: "queue-2",
        name: "Overflow",
        enabled: false,
        voicemailEnabled: true,
        voicemailGreeting: "Leave a message.",
        locationIds: ["location-1"],
        members: [],
      },
    ],
    numbers: [
      {
        id: "number-1",
        practicePhoneNumberId: "phone-1",
        providerNumberId: "provider-number-1",
        inboundQueueId: "queue-1",
        inboundEnabled: true,
        outboundEnabled: true,
        enabled: true,
      },
    ],
    endpoints: [
      {
        id: "endpoint-1",
        userId: "user-1",
        locationId: "location-1",
        label: "Front desk",
        providerCredentialId: "credential-1",
        sipUsername: "sip-1",
        enabled: true,
      },
    ],
  };
}

function persistenceTransaction(operations: RecordedOperation[], failAt?: string) {
  const delegate = (name: string) =>
    new Proxy<Record<string, unknown>>(
      {},
      {
        get(_target, method) {
          return async (input: unknown) => {
            const operationName = `${name}.${String(method)}`;
            operations.push({ name: operationName, input });
            if (operationName === failAt) throw new Error("simulated write failure");
            return { count: 0 };
          };
        },
      },
    );

  return {
    callCenterQueue: delegate("callCenterQueue"),
    callCenterQueueLocation: delegate("callCenterQueueLocation"),
    callCenterQueueMember: delegate("callCenterQueueMember"),
    callCenterNumber: delegate("callCenterNumber"),
    callCenterEndpoint: delegate("callCenterEndpoint"),
    callCenterEvent: delegate("callCenterEvent"),
    practiceCallCenterSettings: delegate("practiceCallCenterSettings"),
  } as unknown as ConfigurationPrismaTransaction;
}

function recordingRunner(failAt?: string) {
  const committed: RecordedOperation[] = [];
  const runner: ConfigurationTransactionRunner = async (operation) => {
    const pending: RecordedOperation[] = [];
    const result = await operation(persistenceTransaction(pending, failAt));
    committed.push(...pending);
    return result;
  };
  return { committed, runner };
}

describe("Prisma call-center configuration persistence", () => {
  it("reconciles only submitted rows and writes dependencies before references", async () => {
    const { committed, runner } = recordingRunner();
    const repository = new PrismaCallCenterConfigurationRepository(runner);

    await repository.transaction((transaction) =>
      transaction.persistValidatedSnapshot(configuration(), {
        actorUserId: "admin-1",
        previousVersion: "version-1",
      }),
    );

    const names = committed.map(({ name }) => name);
    expect(names.indexOf("callCenterQueue.upsert")).toBeLessThan(
      names.indexOf("callCenterQueueLocation.createMany"),
    );
    expect(names.indexOf("callCenterQueueLocation.createMany")).toBeLessThan(
      names.indexOf("callCenterQueueMember.upsert"),
    );
    expect(names.indexOf("callCenterNumber.upsert")).toBeLessThan(
      names.indexOf("practiceCallCenterSettings.upsert"),
    );
    expect(names.indexOf("practiceCallCenterSettings.upsert")).toBeLessThan(
      names.indexOf("callCenterEvent.create"),
    );
    const audit = committed.find(({ name }) => name === "callCenterEvent.create");
    expect(audit).toMatchObject({
      input: {
        data: {
          actorUserId: "admin-1",
          aggregateType: "CONFIGURATION",
          data: {
            counts: { endpoints: 1, memberships: 1, numbers: 1, queues: 2 },
            fromVersion: "version-1",
            toVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
          type: "CONFIGURATION_UPDATED",
        },
      },
    });
    expect(JSON.stringify(audit)).not.toContain("credential-1");
    expect(JSON.stringify(audit)).not.toContain("provider-number-1");

    expect(names.filter((name) => name.endsWith(".updateMany"))).toEqual([
      "callCenterQueueMember.updateMany",
    ]);
  });

  it("commits no partial writes when a later persistence step fails", async () => {
    const { committed, runner } = recordingRunner("callCenterEndpoint.upsert");
    const repository = new PrismaCallCenterConfigurationRepository(runner);

    await expect(
      repository.transaction((transaction) =>
        transaction.persistValidatedSnapshot(configuration(), {
          actorUserId: "admin-1",
          previousVersion: "version-1",
        }),
      ),
    ).rejects.toThrow("simulated write failure");
    expect(committed).toEqual([]);
  });

  it("locks the practice before loading tenant and global ownership", async () => {
    const calls: string[] = [];
    const transaction = {
      $queryRaw: async () => {
        calls.push("lock");
        return [{ id: "practice-1" }];
      },
      practice: {
        findUnique: async () => ({
          id: "practice-1",
          callCenterSettings: null,
          callCenterQueues: [],
          callCenterNumbers: [],
          callCenterEndpoints: [],
        }),
      },
      practiceLocation: {
        findMany: async () => {
          calls.push("locations");
          return [{ id: "location-1" }];
        },
      },
      practicePhoneNumber: {
        findMany: async () => [{ id: "phone-1", locationId: "location-1" }],
      },
      practiceMembership: {
        findMany: async () => [{ userId: "user-1" }],
      },
      callCenterQueue: {
        findMany: async () => [{ id: "queue-1", practiceId: "practice-1" }],
      },
      callCenterNumber: {
        findMany: async () => [
          {
            id: "number-1",
            practiceId: "practice-1",
            providerNumberId: "provider-number-1",
          },
        ],
      },
      callCenterEndpoint: {
        findMany: async () => [
          {
            id: "endpoint-other",
            practiceId: "practice-2",
            providerCredentialId: "credential-1",
            sipUsername: "sip-1",
          },
        ],
      },
    } as unknown as ConfigurationPrismaTransaction;
    const runner: ConfigurationTransactionRunner = (operation) => operation(transaction);
    const repository = new PrismaCallCenterConfigurationRepository(runner);

    const context = await repository.transaction((scope) =>
      scope.loadValidationContextForUpdate("practice-1", {
        queueIds: ["queue-1"],
        numberIds: ["number-1"],
        endpointIds: ["endpoint-1"],
        locationIds: ["location-1"],
        practicePhoneNumberIds: ["phone-1"],
        providerNumberIds: ["provider-number-1"],
        memberUserIds: ["user-1"],
        providerCredentialIds: ["credential-1"],
        sipUsernames: ["sip-1"],
      }),
    );

    expect(calls[0]).toBe("lock");
    expect(context).toMatchObject({
      practiceExists: true,
      configurationVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
      queueOwnerPracticeIds: new Map([["queue-1", "practice-1"]]),
      providerCredentialEndpointIds: new Map([["credential-1", "endpoint-other"]]),
      providerNumberOwnerNumberIds: new Map([["provider-number-1", "number-1"]]),
      practicePhoneNumberLocationIds: new Map([["phone-1", "location-1"]]),
      sipUsernameEndpointIds: new Map([["sip-1", "endpoint-other"]]),
    });
  });
});

describe("call-center configuration read model", () => {
  it("selects only setup identifiers and returns a stable full snapshot", async () => {
    let query: unknown;
    const client = {
      practice: {
        findUnique: async (input: unknown) => {
          query = input;
          return {
            id: "practice-1",
            callCenterSettings: { defaultOutboundNumberId: null },
            callCenterQueues: [],
            callCenterNumbers: [],
            callCenterEndpoints: [],
          };
        },
      },
    } as unknown as ConfigurationReadClient;

    expect(await readCallCenterConfiguration("practice-1", client)).toEqual({
      configuration: {
        practiceId: "practice-1",
        defaultOutboundNumberId: null,
        queues: [],
        numbers: [],
        endpoints: [],
      },
      version: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(query).toMatchObject({
      select: {
        callCenterSettings: { select: { defaultOutboundNumberId: true } },
        callCenterEndpoints: {
          select: {
            providerCredentialId: true,
            sipUsername: true,
          },
        },
      },
    });
  });
});
