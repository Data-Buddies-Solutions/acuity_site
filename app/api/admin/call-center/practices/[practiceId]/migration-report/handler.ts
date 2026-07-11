import { isAdminEmail } from "@/lib/admin-auth";
import { getAuthSession } from "@/lib/auth";
import {
  buildLegacyCallCenterBackfillReport,
  legacyCallCenterBackfillSnapshotVersion,
  type LegacyCallCenterBackfillSnapshot,
} from "@/lib/call-center/application/legacy-backfill-plan";
import { readLegacyCallCenterBackfillSnapshot } from "@/lib/call-center/infrastructure/legacy-backfill-report";
import { createLogger } from "@/lib/logger";

const logger = createLogger("admin-call-center-migration-report");
const REPORT_ERROR = "call_center_migration_report_failed";

type RouteContext = { params: Promise<{ practiceId: string }> };

type MigrationReportHandlerDependencies = {
  clock?: () => Date;
  getSession?: () => Promise<{ user?: { email?: string | null } } | null>;
  isAdmin?: (email?: string | null) => boolean;
  readSnapshot?: (practiceId: string) => Promise<LegacyCallCenterBackfillSnapshot | null>;
};

export function createMigrationReportHandler({
  clock = () => new Date(),
  getSession = () => getAuthSession(),
  isAdmin = isAdminEmail,
  readSnapshot = readLegacyCallCenterBackfillSnapshot,
}: MigrationReportHandlerDependencies = {}) {
  return async function GET(_request: Request, { params }: RouteContext) {
    const session = await getSession();

    if (!isAdmin(session?.user?.email)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const practiceId = (await params).practiceId.trim();
    if (!practiceId) {
      return Response.json({ error: "Practice not found" }, { status: 404 });
    }

    try {
      const snapshot = await readSnapshot(practiceId);
      if (!snapshot) {
        return Response.json({ error: "Practice not found" }, { status: 404 });
      }

      const report = buildLegacyCallCenterBackfillReport(snapshot);
      const reportVersion = legacyCallCenterBackfillSnapshotVersion(snapshot);
      return Response.json(
        { generatedAt: clock().toISOString(), report, reportVersion },
        {
          headers: {
            "Cache-Control": "no-store",
            "X-Call-Center-Report-Version": reportVersion,
          },
        },
      );
    } catch {
      logger.error("migration report failed", { errorCode: REPORT_ERROR });
      return Response.json({ error: REPORT_ERROR }, { status: 500 });
    }
  };
}
