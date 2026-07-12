import { describe, expect, it } from "bun:test";

import { validateCallCenterConfiguration } from "@/lib/call-center/application/configuration";
import {
  buildLegacyCallCenterBootstrap,
  buildLegacyCallCenterBackfillReport,
  legacyCallCenterBackfillSnapshotVersion,
  LegacyCallCenterBootstrapError,
  type LegacyCallCenterBackfillSnapshot,
} from "@/lib/call-center/application/legacy-backfill-plan";
import {
  type LegacyBackfillReadClient,
  readLegacyCallCenterBackfillReport,
  resolveLegacyProfileQueueKey,
} from "@/lib/call-center/infrastructure/legacy-backfill-report";

function completeSnapshot(): LegacyCallCenterBackfillSnapshot {
  return {
    practiceId: "practice-1",
    locationIds: ["location-1", "location-2"],
    existingGenericConfiguration: {
      endpointCount: 0,
      numberCount: 0,
      queueCount: 0,
    },
    settings: {
      enabled: true,
      inboundPhoneNumber: "+1 (305) 555-0100",
      outboundCallerNumber: "3055550100",
      recordingEnabled: true,
      telnyxConnectionId: "connection-secret",
      telnyxCredentialId: "practice-credential-secret",
      voicemailGreeting: "Sensitive greeting that must not leave the planner",
      voicemailTimeoutSec: 30,
    },
    phoneNumbers: [
      {
        id: "phone-1",
        locationId: "location-1",
        phoneNumber: "+13055550100",
      },
    ],
    seats: [
      {
        id: "seat-1",
        enabled: true,
        locationId: "location-1",
        observedUserIds: [],
        queueKey: "abita-sweetwater-optical",
        providerCredentialId: "provider-secret-1",
        sipUsername: "sip-secret-1",
      },
    ],
    profileAssignments: [
      {
        locationIds: ["location-1"],
        queueKey: "abita-sweetwater-optical",
        userId: "user-1",
      },
    ],
    runtimeFallbacks: {
      connection: false,
      credential: false,
      inboundNumber: false,
      outboundNumber: false,
    },
  };
}

