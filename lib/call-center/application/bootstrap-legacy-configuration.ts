import { callCenterConfigurationVersion } from "@/lib/call-center/application/configuration";
import {
  buildLegacyCallCenterBootstrap,
  type LegacyCallCenterBackfillSnapshot,
} from "@/lib/call-center/application/legacy-backfill-plan";
import type {
  SavedCallCenterConfiguration,
  ValidatedCallCenterConfiguration,
} from "@/lib/call-center/application/configuration";

export type LegacyConfigurationBootstrapInput = {
  audit: {
    actor: string;
    triggeringActor: string;
    runId: string;
    runAttempt: number;
  };
  expectedReportVersion: string;
  practiceId: string;
};

export class LegacyConfigurationBootstrapOperationError extends Error {
  constructor(
    readonly code:
      | "BOOTSTRAP_CONFIGURATION_ALREADY_EXISTS"
      | "BOOTSTRAP_PRACTICE_NOT_FOUND"
      | "BOOTSTRAP_REPORT_CHANGED",
  ) {
    super(code);
    this.name = "LegacyConfigurationBootstrapOperationError";
  }
}

export type LegacyConfigurationBootstrapTransaction = {
  readConfiguration(
    practiceId: string,
  ): Promise<{ configuration: ValidatedCallCenterConfiguration; version: string } | null>;
  readLockedSnapshot(
    practiceId: string,
  ): Promise<LegacyCallCenterBackfillSnapshot | null>;
  saveConfiguration(
    configuration: ValidatedCallCenterConfiguration,
    expectedVersion: string,
    audit: LegacyConfigurationBootstrapInput["audit"],
  ): Promise<SavedCallCenterConfiguration>;
};

export type LegacyConfigurationBootstrapRepository = {
  transaction<T>(
    operation: (transaction: LegacyConfigurationBootstrapTransaction) => Promise<T>,
  ): Promise<T>;
};

function withoutGenericConfiguration(
  snapshot: LegacyCallCenterBackfillSnapshot,
): LegacyCallCenterBackfillSnapshot {
  return {
    ...snapshot,
    existingGenericConfiguration: {
      endpointCount: 0,
      numberCount: 0,
      queueCount: 0,
    },
  };
}

export async function bootstrapLegacyCallCenterConfiguration(
  repository: LegacyConfigurationBootstrapRepository,
  input: LegacyConfigurationBootstrapInput,
) {
  return repository.transaction(async (transaction) => {
    const snapshot = await transaction.readLockedSnapshot(input.practiceId);
    const current = await transaction.readConfiguration(input.practiceId);
    if (!snapshot || !current) {
      throw new LegacyConfigurationBootstrapOperationError(
        "BOOTSTRAP_PRACTICE_NOT_FOUND",
      );
    }

    const bootstrap = buildLegacyCallCenterBootstrap(
      withoutGenericConfiguration(snapshot),
    );
    if (bootstrap.reportVersion !== input.expectedReportVersion) {
      throw new LegacyConfigurationBootstrapOperationError("BOOTSTRAP_REPORT_CHANGED");
    }

    const candidateVersion = callCenterConfigurationVersion(bootstrap.configuration);
    const hasGenericConfiguration = Boolean(
      snapshot.existingGenericConfiguration.queueCount ||
      snapshot.existingGenericConfiguration.numberCount ||
      snapshot.existingGenericConfiguration.endpointCount,
    );
    if (hasGenericConfiguration) {
      if (current.version === candidateVersion) {
        return {
          changed: false,
          configuration: current.configuration,
          reportVersion: bootstrap.reportVersion,
          version: current.version,
        };
      }
      throw new LegacyConfigurationBootstrapOperationError(
        "BOOTSTRAP_CONFIGURATION_ALREADY_EXISTS",
      );
    }

    const saved = await transaction.saveConfiguration(
      bootstrap.configuration,
      current.version,
      input.audit,
    );
    return { ...saved, reportVersion: bootstrap.reportVersion };
  });
}
