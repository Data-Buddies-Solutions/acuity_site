import { beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

import { Client } from "pg";

const databaseUrl = process.env.CALL_CENTER_MIGRATION_TEST_DATABASE_URL;
const migrationPath = new URL("./migration.sql", import.meta.url);

function quotedIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function withRollbackStateFixture({
  setup,
  verify,
}: {
  setup?: (client: Client) => Promise<void>;
  verify: (client: Client) => Promise<void>;
}) {
  const client = new Client({ connectionString: databaseUrl });
  const schema = `call_center_cleanup_${crypto.randomUUID().replaceAll("-", "")}`;
  const quotedSchema = quotedIdentifier(schema);
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${quotedSchema}`);
    await client.query(`SET search_path TO ${quotedSchema}, public`);
    await client.query(`
      CREATE TYPE "CallCenterCallStatus" AS ENUM (
        'RECEIVED', 'QUEUED', 'RINGING', 'CONNECTED', 'WRAP_UP',
        'COMPLETED', 'VOICEMAIL', 'ABANDONED', 'FAILED'
      );
      CREATE TYPE "CallCenterAgentPresence" AS ENUM (
        'AVAILABLE', 'PAUSED', 'BUSY', 'WRAP_UP', 'OFFLINE'
      );
      CREATE TYPE "CallCenterAgentConnectionState" AS ENUM (
        'CONNECTING', 'READY', 'ERROR', 'CLOSED'
      );

      CREATE TABLE "call_center_queue" (
        "id" TEXT PRIMARY KEY,
        "ringTimeoutSec" INTEGER NOT NULL DEFAULT 20,
        "maxWaitSec" INTEGER NOT NULL DEFAULT 20,
        "wrapUpSec" INTEGER NOT NULL DEFAULT 0,
        "overflowQueueId" TEXT
      );
      ALTER TABLE "call_center_queue"
        ADD CONSTRAINT "call_center_queue_overflowQueueId_fkey"
        FOREIGN KEY ("overflowQueueId") REFERENCES "call_center_queue"("id")
        ON DELETE SET NULL;
      ALTER TABLE "call_center_queue"
        ADD CONSTRAINT "call_center_queue_timeout_bounds_check"
        CHECK (
          "ringTimeoutSec" > 0
          AND "ringTimeoutSec" <= 300
          AND "maxWaitSec" >= "ringTimeoutSec"
          AND "maxWaitSec" <= 1800
          AND "wrapUpSec" >= 0
          AND "wrapUpSec" <= 1800
        );
      CREATE INDEX "call_center_queue_overflowQueueId_idx"
        ON "call_center_queue"("overflowQueueId");

      CREATE TABLE "call_center_call" (
        "id" TEXT PRIMARY KEY,
        "status" "CallCenterCallStatus" NOT NULL,
        "effectOwner" TEXT NOT NULL,
        "deadlineAt" TIMESTAMPTZ,
        "queueDeadlineAt" TIMESTAMPTZ
      );

      CREATE TABLE "call_center_agent_session" (
        "id" TEXT PRIMARY KEY,
        "presence" "CallCenterAgentPresence" NOT NULL DEFAULT 'OFFLINE',
        "connectionState" "CallCenterAgentConnectionState" NOT NULL DEFAULT 'CONNECTING',
        "microphoneReady" BOOLEAN NOT NULL DEFAULT false,
        "audioReady" BOOLEAN NOT NULL DEFAULT false,
        "offeredCallId" TEXT,
        "currentCallId" TEXT
      );
      ALTER TABLE "call_center_agent_session"
        ADD CONSTRAINT "call_center_agent_session_offeredCallId_fkey"
        FOREIGN KEY ("offeredCallId") REFERENCES "call_center_call"("id")
        ON DELETE SET NULL;
      ALTER TABLE "call_center_agent_session"
        ADD CONSTRAINT "call_center_agent_session_currentCallId_fkey"
        FOREIGN KEY ("currentCallId") REFERENCES "call_center_call"("id")
        ON DELETE SET NULL;
      ALTER TABLE "call_center_agent_session"
        ADD CONSTRAINT "call_center_agent_session_available_check"
        CHECK (
          "presence" <> 'AVAILABLE'
          OR (
            "connectionState" = 'READY'
            AND "microphoneReady"
            AND "audioReady"
            AND "currentCallId" IS NULL
          )
        );
      CREATE INDEX "call_center_agent_session_offeredCallId_idx"
        ON "call_center_agent_session"("offeredCallId");
      CREATE INDEX "call_center_agent_session_currentCallId_idx"
        ON "call_center_agent_session"("currentCallId");

      CREATE TABLE "call_center_call_leg" ("id" TEXT PRIMARY KEY, "callId" TEXT NOT NULL);
      CREATE TABLE "call_center_event" ("id" TEXT PRIMARY KEY, "aggregateId" TEXT NOT NULL);
      CREATE TABLE "call_center_task" ("id" TEXT PRIMARY KEY, "callId" TEXT NOT NULL);
      CREATE TABLE "call_center_voicemail" ("id" TEXT PRIMARY KEY, "callId" TEXT NOT NULL);

      INSERT INTO "call_center_queue" ("id") VALUES ('queue-1');
      INSERT INTO "call_center_call"
        ("id", "status", "effectOwner", "deadlineAt", "queueDeadlineAt")
      VALUES
        ('call-active', 'RINGING', 'CANONICAL', NULL, NULL),
        ('call-history', 'COMPLETED', 'LEGACY', NULL, '2026-07-18T12:00:00Z');
      INSERT INTO "call_center_agent_session" ("id") VALUES ('session-1');
      INSERT INTO "call_center_call_leg" VALUES ('leg-1', 'call-history');
      INSERT INTO "call_center_event" VALUES ('event-1', 'call-history');
      INSERT INTO "call_center_task" VALUES ('task-1', 'call-history');
      INSERT INTO "call_center_voicemail" VALUES ('voicemail-1', 'call-history');
    `);
    if (setup) await setup(client);
    await verify(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query(`DROP SCHEMA ${quotedSchema} CASCADE`);
    await client.end();
  }
}

describe.skipIf(!databaseUrl)("rollback-only call-center state migration", () => {
  let migrationSql = "";

  beforeAll(async () => {
    migrationSql = await readFile(migrationPath, "utf8");
  });

  it("preserves canonical rows while removing rollback-only interfaces", async () => {
    await withRollbackStateFixture({
      verify: async (client) => {
        await client.query("SET acuity.call_center_rollback_closed = 'true'");
        await client.query(migrationSql);

        const counts = await client.query(`
        SELECT
          (SELECT COUNT(*)::int FROM "call_center_call") AS calls,
          (SELECT COUNT(*)::int FROM "call_center_call_leg") AS legs,
          (SELECT COUNT(*)::int FROM "call_center_agent_session") AS sessions,
          (SELECT COUNT(*)::int FROM "call_center_event") AS events,
          (SELECT COUNT(*)::int FROM "call_center_task") AS tasks,
          (SELECT COUNT(*)::int FROM "call_center_voicemail") AS voicemails
      `);
        expect(counts.rows[0]).toEqual({
          calls: 2,
          events: 1,
          legs: 1,
          sessions: 1,
          tasks: 1,
          voicemails: 1,
        });

        const columns = await client.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name IN (
            'call_center_queue',
            'call_center_agent_session',
            'call_center_call'
          )
      `);
        const names = columns.rows.map(({ column_name }) => column_name);
        expect(names).not.toContain("ringTimeoutSec");
        expect(names).not.toContain("maxWaitSec");
        expect(names).not.toContain("wrapUpSec");
        expect(names).not.toContain("overflowQueueId");
        expect(names).not.toContain("offeredCallId");
        expect(names).not.toContain("currentCallId");
        expect(names).not.toContain("queueDeadlineAt");
        expect(names).toContain("deadlineAt");
        expect(names).toContain("effectOwner");

        const retiredObjects = await client.query(`
          SELECT indexname AS name
          FROM pg_indexes
          WHERE schemaname = current_schema()
            AND indexname IN (
              'call_center_queue_overflowQueueId_idx',
              'call_center_agent_session_offeredCallId_idx',
              'call_center_agent_session_currentCallId_idx'
            )
          UNION ALL
          SELECT conname AS name
          FROM pg_constraint
          WHERE connamespace = current_schema()::regnamespace
            AND conname IN (
              'call_center_queue_overflowQueueId_fkey',
              'call_center_queue_timeout_bounds_check',
              'call_center_agent_session_single_occupancy_check',
              'call_center_agent_session_offeredCallId_fkey',
              'call_center_agent_session_currentCallId_fkey'
            )
        `);
        expect(retiredObjects.rows).toEqual([]);

        const availableConstraint = await client.query<{ definition: string }>(`
          SELECT pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
          WHERE connamespace = current_schema()::regnamespace
            AND conname = 'call_center_agent_session_available_check'
        `);
        expect(availableConstraint.rows).toHaveLength(1);
        expect(availableConstraint.rows[0]?.definition).toContain(
          "\"connectionState\" = 'READY'",
        );
        expect(availableConstraint.rows[0]?.definition).not.toContain("currentCallId");

        await expect(
          client.query(`
            UPDATE "call_center_agent_session"
            SET "presence" = 'AVAILABLE'
            WHERE "id" = 'session-1'
          `),
        ).rejects.toThrow();
      },
    });
  });

  it("requires the release owner to close the rollback window", async () => {
    await withRollbackStateFixture({
      verify: async (client) => {
        await expect(client.query(migrationSql)).rejects.toThrow(
          "call-center rollback window is not closed",
        );
      },
    });
  });

  for (const [state, mutation] of [
    ["noncanonical queue policy", `UPDATE "call_center_queue" SET "maxWaitSec" = 30`],
    [
      "session occupancy pointers",
      `UPDATE "call_center_agent_session" SET "offeredCallId" = 'call-active'`,
    ],
    [
      "an active duplicate deadline",
      `UPDATE "call_center_call"
       SET "queueDeadlineAt" = '2026-07-19T12:00:00Z'
       WHERE "id" = 'call-active'`,
    ],
  ]) {
    it(`refuses ${state} even after rollback closure`, async () => {
      await withRollbackStateFixture({
        setup: (client) => client.query(mutation).then(() => undefined),
        verify: async (client) => {
          await client.query("SET acuity.call_center_rollback_closed = 'true'");
          await expect(client.query(migrationSql)).rejects.toThrow(
            "rollback-only call-center state is still in use",
          );
        },
      });
    });
  }
});
