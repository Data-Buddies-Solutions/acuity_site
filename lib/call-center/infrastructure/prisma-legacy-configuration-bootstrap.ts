import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { saveCallCenterConfigurationInTransaction } from "@/lib/call-center/application/configuration";
import type {
  LegacyConfigurationBootstrapRepository,
  LegacyConfigurationBootstrapTransaction,
} from "@/lib/call-center/application/bootstrap-legacy-configuration";
import { readLegacyCallCenterBackfillSnapshot } from "@/lib/call-center/infrastructure/legacy-backfill-report";
import {
  createPrismaConfigurationTransaction,
  readCallCenterConfiguration,
} from "@/lib/call-center/infrastructure/prisma-configuration-repository";
import { prisma } from "@/lib/prisma";

type Database = Pick<PrismaClient, "$transaction">;

export class PrismaLegacyConfigurationBootstrapRepository implements LegacyConfigurationBootstrapRepository {
  constructor(private readonly database: Database = prisma) {}

  transaction<T>(
    operation: (transaction: LegacyConfigurationBootstrapTransaction) => Promise<T>,
  ) {
    return this.database.$transaction(
      async (transaction) => {
        let lockedPracticeId: string | null = null;
        const lockPractice = async (practiceId: string) => {
          if (lockedPracticeId === practiceId) return;
          if (lockedPracticeId) throw new Error("BOOTSTRAP_PRACTICE_CHANGED");
          await transaction.$queryRaw(
            Prisma.sql`SELECT "id" FROM "practice" WHERE "id" = ${practiceId} FOR UPDATE`,
          );
          lockedPracticeId = practiceId;
        };
        return operation({
          readConfiguration: (practiceId) =>
            readCallCenterConfiguration(practiceId, transaction),
          readLockedSnapshot: async (practiceId) => {
            await lockPractice(practiceId);
            return readLegacyCallCenterBackfillSnapshot(practiceId, transaction);
          },
          saveConfiguration: (configuration, expectedVersion, audit) =>
            saveCallCenterConfigurationInTransaction(
              createPrismaConfigurationTransaction(transaction),
              configuration,
              expectedVersion,
              null,
              { automation: audit, source: "LEGACY_BOOTSTRAP" },
            ),
        });
      },
      {
        isolationLevel: "Serializable",
        maxWait: 5_000,
        timeout: 30_000,
      },
    );
  }
}
