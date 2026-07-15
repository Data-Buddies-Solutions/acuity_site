import { describe, expect, it } from "bun:test";

import {
  CallCenterConfigurationError,
  callCenterConfigurationVersion,
  callCenterMembershipKey,
  type CallCenterConfigurationInput,
  type CallCenterConfigurationRepository,
  type CallCenterConfigurationValidationContext,
  saveCallCenterConfiguration,
  validateCallCenterConfiguration,
} from "@/lib/call-center/application/configuration";

function validInput(): CallCenterConfigurationInput {
  return {
    practiceId: " practice-1 ",
    defaultOutboundNumberId: "number-1",
    queues: [
      {
        id: "queue-1",
        name: " Optical ",
        enabled: true,
        ringTimeoutSec: 20,
        maxWaitSec: 30,
        wrapUpSec: 0,
        voicemailEnabled: true,
        voicemailGreeting: " Please leave a message. ",
        overflowQueueId: null,
        locationIds: ["location-1"],
        members: [{ userId: "user-1", role: "AGENT", enabled: true }],
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
        label: " Optical Front Desk ",
        providerCredentialId: "credential-1",
        sipUsername: "sip-optical-1",
        enabled: true,
      },
    ],
  };
}

function validContext(): CallCenterConfigurationValidationContext {
  return {
    practiceExists: true,
    configurationVersion: "version-1",
    ownedLocationIds: new Set(["location-1"]),
    ownedPracticePhoneNumberIds: new Set(["phone-1"]),
    practicePhoneNumberLocationIds: new Map([["phone-1", "location-1"]]),
    practiceMemberUserIds: new Set(["user-1"]),
    queueOwnerPracticeIds: new Map([["queue-1", "practice-1"]]),
    numberOwnerPracticeIds: new Map([["number-1", "practice-1"]]),
    endpointOwnerPracticeIds: new Map([["endpoint-1", "practice-1"]]),
    providerCredentialEndpointIds: new Map([["credential-1", "endpoint-1"]]),
    providerNumberOwnerNumberIds: new Map([["provider-number-1", "number-1"]]),
    sipUsernameEndpointIds: new Map([["sip-optical-1", "endpoint-1"]]),
    enabledQueueIds: new Set(),
    enabledNumberIds: new Set(),
    enabledEndpointIds: new Set(),
    enabledMembershipKeys: new Set(),
    currentConfiguration: null,
  };
}

function issueCodes(operation: () => unknown) {
  try {
    operation();
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(CallCenterConfigurationError);
    return (error as CallCenterConfigurationError).issues.map(({ code }) => code);
  }
}

