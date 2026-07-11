import { isAdminEmail } from "@/lib/admin-auth";
import { getAuthSession } from "@/lib/auth";
import { readLegacyCallCenterBackfillReport } from "@/lib/call-center/infrastructure/legacy-backfill-report";
import { createLogger } from "@/lib/logger";

const logger = createLogger("admin-call-center-migration-report");
const REPORT_ERROR = "call_center_migration_report_failed";

type RouteContext = { params: Promise<{ practiceId: string }> };

type MigrationReportHandlerDependencies = {
  clock?: () => Date;
  getSession?: () => Promise<{ user?: { email?: string | null } } | null>;
  isAdmin?: (email?: string | null) => boolean;
  readReport?: (practiceId: string) => Promise<unknown | null>;
};

export function createMigrationReportHandler({
  clock = () => new Date(),
  getSession = () => getAuthSession(),
  isAdmin = isAdminEmail,
  readReport = readLegacyCallCenterBackfillReport,
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
      const report = await readReport(practiceId);
      if (!report) {
        return Response.json({ error: "Practice not found" }, { status: 404 });
      }

      return Response.json(
        { generatedAt: clock().toISOString(), report },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      logger.error("migration report failed", { errorCode: REPORT_ERROR });
      return Response.json({ error: REPORT_ERROR }, { status: 500 });
    }
  };
}
