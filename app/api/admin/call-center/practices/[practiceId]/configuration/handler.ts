import { isAdminEmail } from "@/lib/admin-auth";
import { getAuthSession } from "@/lib/auth";
import {
  CallCenterConfigurationError,
  saveCallCenterConfiguration,
  type CallCenterConfigurationInput,
} from "@/lib/call-center/application/configuration";
import {
  callCenterConfigurationWireSchema,
  formatConfigurationEtag,
  parseConfigurationEtag,
  redactCallCenterConfiguration,
  resolveCallCenterConfigurationWireInput,
  safeZodIssues,
} from "@/lib/call-center/application/configuration-wire";
import {
  PrismaCallCenterConfigurationRepository,
  readCallCenterConfiguration,
  type VersionedCallCenterConfiguration,
} from "@/lib/call-center/infrastructure/prisma-configuration-repository";
import { readLegacyCallCenterBackfillReport } from "@/lib/call-center/infrastructure/legacy-backfill-report";
import { createLogger } from "@/lib/logger";

const logger = createLogger("admin-call-center-configuration");
const READ_ERROR = "call_center_configuration_read_failed";
const WRITE_ERROR = "call_center_configuration_write_failed";

type RouteContext = { params: Promise<{ practiceId: string }> };
type AdminSession = { user: { id: string; email?: string | null } };

type ConfigurationHandlerDependencies = {
  getSession?: () => Promise<AdminSession | null>;
  isAdmin?: (email?: string | null) => boolean;
  readConfiguration?: (
    practiceId: string,
  ) => Promise<VersionedCallCenterConfiguration | null>;
  readMigrationReport?: (
    practiceId: string,
  ) => Promise<{ overallReadiness: "BLOCKED" | "READY_FOR_MANUAL_REVIEW" } | null>;
  saveConfiguration?: (
    input: CallCenterConfigurationInput,
    expectedVersion: string,
    actorUserId: string,
  ) => Promise<unknown>;
};

function databaseErrorCode(error: unknown) {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}

function requestIssue(code: string, message: string) {
  return [{ code, path: "", message }];
}

export function createConfigurationHandlers({
  getSession = () => getAuthSession() as Promise<AdminSession | null>,
  isAdmin = isAdminEmail,
  readConfiguration = readCallCenterConfiguration,
  readMigrationReport = readLegacyCallCenterBackfillReport,
  saveConfiguration = (input, expectedVersion, actorUserId) =>
    saveCallCenterConfiguration(
      new PrismaCallCenterConfigurationRepository(),
      input,
      expectedVersion,
      actorUserId,
    ),
}: ConfigurationHandlerDependencies = {}) {
  async function getAdminSession() {
    const session = await getSession();
    return session && isAdmin(session.user.email) ? session : null;
  }

  async function GET(_request: Request, { params }: RouteContext) {
    if (!(await getAdminSession())) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const practiceId = (await params).practiceId.trim();
    try {
      const result = practiceId ? await readConfiguration(practiceId) : null;
      if (!result) {
        return Response.json({ error: "Practice not found" }, { status: 404 });
      }
      return Response.json(
        { configuration: redactCallCenterConfiguration(result.configuration) },
        {
          headers: {
            "Cache-Control": "no-store",
            ETag: formatConfigurationEtag(result.version),
          },
        },
      );
    } catch {
      logger.error("configuration read failed", { errorCode: READ_ERROR });
      return Response.json({ error: READ_ERROR }, { status: 500 });
    }
  }

  async function PUT(request: Request, { params }: RouteContext) {
    const session = await getAdminSession();
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const practiceId = (await params).practiceId.trim();
    if (!practiceId) {
      return Response.json({ error: "Practice not found" }, { status: 404 });
    }

    const ifMatch = request.headers.get("if-match");
    if (!ifMatch) {
      return Response.json(
        {
          error: "Configuration version required",
          issues: requestIssue(
            "PRECONDITION_REQUIRED",
            "Reload the configuration before saving",
          ),
        },
        { status: 428 },
      );
    }
    const expectedVersion = parseConfigurationEtag(ifMatch);
    if (!expectedVersion) {
      return Response.json(
        {
          error: "Invalid configuration version",
          issues: requestIssue(
            "INVALID_PRECONDITION",
            "If-Match must contain the current strong ETag",
          ),
        },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        {
          error: "Invalid configuration",
          issues: requestIssue("INVALID_REQUEST", "Request body must be valid JSON"),
        },
        { status: 400 },
      );
    }
    const parsed = callCenterConfigurationWireSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid configuration", issues: safeZodIssues(parsed.error) },
        { status: 400 },
      );
    }

    try {
      const current = await readConfiguration(practiceId);
      if (!current) {
        return Response.json({ error: "Practice not found" }, { status: 404 });
      }
      const isFirstBootstrap =
        current.configuration.queues.length === 0 &&
        current.configuration.numbers.length === 0 &&
        current.configuration.endpoints.length === 0;
      if (isFirstBootstrap) {
        const report = await readMigrationReport(practiceId);
        if (report?.overallReadiness !== "READY_FOR_MANUAL_REVIEW") {
          return Response.json(
            {
              error: "Migration report is blocked",
              issues: requestIssue(
                "MIGRATION_REPORT_BLOCKED",
                "Resolve every discovery ambiguity before the first configuration write",
              ),
            },
            { status: 422 },
          );
        }
      }
      await saveConfiguration(
        resolveCallCenterConfigurationWireInput(
          practiceId,
          parsed.data,
          current.configuration,
        ),
        expectedVersion,
        session.user.id,
      );
      const updated = await readConfiguration(practiceId);
      if (!updated) throw new Error("Configuration practice disappeared");
      return Response.json(
        { configuration: redactCallCenterConfiguration(updated.configuration) },
        {
          headers: {
            "Cache-Control": "no-store",
            ETag: formatConfigurationEtag(updated.version),
          },
        },
      );
    } catch (error) {
      if (error instanceof CallCenterConfigurationError) {
        const stale = error.issues.some(({ code }) => code === "STALE_CONFIGURATION");
        return Response.json(
          { error: "Invalid configuration", issues: error.issues },
          { status: stale ? 412 : 422 },
        );
      }
      const code = databaseErrorCode(error);
      if (code === "P2002" || code === "P2003") {
        return Response.json(
          {
            error: "Configuration conflict",
            issues: requestIssue(
              "CONFIGURATION_CONFLICT",
              "Configuration changed or conflicts with an existing owner",
            ),
          },
          { status: 409 },
        );
      }
      logger.error("configuration write failed", { errorCode: WRITE_ERROR });
      return Response.json({ error: WRITE_ERROR }, { status: 500 });
    }
  }

  return { GET, PUT };
}
