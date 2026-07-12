import { AlertTriangle, CheckCircle2 } from "lucide-react";

import {
  buildLegacyCallCenterBackfillReport,
  legacyCallCenterBackfillSnapshotVersion,
  type LegacyCallCenterBackfillReport,
} from "@/lib/call-center/application/legacy-backfill-plan";
import { readLegacyCallCenterBackfillSnapshot } from "@/lib/call-center/infrastructure/legacy-backfill-report";
import { createLogger } from "@/lib/logger";

const logger = createLogger("admin-call-center-migration-view");

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

export async function CallCenterMigrationReport({ practiceId }: { practiceId: string }) {
  let snapshot;
  try {
    snapshot = await readLegacyCallCenterBackfillSnapshot(practiceId);
  } catch {
    logger.error("migration view failed", {
      errorCode: "call_center_migration_view_failed",
    });
    return (
      <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
        <h2 className="font-semibold text-foreground">Call-center migration</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The redacted discovery report is temporarily unavailable. No migration action is
          available.
        </p>
      </section>
    );
  }

  return snapshot ? (
    <CallCenterMigrationReportView
      report={buildLegacyCallCenterBackfillReport(snapshot)}
      reportVersion={legacyCallCenterBackfillSnapshotVersion(snapshot)}
    />
  ) : null;
}

export function CallCenterMigrationReportView({
  report,
  reportVersion,
}: {
  report: LegacyCallCenterBackfillReport;
  reportVersion: string;
}) {
  const ready = report.overallReadiness === "READY_FOR_MANUAL_REVIEW";

  return (
    <section className="space-y-5" aria-labelledby="call-center-migration-title">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          {ready ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
          )}
          <div>
            <h2
              id="call-center-migration-title"
              className="font-semibold text-foreground"
            >
              Call-center migration
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {ready
                ? "Discovery is ready for manual review. This page is read-only and does not apply configuration."
                : "Migration apply is blocked. Resolve every ambiguity before copying configuration into the protected API."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Report version: <code className="break-all">{reportVersion}</code>
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Proposed queues" value={report.summary.queueCount} />
        <Metric label="Proposed numbers" value={report.summary.numberCount} />
        <Metric label="Proposed endpoints" value={report.summary.endpointCount} />
        <Metric label="Ambiguities" value={report.summary.ambiguityOccurrenceCount} />
      </div>

      {report.ambiguities.length ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold text-foreground">Blocking ambiguities</h3>
          <div className="mt-3 divide-y divide-border">
            {report.ambiguities.map((ambiguity) => (
              <div key={ambiguity.code} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <code className="text-xs font-medium text-foreground">
                    {ambiguity.code}
                  </code>
                  <span className="text-xs text-muted-foreground">
                    {ambiguity.count} affected
                  </span>
                </div>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {ambiguity.affectedRefs.slice(0, 5).join(", ")}
                  {ambiguity.affectedRefs.length > 5
                    ? ` and ${ambiguity.affectedRefs.length - 5} more`
                    : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-semibold text-foreground">Proposed queues</h3>
        {report.queues.length ? (
          <div className="mt-3 divide-y divide-border">
            {report.queues.map((queue) => (
              <div key={queue.proposedId} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {queue.proposedName}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {queue.shadowReadiness.replaceAll("_", " ").toLowerCase()}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {queue.locationIds.length} locations · {queue.memberUserIds.length}{" "}
                  members · {queue.endpointIds.length} endpoints · routing stays LEGACY
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No unambiguous queue proposal is available.
          </p>
        )}
      </div>
    </section>
  );
}
