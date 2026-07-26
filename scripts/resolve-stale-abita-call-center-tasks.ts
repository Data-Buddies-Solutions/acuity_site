import { config } from "dotenv";
import { Pool, type PoolClient, type QueryResult } from "pg";

export const STALE_ACTION_ITEM_PRACTICE = "Abita Eye Group";
export const STALE_ACTION_ITEM_AGE_DAYS = 7;
export const STALE_ACTION_ITEM_KINDS = ["MISSED_CALL", "VOICEMAIL"] as const;

type Queryable = {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
};

type CleanupPool = Queryable & {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
};

export type StaleActionItemCleanupReport = {
  applied: boolean;
  auditEventsWritten: number;
  callbackAndFollowUpPreserved: number;
  candidateCount: number;
  cutoff: string;
  newestCandidateAt: string | null;
  oldestCandidateAt: string | null;
  practiceId: string;
  practiceName: string;
  resolvedCount: number;
};

const practiceSql = `
  SELECT id, name
  FROM practice
  WHERE name = $1
  ORDER BY id
`;

const previewSql = `
  SELECT
    COUNT(*) FILTER (
      WHERE t.kind IN ('MISSED_CALL', 'VOICEMAIL')
    )::int AS "candidateCount",
    MIN(t."createdAt") FILTER (
      WHERE t.kind IN ('MISSED_CALL', 'VOICEMAIL')
    ) AS "oldestCandidateAt",
    MAX(t."createdAt") FILTER (
      WHERE t.kind IN ('MISSED_CALL', 'VOICEMAIL')
    ) AS "newestCandidateAt",
    COUNT(*) FILTER (
      WHERE t.kind IN ('CALLBACK', 'FOLLOW_UP')
    )::int AS "callbackAndFollowUpPreserved"
  FROM "call_center_task" t
  WHERE t."practiceId" = $1
    AND t.status = 'OPEN'
    AND t."createdAt" < $2
`;

const applySql = `
  WITH candidates AS MATERIALIZED (
    SELECT t.id, t."callId"
    FROM "call_center_task" t
    WHERE t."practiceId" = $1
      AND t.status = 'OPEN'
      AND t.kind IN ('MISSED_CALL', 'VOICEMAIL')
      AND t."createdAt" < $2
    FOR UPDATE
  ),
  audit_events AS (
    INSERT INTO "call_center_event" (
      "practiceId",
      "aggregateType",
      "aggregateId",
      type,
      "occurredAt",
      "actorUserId",
      "idempotencyKey",
      data
    )
    SELECT
      $1,
      'TASK',
      candidates.id,
      'TASK_RESOLVED',
      $3,
      NULL,
      'manual-stale-action-cleanup:' || candidates.id,
      JSONB_BUILD_OBJECT(
        'callId', candidates."callId",
        'disposition', 'RESOLVED',
        'source', 'MANUAL_STALE_ACTION_CLEANUP',
        'cutoff', $2::timestamptz
      )
    FROM candidates
    ON CONFLICT ("practiceId", type, "idempotencyKey") DO NOTHING
    RETURNING revision
  ),
  resolved AS (
    UPDATE "call_center_task" t
    SET
      status = 'RESOLVED',
      "resolvedAt" = $3,
      "resolvedByUserId" = NULL,
      "updatedAt" = $3
    FROM candidates
    WHERE t.id = candidates.id
    RETURNING t.id
  )
  SELECT
    (SELECT COUNT(*) FROM candidates)::int AS "candidateCount",
    (SELECT COUNT(*) FROM audit_events)::int AS "auditEventsWritten",
    (SELECT COUNT(*) FROM resolved)::int AS "resolvedCount"
`;

function dateValue(value: unknown) {
  return value instanceof Date
    ? value.toISOString()
    : typeof value === "string"
      ? new Date(value).toISOString()
      : null;
}

export async function runStaleActionItemCleanup({
  apply,
  now = new Date(),
  pool,
}: {
  apply: boolean;
  now?: Date;
  pool: CleanupPool;
}): Promise<StaleActionItemCleanupReport> {
  const cutoff = new Date(
    now.getTime() - STALE_ACTION_ITEM_AGE_DAYS * 24 * 60 * 60 * 1_000,
  );
  const practices = await pool.query<{ id: string; name: string }>(practiceSql, [
    STALE_ACTION_ITEM_PRACTICE,
  ]);
  if (practices.rows.length !== 1) {
    throw new Error(
      `Expected exactly one ${STALE_ACTION_ITEM_PRACTICE} practice; found ${practices.rows.length}.`,
    );
  }
  const practice = practices.rows[0];
  const preview = await pool.query<{
    callbackAndFollowUpPreserved: number;
    candidateCount: number;
    newestCandidateAt: Date | string | null;
    oldestCandidateAt: Date | string | null;
  }>(previewSql, [practice.id, cutoff]);
  const counts = preview.rows[0];
  if (!counts) throw new Error("Cleanup preview did not return counts.");

  const report: StaleActionItemCleanupReport = {
    applied: false,
    auditEventsWritten: 0,
    callbackAndFollowUpPreserved: counts.callbackAndFollowUpPreserved,
    candidateCount: counts.candidateCount,
    cutoff: cutoff.toISOString(),
    newestCandidateAt: dateValue(counts.newestCandidateAt),
    oldestCandidateAt: dateValue(counts.oldestCandidateAt),
    practiceId: practice.id,
    practiceName: practice.name,
    resolvedCount: 0,
  };
  if (!apply || counts.candidateCount === 0) return report;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      auditEventsWritten: number;
      candidateCount: number;
      resolvedCount: number;
    }>(applySql, [practice.id, cutoff, now]);
    const applied = result.rows[0];
    if (!applied || applied.candidateCount !== applied.resolvedCount) {
      throw new Error("Cleanup candidate and resolution counts did not match.");
    }
    await client.query("COMMIT");
    return {
      ...report,
      applied: true,
      auditEventsWritten: applied.auditEventsWritten,
      candidateCount: applied.candidateCount,
      resolvedCount: applied.resolvedCount,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (import.meta.main) {
  config({ path: ".env", quiet: true });
  config({ path: ".env.local", override: true, quiet: true });
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const report = await runStaleActionItemCleanup({
      apply: process.argv.includes("--apply"),
      pool,
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}