describe("legacy call-center backfill report", () => {
  it("maps only a complete, unambiguous tenant snapshot and stays LEGACY", () => {
    const report = buildLegacyCallCenterBackfillReport(completeSnapshot());

    expect(report.mode).toBe("REPORT_ONLY");
    expect(report.writeSupported).toBe(false);
    expect(report.overallReadiness).toBe("READY_FOR_MANUAL_REVIEW");
    expect(report.queues).toHaveLength(1);
    expect(report.queues[0]).toMatchObject({
      routingMode: "LEGACY",
      nextModeAfterReview: "SHADOW",
      locationIds: ["location-1"],
      memberUserIds: ["user-1"],
      sourceSeatIds: ["seat-1"],
      shadowReadiness: "READY_FOR_REVIEW",
    });
    expect(report.numbers).toHaveLength(1);
    expect(report.numbers[0]).toMatchObject({
      practicePhoneNumberId: "phone-1",
      inboundEnabled: true,
      outboundEnabled: true,
    });
    expect(report.defaultOutboundNumberId).toBe(report.numbers[0]!.proposedId);
    expect(report.ambiguities).toEqual([]);
    expect(report.endpoints[0]?.proposedId).toBe("seat-1");
    expect(report.queues[0]?.endpointIds).toEqual(["seat-1"]);
  });

  it("never serializes phones, greetings, emails, queue keys, or endpoint identities", () => {
    const report = buildLegacyCallCenterBackfillReport(completeSnapshot());
    const serialized = JSON.stringify(report);

    for (const sensitive of [
      "3055550100",
      "Sensitive greeting",
      "sweetwateropticals@abitaeye.com",
      "abita-sweetwater-optical",
      "provider-secret-1",
      "sip-secret-1",
      "connection-secret",
      "practice-credential-secret",
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
  });

  it("reports ambiguous routes and duplicate endpoint identities without guessing", () => {
    const snapshot = completeSnapshot();
    snapshot.phoneNumbers.push({
      id: "phone-duplicate",
      locationId: "location-2",
      phoneNumber: "1-305-555-0100",
    });
    snapshot.seats.push(
      {
        id: "seat-2",
        enabled: true,
        locationId: "location-2",
        observedUserIds: [],
        queueKey: "other-queue",
        providerCredentialId: "provider-secret-1",
        sipUsername: "sip-secret-2",
      },
      {
        id: "seat-unscoped",
        enabled: true,
        locationId: null,
        observedUserIds: [],
        queueKey: null,
        providerCredentialId: null,
        sipUsername: null,
      },
    );

    const report = buildLegacyCallCenterBackfillReport(snapshot);
    const codes = report.ambiguities.map(({ code }) => code);

    expect(codes).toEqual(
      expect.arrayContaining([
        "ENDPOINT_IDENTITY_DUPLICATE",
        "ENDPOINT_IDENTITY_INCOMPLETE",
        "INBOUND_NUMBER_MATCH_AMBIGUOUS",
        "OUTBOUND_NUMBER_MATCH_AMBIGUOUS",
        "QUEUE_MEMBER_MISSING",
        "SEAT_SCOPE_MISSING",
      ]),
    );
    expect(report.numbers).toEqual([]);
    expect(report.defaultOutboundNumberId).toBeNull();
    expect(report.summary.shadowReadyQueueCount).toBe(0);
    expect(report.overallReadiness).toBe("BLOCKED");
  });

  it("does not infer membership or location for unkeyed and unlocated seats", () => {
    const snapshot = completeSnapshot();
    snapshot.settings = null;
    snapshot.seats = [
      {
        id: "seat-unscoped",
        enabled: true,
        locationId: null,
        observedUserIds: [],
        queueKey: null,
        providerCredentialId: "provider-secret-1",
        sipUsername: "sip-secret-1",
      },
    ];
    snapshot.profileAssignments = [
      {
        locationIds: ["location-2"],
        queueKey: "profile-without-seat",
        userId: "user-2",
      },
    ];

    const report = buildLegacyCallCenterBackfillReport(snapshot);

    expect(report.queues).toEqual([]);
    expect(report.endpoints[0]).toMatchObject({ queueId: null, locationId: null });
    expect(report.ambiguities.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "LEGACY_SETTINGS_MISSING",
        "PROFILE_QUEUE_WITHOUT_SEAT",
        "SEAT_SCOPE_MISSING",
      ]),
    );
  });

  it("blocks references to locations outside the practice", () => {
    const snapshot = completeSnapshot();
    snapshot.seats[0]!.locationId = "other-practice-location";

    const report = buildLegacyCallCenterBackfillReport(snapshot);

    expect(report.overallReadiness).toBe("BLOCKED");
    expect(report.endpoints[0]?.locationId).toBeNull();
    expect(report.ambiguities).toContainEqual({
      code: "LOCATION_REFERENCE_OUTSIDE_PRACTICE",
      count: 1,
      affectedRefs: ["seat:seat-1"],
    });
  });

  it("blocks shadow recommendations when generic configuration already exists", () => {
    const snapshot = completeSnapshot();
    snapshot.existingGenericConfiguration.queueCount = 1;

    const report = buildLegacyCallCenterBackfillReport(snapshot);

    expect(report.queues[0]).toMatchObject({
      nextModeAfterReview: null,
      shadowReadiness: "BLOCKED",
    });
    expect(report.ambiguities).toContainEqual({
      code: "GENERIC_CONFIGURATION_PRESENT",
      count: 1,
      affectedRefs: ["generic-configuration"],
    });
    expect(report.summary.existingGenericQueueCount).toBe(1);
  });

  it("preserves the effective legacy wait and ring limits", () => {
    const snapshot = completeSnapshot();
    snapshot.settings!.voicemailTimeoutSec = 5;

    expect(buildLegacyCallCenterBackfillReport(snapshot).queues[0]).toMatchObject({
      maxWaitSec: 5,
      ringTimeoutSec: 5,
    });

    snapshot.settings!.voicemailTimeoutSec = 999;
    expect(buildLegacyCallCenterBackfillReport(snapshot).queues[0]).toMatchObject({
      maxWaitSec: 120,
      ringTimeoutSec: 20,
    });
  });

  it("recognizes only the exact compatibility profiles used by legacy routing", () => {
    expect(
      resolveLegacyProfileQueueKey(
        " Abita Eye Group ",
        "SWEETWATEROPTICALS@ABITAEYE.COM",
      ),
    ).toBe("abita-sweetwater-optical");
    expect(
      resolveLegacyProfileQueueKey("Abita Eye Group", "callcenter@abitaeye.com"),
    ).toBe("abita-south-florida");
    expect(
      resolveLegacyProfileQueueKey("Another Practice", "callcenter@abitaeye.com"),
    ).toBeNull();
    expect(
      resolveLegacyProfileQueueKey("Abita Eye Group", "staff@example.com"),
    ).toBeNull();
  });

  it("reads one tenant boundary and drops raw compatibility facts from output", async () => {
    const reads: unknown[] = [];
    const client = {
      practice: {
        async findUnique(args: unknown) {
          reads.push(args);
          return {
            id: "practice-1",
            name: "Abita Eye Group",
            _count: {
              callCenterEndpoints: 0,
              callCenterNumbers: 0,
              callCenterQueues: 0,
            },
            callCenterSettings: completeSnapshot().settings,
            phoneNumbers: completeSnapshot().phoneNumbers,
            locations: [
              { id: "location-1", name: "Sweetwater" },
              { id: "location-2", name: "North Miami Beach Optical" },
            ],
            callCenterAgentSeats: [
              {
                id: "seat-1",
                enabled: true,
                locationId: "location-1",
                presence: [{ userId: "user-1" }, { userId: "former-user" }],
                queueKey: "abita-sweetwater-optical",
                telnyxCredentialId: "provider-secret-1",
                sipUsername: "sip-secret-1",
              },
            ],
            memberships: [
              {
                locationScope: "SELECTED",
                locations: [{ locationId: "location-1" }],
                userId: "user-1",
                user: { email: "sweetwateropticals@abitaeye.com" },
              },
            ],
          };
        },
      },
    } as unknown as LegacyBackfillReadClient;

    const report = await readLegacyCallCenterBackfillReport("practice-1", client);

    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ where: { id: "practice-1" } });
    expect(report?.queues[0]?.memberUserIds).toEqual(["user-1"]);
    expect(report?.queues[0]?.locationIds).toEqual(["location-1"]);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("sweetwateropticals@abitaeye.com");
    expect(serialized).not.toContain("provider-secret-1");
    expect(serialized).not.toContain("sip-secret-1");
    expect(serialized).not.toContain("former-user");
  });

  it("proposes current members observed on legacy seats without guessing", () => {
    const snapshot = completeSnapshot();
    snapshot.profileAssignments = [];
    snapshot.seats[0]!.observedUserIds = ["user-observed"];

    const report = buildLegacyCallCenterBackfillReport(snapshot);

    expect(report.queues[0]?.memberUserIds).toEqual(["user-observed"]);
    expect(report.ambiguities.map(({ code }) => code)).not.toContain(
      "QUEUE_MEMBER_MISSING",
    );
    expect(report.overallReadiness).toBe("READY_FOR_MANUAL_REVIEW");
  });

  it("builds one reviewed LEGACY snapshot while keeping secrets out of the report", () => {
    const snapshot = completeSnapshot();
    const bootstrap = buildLegacyCallCenterBootstrap(snapshot);

    expect(bootstrap.configuration.queues).toHaveLength(1);
    expect(bootstrap.configuration.queues[0]).toMatchObject({
      routingMode: "LEGACY",
      members: [{ enabled: true, role: "AGENT", userId: "user-1" }],
    });
    expect(bootstrap.configuration.endpoints[0]).toMatchObject({
      id: "seat-1",
      providerCredentialId: "provider-secret-1",
      sipUsername: "sip-secret-1",
    });
    expect(JSON.stringify(bootstrap.report)).not.toContain("provider-secret-1");
    expect(bootstrap.reportVersion).toBe(
      legacyCallCenterBackfillSnapshotVersion(snapshot),
    );
    snapshot.runtimeFallbacks.connection = true;
    expect(legacyCallCenterBackfillSnapshotVersion(snapshot)).toBe(
      bootstrap.reportVersion,
    );
    expect(
      validateCallCenterConfiguration(bootstrap.configuration, {
        practiceExists: true,
        configurationVersion: "",
        ownedLocationIds: new Set(snapshot.locationIds),
        ownedPracticePhoneNumberIds: new Set(snapshot.phoneNumbers.map(({ id }) => id)),
        practicePhoneNumberLocationIds: new Map(
          snapshot.phoneNumbers.map(({ id, locationId }) => [id, locationId]),
        ),
        practiceMemberUserIds: new Set(["user-1"]),
        queueOwnerPracticeIds: new Map(),
        numberOwnerPracticeIds: new Map(),
        endpointOwnerPracticeIds: new Map(),
        providerCredentialEndpointIds: new Map(),
        providerNumberOwnerNumberIds: new Map(),
        sipUsernameEndpointIds: new Map(),
        enabledQueueIds: new Set(),
        enabledNumberIds: new Set(),
        enabledEndpointIds: new Set(),
        enabledMembershipKeys: new Set(),
        currentConfiguration: null,
      }),
    ).toEqual(bootstrap.configuration);
  });

  it("binds the reviewed version to hidden configuration values", () => {
    const original = completeSnapshot();
    const changed = completeSnapshot();
    changed.settings!.voicemailGreeting = "Different reviewed greeting";
    changed.seats[0]!.providerCredentialId = "different-credential";
    changed.seats[0]!.sipUsername = "different-sip-user";

    expect(legacyCallCenterBackfillSnapshotVersion(changed)).not.toBe(
      legacyCallCenterBackfillSnapshotVersion(original),
    );
    expect(buildLegacyCallCenterBootstrap(changed).configuration).not.toEqual(
      buildLegacyCallCenterBootstrap(original).configuration,
    );
  });

  it("refuses bootstrap when the reviewed report is blocked", () => {
    const snapshot = completeSnapshot();
    snapshot.profileAssignments = [];

    expect(() => buildLegacyCallCenterBootstrap(snapshot)).toThrow(
      new LegacyCallCenterBootstrapError("BOOTSTRAP_REPORT_BLOCKED"),
    );
  });
});
