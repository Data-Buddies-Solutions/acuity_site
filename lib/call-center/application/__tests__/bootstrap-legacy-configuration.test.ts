import { describe, expect, it } from "bun:test";

import {
  bootstrapLegacyCallCenterConfiguration,
  LegacyConfigurationBootstrapOperationError,
  type LegacyConfigurationBootstrapTransaction,
} from "@/lib/call-center/application/bootstrap-legacy-configuration";
import {
  callCenterConfigurationVersion,
  type ValidatedCallCenterConfiguration,
} from "@/lib/call-center/application/configuration";
import {
  buildLegacyCallCenterBootstrap,
  type LegacyCallCenterBackfillSnapshot,
} from "@/lib/call-center/application/legacy-backfill-plan";

const audit = {
  actor: "workflow-user",
  triggeringActor: "rerun-user",
  runId: "123456789",
  runAttempt: 2,
};

function sourceSnapshot(): LegacyCallCenterBackfillSnapshot {
  return {
    practiceId: "practice-1",
    locationIds: ["location-1"],
    existingGenericConfiguration: {
      endpointCount: 0,
      numberCount: 0,
      queueCount: 0,
    },
    settings: {
      enabled: true,
      inboundPhoneNumber: "+13055550100",
      outboundCallerNumber: "+13055550100",
      recordingEnabled: true,
      telnyxConnectionId: "connection-secret",
      telnyxCredentialId: "credential-secret",
      voicemailGreeting: "Reviewed greeting",
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
        queueKey: "queue-1",
        providerCredentialId: "seat-credential-secret",
        sipUsername: "seat-sip-secret",
      },
    ],
    profileAssignments: [
      { locationIds: ["location-1"], queueKey: "queue-1", userId: "user-1" },
    ],
    runtimeFallbacks: {
      connection: false,
      credential: false,
      inboundNumber: false,
      outboundNumber: false,
    },
  };
}

function repositoryFor({
  current,
  snapshot,
  saves,
}: {
  current: { configuration: ValidatedCallCenterConfiguration; version: string };
  snapshot: LegacyCallCenterBackfillSnapshot;
  saves: Array<{
    audit: typeof audit;
    expectedVersion: string;
  }>;
}) {
  const transaction: LegacyConfigurationBootstrapTransaction = {
    readConfiguration: async () => current,
    readLockedSnapshot: async () => snapshot,
    saveConfiguration: async (configuration, expectedVersion, savedAudit) => {
      saves.push({ audit: savedAudit, expectedVersion });
      return {
        changed: true,
        configuration,
        version: callCenterConfigurationVersion(configuration),
      };
    },
  };
  return {
    transaction: <T>(
      operation: (tx: LegacyConfigurationBootstrapTransaction) => Promise<T>,
    ) => operation(transaction),
  };
}

function emptyConfiguration(): ValidatedCallCenterConfiguration {
  return {
    practiceId: "practice-1",
    defaultOutboundNumberId: null,
    endpoints: [],
    numbers: [],
    queues: [],
  };
}

describe("legacy configuration bootstrap transaction", () => {
  it("checks the locked source version and saves once", async () => {
    const snapshot = sourceSnapshot();
    const candidate = buildLegacyCallCenterBootstrap(snapshot);
    const empty = emptyConfiguration();
    const saves: Array<{ audit: typeof audit; expectedVersion: string }> = [];

    const result = await bootstrapLegacyCallCenterConfiguration(
      repositoryFor({
        current: {
          configuration: empty,
          version: callCenterConfigurationVersion(empty),
        },
        saves,
        snapshot,
      }),
      {
        audit,
        expectedReportVersion: candidate.reportVersion,
        practiceId: snapshot.practiceId,
      },
    );

    expect(result.changed).toBe(true);
    expect(
      result.configuration.queues.every(({ routingMode }) => routingMode === "LEGACY"),
    ).toBe(true);
    expect(saves).toEqual([
      {
        audit,
        expectedVersion: callCenterConfigurationVersion(empty),
      },
    ]);
  });

  it("rejects hidden source drift before saving", async () => {
    const reviewed = sourceSnapshot();
    const changed = sourceSnapshot();
    changed.seats[0]!.sipUsername = "changed-secret-sip";
    const empty = emptyConfiguration();
    const saves: Array<{ audit: typeof audit; expectedVersion: string }> = [];

    await expect(
      bootstrapLegacyCallCenterConfiguration(
        repositoryFor({
          current: {
            configuration: empty,
            version: callCenterConfigurationVersion(empty),
          },
          saves,
          snapshot: changed,
        }),
        {
          audit,
          expectedReportVersion: buildLegacyCallCenterBootstrap(reviewed).reportVersion,
          practiceId: reviewed.practiceId,
        },
      ),
    ).rejects.toEqual(
      new LegacyConfigurationBootstrapOperationError("BOOTSTRAP_REPORT_CHANGED"),
    );
    expect(saves).toEqual([]);
  });

  it("returns the original receipt when an exact bootstrap already committed", async () => {
    const snapshot = sourceSnapshot();
    const candidate = buildLegacyCallCenterBootstrap(snapshot);
    snapshot.existingGenericConfiguration = {
      endpointCount: candidate.configuration.endpoints.length,
      numberCount: candidate.configuration.numbers.length,
      queueCount: candidate.configuration.queues.length,
    };
    const current = {
      configuration: candidate.configuration,
      version: callCenterConfigurationVersion(candidate.configuration),
    };
    const saves: Array<{ audit: typeof audit; expectedVersion: string }> = [];

    const result = await bootstrapLegacyCallCenterConfiguration(
      repositoryFor({ current, saves, snapshot }),
      {
        audit,
        expectedReportVersion: candidate.reportVersion,
        practiceId: snapshot.practiceId,
      },
    );

    expect(result).toMatchObject({
      changed: false,
      reportVersion: candidate.reportVersion,
      version: current.version,
    });
    expect(saves).toEqual([]);
  });
});