describe("call-center configuration validation", () => {
  it("hashes semantic configuration independently of object key insertion order", () => {
    const configuration = validInput();
    const reordered = JSON.parse(JSON.stringify(configuration), (key, value) => {
      if (!value || Array.isArray(value) || typeof value !== "object") return value;
      return Object.fromEntries(Object.entries(value).reverse());
    }) as CallCenterConfigurationInput;

    expect(callCenterConfigurationVersion(reordered)).toBe(
      callCenterConfigurationVersion(configuration),
    );
  });

  it("normalizes one complete, valid configuration snapshot", () => {
    const result = validateCallCenterConfiguration(validInput(), validContext());

    expect(result).toMatchObject({
      practiceId: "practice-1",
      defaultOutboundNumberId: "number-1",
      queues: [{ name: "Optical", voicemailGreeting: "Please leave a message." }],
      endpoints: [{ label: "Optical Front Desk" }],
    });
  });

  it("rejects cross-practice entities, locations, numbers, and members", () => {
    const context = validContext();
    context.queueOwnerPracticeIds = new Map([["queue-1", "practice-2"]]);
    context.ownedLocationIds = new Set();
    context.ownedPracticePhoneNumberIds = new Set();
    context.practiceMemberUserIds = new Set();

    expect(
      issueCodes(() => validateCallCenterConfiguration(validInput(), context)),
    ).toEqual(
      expect.arrayContaining([
        "CROSS_PRACTICE_ENTITY",
        "UNKNOWN_LOCATION",
        "UNKNOWN_PHONE_NUMBER",
        "MEMBERSHIP_REQUIRED",
      ]),
    );
  });

  it("rejects an enabled inbound number without an enabled queue", () => {
    const input = validInput();
    input.queues[0]!.enabled = false;

    expect(
      issueCodes(() => validateCallCenterConfiguration(input, validContext())),
    ).toContain("INVALID_INBOUND_ROUTE");
  });

  it("rejects an enabled inbound number outside its queue locations", () => {
    const context = validContext();
    context.practicePhoneNumberLocationIds = new Map([["phone-1", "location-2"]]);

    expect(
      issueCodes(() => validateCallCenterConfiguration(validInput(), context)),
    ).toContain("INBOUND_NUMBER_LOCATION_MISMATCH");
  });

  it("rejects unsafe endpoint and default outbound configuration", () => {
    const input = validInput();
    input.endpoints[0]!.providerCredentialId = null;
    input.numbers[0]!.outboundEnabled = false;

    expect(
      issueCodes(() => validateCallCenterConfiguration(input, validContext())),
    ).toEqual(
      expect.arrayContaining([
        "ENDPOINT_CREDENTIALS_REQUIRED",
        "INVALID_OUTBOUND_NUMBER",
      ]),
    );
  });

  it("requires every enabled canonical profile to identify its agent", () => {
    const input = validInput();
    input.endpoints[0]!.userId = null;

    expect(
      issueCodes(() => validateCallCenterConfiguration(input, validContext())),
    ).toEqual(
      expect.arrayContaining(["ENDPOINT_CREDENTIALS_REQUIRED", "INCOMPLETE_ROUTING"]),
    );
  });

  it("rejects assigning two call profiles to one user", () => {
    const input = validInput();
    input.endpoints.push({
      enabled: false,
      id: "endpoint-2",
      label: "Spare",
      locationId: "location-1",
      providerCredentialId: null,
      sipUsername: null,
      userId: "user-1",
    });

    expect(
      issueCodes(() => validateCallCenterConfiguration(input, validContext())),
    ).toContain("DUPLICATE_VALUE");
  });

  it("requires an endpoint to belong to one of its queue locations", () => {
    const input = validInput();
    input.endpoints[0]!.locationId = null;

    expect(
      issueCodes(() => validateCallCenterConfiguration(input, validContext())),
    ).toContain("INCOMPLETE_ROUTING");
  });

  it("rejects endpoint identities already assigned elsewhere", () => {
    const context = validContext();
    context.providerCredentialEndpointIds = new Map([["credential-1", "endpoint-other"]]);
    context.sipUsernameEndpointIds = new Map([["sip-optical-1", "endpoint-other"]]);

    expect(
      issueCodes(() => validateCallCenterConfiguration(validInput(), context)),
    ).toEqual([
      "ENDPOINT_IDENTITY_ALREADY_ASSIGNED",
      "ENDPOINT_IDENTITY_ALREADY_ASSIGNED",
    ]);
  });

  it("rejects provider numbers already assigned to another canonical number", () => {
    const context = validContext();
    context.providerNumberOwnerNumberIds = new Map([
      ["provider-number-1", "number-other"],
    ]);

    expect(
      issueCodes(() => validateCallCenterConfiguration(validInput(), context)),
    ).toContain("PROVIDER_NUMBER_ALREADY_ASSIGNED");
  });

  it("rejects an incomplete enabled routing configuration", () => {
    const input = validInput();
    input.queues[0]!.locationIds = [];
    input.queues[0]!.members = [];
    input.numbers = [];
    input.endpoints = [];
    input.defaultOutboundNumberId = null;

    expect(
      issueCodes(() => validateCallCenterConfiguration(input, validContext())),
    ).toEqual([
      "INCOMPLETE_ROUTING",
      "INCOMPLETE_ROUTING",
      "INCOMPLETE_ROUTING",
      "INCOMPLETE_ROUTING",
    ]);
  });

  it("requires enabled rows to be explicitly disabled before omission", () => {
    const context = validContext();
    context.enabledQueueIds = new Set(["existing-queue"]);
    context.enabledNumberIds = new Set(["existing-number"]);
    context.enabledEndpointIds = new Set(["existing-endpoint"]);

    expect(
      issueCodes(() => validateCallCenterConfiguration(validInput(), context)),
    ).toEqual([
      "OMITTED_ENABLED_ENTITY",
      "OMITTED_ENABLED_ENTITY",
      "OMITTED_ENABLED_ENTITY",
    ]);
  });

  it("does not remove the last enabled agent membership by omission", () => {
    const input = validInput();
    input.queues[0]!.members = [];
    const context = validContext();
    context.enabledMembershipKeys = new Set([
      callCenterMembershipKey("queue-1", "user-1"),
    ]);

    expect(issueCodes(() => validateCallCenterConfiguration(input, context))).toEqual(
      expect.arrayContaining(["OMITTED_ENABLED_MEMBERSHIP", "INCOMPLETE_ROUTING"]),
    );
  });

  it("rejects queue policy violations and overflow cycles", () => {
    const input = validInput();
    input.queues[0]!.ringTimeoutSec = 31;
    input.queues[0]!.maxWaitSec = 30;
    input.queues[0]!.overflowQueueId = "queue-1";

    expect(
      issueCodes(() => validateCallCenterConfiguration(input, validContext())),
    ).toEqual(expect.arrayContaining(["INVALID_QUEUE_POLICY", "OVERFLOW_QUEUE_CYCLE"]));
  });

  it("rejects duplicate owners and out-of-snapshot queue or default references", () => {
    const input = validInput();
    input.queues.push({
      ...input.queues[0]!,
      name: "Duplicate queue ID",
    });
    input.queues[0]!.overflowQueueId = "queue-foreign";
    input.defaultOutboundNumberId = "number-foreign";

    expect(
      issueCodes(() => validateCallCenterConfiguration(input, validContext())),
    ).toEqual(
      expect.arrayContaining([
        "DUPLICATE_VALUE",
        "UNKNOWN_QUEUE",
        "INVALID_OUTBOUND_NUMBER",
      ]),
    );
  });
});

describe("transactional configuration boundary", () => {
  it("loads, validates, and persists inside one repository transaction", async () => {
    const events: string[] = [];
    const repository: CallCenterConfigurationRepository = {
      async transaction(operation) {
        events.push("transaction:start");
        const result = await operation({
          async loadValidationContextForUpdate(practiceId, references) {
            events.push(`load:${practiceId}:${references.queueIds.join(",")}`);
            expect(references.providerCredentialIds).toEqual(["credential-1"]);
            expect(references.sipUsernames).toEqual(["sip-optical-1"]);
            return validContext();
          },
          async persistValidatedSnapshot(configuration, audit) {
            expect(audit).toEqual({
              actorUserId: "admin-1",
              previousVersion: "version-1",
            });
            events.push(`persist:${configuration.practiceId}`);
          },
        });
        events.push("transaction:commit");
        return result;
      },
    };

    const result = await saveCallCenterConfiguration(
      repository,
      validInput(),
      "version-1",
      "admin-1",
    );
    expect(result).toMatchObject({
      changed: true,
      configuration: { practiceId: "practice-1" },
      version: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(events).toEqual([
      "transaction:start",
      "load:practice-1:queue-1",
      "persist:practice-1",
      "transaction:commit",
    ]);
  });

  it("does not persist when transaction-time validation fails", async () => {
    let persisted = false;
    const repository: CallCenterConfigurationRepository = {
      transaction: (operation) =>
        operation({
          async loadValidationContextForUpdate() {
            return { ...validContext(), practiceMemberUserIds: new Set() };
          },
          async persistValidatedSnapshot() {
            persisted = true;
          },
        }),
    };

    await expect(
      saveCallCenterConfiguration(repository, validInput(), "version-1", "admin-1"),
    ).rejects.toBeInstanceOf(CallCenterConfigurationError);
    expect(persisted).toBe(false);
  });

  it("returns a locked no-op without writing a duplicate audit event", async () => {
    const current = validateCallCenterConfiguration(validInput(), validContext());
    const version = callCenterConfigurationVersion(current);
    let persisted = false;
    const repository: CallCenterConfigurationRepository = {
      transaction: (operation) =>
        operation({
          async loadValidationContextForUpdate() {
            return {
              ...validContext(),
              configurationVersion: version,
              currentConfiguration: current,
              enabledQueueIds: new Set(["queue-1"]),
              enabledNumberIds: new Set(["number-1"]),
              enabledEndpointIds: new Set(["endpoint-1"]),
              enabledMembershipKeys: new Set([
                callCenterMembershipKey("queue-1", "user-1"),
              ]),
            };
          },
          async persistValidatedSnapshot() {
            persisted = true;
          },
        }),
    };

    const result = await saveCallCenterConfiguration(
      repository,
      validInput(),
      version,
      "admin-1",
    );

    expect(result).toEqual({ changed: false, configuration: current, version });
    expect(persisted).toBe(false);
  });

  it("persists when returning to an older configuration version", async () => {
    const target = validateCallCenterConfiguration(validInput(), validContext());
    const current = {
      ...target,
      queues: target.queues.map((queue) => ({ ...queue, name: "Temporary queue" })),
    };
    const currentVersion = callCenterConfigurationVersion(current);
    let persisted = false;
    const repository: CallCenterConfigurationRepository = {
      transaction: (operation) =>
        operation({
          async loadValidationContextForUpdate() {
            return {
              ...validContext(),
              configurationVersion: currentVersion,
              currentConfiguration: current,
            };
          },
          async persistValidatedSnapshot() {
            persisted = true;
          },
        }),
    };

    const result = await saveCallCenterConfiguration(
      repository,
      validInput(),
      currentVersion,
      "admin-1",
    );

    expect(result.changed).toBe(true);
    expect(result.version).toBe(callCenterConfigurationVersion(target));
    expect(persisted).toBe(true);
  });

  it("preserves disabled rows omitted from the submitted snapshot", async () => {
    const current = validInput();
    current.queues.push({
      ...current.queues[0]!,
      id: "queue-disabled",
      name: "Retired queue",
      enabled: false,
      locationIds: [],
      members: [],
    });
    current.queues[0]!.members.push({
      userId: "user-2",
      role: "AGENT",
      enabled: false,
    });
    current.numbers.push({
      ...current.numbers[0]!,
      id: "number-disabled",
      practicePhoneNumberId: "phone-2",
      providerNumberId: null,
      inboundQueueId: null,
      inboundEnabled: false,
      outboundEnabled: false,
      enabled: false,
    });
    current.endpoints.push({
      ...current.endpoints[0]!,
      id: "endpoint-disabled",
      label: "Retired endpoint",
      providerCredentialId: null,
      sipUsername: null,
      userId: null,
      enabled: false,
    });
    let persisted: CallCenterConfigurationInput | null = null;
    const repository: CallCenterConfigurationRepository = {
      transaction: (operation) =>
        operation({
          async loadValidationContextForUpdate() {
            return {
              ...validContext(),
              currentConfiguration: current,
              ownedPracticePhoneNumberIds: new Set(["phone-1", "phone-2"]),
              practicePhoneNumberLocationIds: new Map([
                ["phone-1", "location-1"],
                ["phone-2", null],
              ]),
              practiceMemberUserIds: new Set(["user-1", "user-2"]),
              queueOwnerPracticeIds: new Map([
                ["queue-1", "practice-1"],
                ["queue-disabled", "practice-1"],
              ]),
              numberOwnerPracticeIds: new Map([
                ["number-1", "practice-1"],
                ["number-disabled", "practice-1"],
              ]),
              endpointOwnerPracticeIds: new Map([
                ["endpoint-1", "practice-1"],
                ["endpoint-disabled", "practice-1"],
              ]),
            };
          },
          async persistValidatedSnapshot(configuration) {
            persisted = configuration;
          },
        }),
    };

    await saveCallCenterConfiguration(repository, validInput(), "version-1", "admin-1");

    expect(persisted).toMatchObject({
      queues: expect.arrayContaining([
        expect.objectContaining({ id: "queue-disabled" }),
        expect.objectContaining({
          id: "queue-1",
          members: expect.arrayContaining([
            expect.objectContaining({ userId: "user-2", enabled: false }),
          ]),
        }),
      ]),
      numbers: expect.arrayContaining([
        expect.objectContaining({ id: "number-disabled" }),
      ]),
      endpoints: expect.arrayContaining([
        expect.objectContaining({ id: "endpoint-disabled" }),
      ]),
    });
  });

  it("rejects a stale full snapshot before persistence", async () => {
    let persisted = false;
    const repository: CallCenterConfigurationRepository = {
      transaction: (operation) =>
        operation({
          async loadValidationContextForUpdate() {
            return { ...validContext(), configurationVersion: "version-2" };
          },
          async persistValidatedSnapshot() {
            persisted = true;
          },
        }),
    };

    try {
      await saveCallCenterConfiguration(repository, validInput(), "version-1", "admin-1");
      throw new Error("Expected stale configuration rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(CallCenterConfigurationError);
      expect((error as CallCenterConfigurationError).issues).toEqual([
        expect.objectContaining({ code: "STALE_CONFIGURATION" }),
      ]);
    }
    expect(persisted).toBe(false);
  });
});
