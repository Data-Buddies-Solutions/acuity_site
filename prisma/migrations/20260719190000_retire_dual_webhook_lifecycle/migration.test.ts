import { beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

import { Client } from "pg";

const databaseUrl = process.env.CALL_CENTER_MIGRATION_TEST_DATABASE_URL;
const migrationPath = new URL("./migration.sql", import.meta.url);

function quotedIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function withWebhookLifecycleFixture({
  setup,
  verify,
}: {
  setup?: (client: Client) => Promise<void>;
  verify: (
    client: Client,
    context: { applicationName: string; schema: string },
  ) => Promise<void>;
}) {
  const id = crypto.randomUUID().replaceAll("-", "");
  const applicationName = `webhook_migration_${id}`;
  const client = new Client({
    application_name: applicationName,
    connectionString: databaseUrl,
  });
  const schema = `webhook_lifecycle_${id}`;
  const quotedSchema = quotedIdentifier(schema);
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${quotedSchema}`);
    await client.query(`SET search_path TO ${quotedSchema}, public`);
    await client.query(`
      CREATE TYPE "CallCenterEffectOwner" AS ENUM ('LEGACY', 'CANONICAL');
      CREATE TYPE "CallCenterCallStatus" AS ENUM (
        'RECEIVED', 'QUEUED', 'RINGING', 'CONNECTED', 'WRAP_UP',
        'COMPLETED', 'VOICEMAIL', 'ABANDONED', 'FAILED'
      );
      CREATE TYPE "CallCenterProvider" AS ENUM ('TELNYX');
      CREATE TYPE "ProviderWebhookProcessingStatus" AS ENUM (
        'RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED'
      );

      CREATE TABLE "call_center_call" (
        "id" TEXT PRIMARY KEY,
        "direction" TEXT NOT NULL,
        "effectOwner" "CallCenterEffectOwner" NOT NULL DEFAULT 'CANONICAL',
        "status" "CallCenterCallStatus" NOT NULL,
        "deadlineAt" TIMESTAMPTZ
      );
      CREATE INDEX "call_center_call_direction_effectOwner_status_deadlineAt_idx"
        ON "call_center_call"("direction", "effectOwner", "status", "deadlineAt");

      CREATE TABLE "provider_webhook_event" (
        "id" TEXT PRIMARY KEY,
        "provider" "CallCenterProvider" NOT NULL,
        "providerEventId" TEXT NOT NULL,
        "eventType" TEXT NOT NULL,
        "effectOwner" "CallCenterEffectOwner",
        "providerCallSessionId" TEXT,
        "processingStatus" "ProviderWebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
        "attemptCount" INTEGER NOT NULL DEFAULT 0,
        "nextAttemptAt" TIMESTAMPTZ,
        "errorCode" TEXT,
        "processedAt" TIMESTAMPTZ,
        "canonicalProjectionStatus" "ProviderWebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
        "canonicalProjectionAttemptCount" INTEGER NOT NULL DEFAULT 0,
        "canonicalProjectionNextAttemptAt" TIMESTAMPTZ,
        "canonicalProjectionErrorCode" VARCHAR(100),
        "canonicalProjectedAt" TIMESTAMPTZ,
        "receivedAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL
      );
      ALTER TABLE "provider_webhook_event"
        ADD CONSTRAINT "provider_webhook_event_canonical_projection_attempt_count_check"
        CHECK ("canonicalProjectionAttemptCount" >= 0);
      CREATE INDEX "provider_webhook_event_canonical_projection_recovery_idx"
        ON "provider_webhook_event"(
          "canonicalProjectionStatus",
          "canonicalProjectionNextAttemptAt",
          "receivedAt"
        );
      CREATE INDEX "provider_webhook_event_session_owner_idx"
        ON "provider_webhook_event"("provider", "providerCallSessionId", "effectOwner");

      INSERT INTO "call_center_call"
        ("id", "direction", "effectOwner", "status", "deadlineAt")
      VALUES
        ('legacy-history', 'INBOUND', 'LEGACY', 'COMPLETED', NULL),
        ('canonical-active', 'INBOUND', 'CANONICAL', 'RINGING', NOW());

      INSERT INTO "provider_webhook_event" (
        "id",
        "provider",
        "providerEventId",
        "eventType",
        "effectOwner",
        "providerCallSessionId",
        "processingStatus",
        "attemptCount",
        "errorCode",
        "processedAt",
        "canonicalProjectionStatus",
        "canonicalProjectionAttemptCount",
        "canonicalProjectionNextAttemptAt",
        "canonicalProjectionErrorCode",
        "canonicalProjectedAt",
        "receivedAt",
        "updatedAt"
      )
      VALUES
        (
          'legacy-event',
          'TELNYX',
          'provider-legacy',
          'call.hangup',
          'LEGACY',
          'legacy-session',
          'PROCESSED',
          1,
          NULL,
          NOW(),
          'RECEIVED',
          0,
          NULL,
          NULL,
          NULL,
          NOW(),
          NOW()
        ),
        (
          'canonical-event',
          'TELNYX',
          'provider-canonical',
          'call.answered',
          'CANONICAL',
          'canonical-session',
          'IGNORED',
          1,
          NULL,
          NOW(),
          'FAILED',
          3,
          NOW(),
          'CANONICAL_QUEUE_NOT_CONFIGURED',
          NULL,
          NOW(),
          NOW()
        ),
        (
          'ignored-event',
          'TELNYX',
          'provider-ignored',
          'call.initiated',
          NULL,
          'ignored-session',
          'IGNORED',
          1,
          'TELNYX_EVENT_OUT_OF_SCOPE',
          NOW(),
          'RECEIVED',
          0,
          NULL,
          NULL,
          NULL,
          NOW(),
          NOW()
        );
    `);
    if (setup) await setup(client);
    await verify(client, { applicationName, schema });
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query(`DROP SCHEMA ${quotedSchema} CASCADE`);
    await client.end();
  }
}

describe.skipIf(!databaseUrl)("single provider-webhook lifecycle migration", () => {
  let migrationSql = "";

  beforeAll(async () => {
    migrationSql = await readFile(migrationPath, "utf8");
  });

  it("preserves rows and retains the canonical projection checkpoint", async () => {
    await withWebhookLifecycleFixture({
      verify: async (client) => {
        await client.query(migrationSql);

        const events = await client.query(`
          SELECT
            "id",
            "processingStatus",
            "attemptCount",
            "errorCode",
            "processedAt" IS NOT NULL AS "processed"
          FROM "provider_webhook_event"
          ORDER BY "id"
        `);
        expect(events.rows).toEqual([
          {
            attemptCount: 3,
            errorCode: "CANONICAL_QUEUE_NOT_CONFIGURED",
            id: "canonical-event",
            processed: false,
            processingStatus: "FAILED",
          },
          {
            attemptCount: 1,
            errorCode: "TELNYX_EVENT_OUT_OF_SCOPE",
            id: "ignored-event",
            processed: true,
            processingStatus: "IGNORED",
          },
          {
            attemptCount: 1,
            errorCode: null,
            id: "legacy-event",
            processed: true,
            processingStatus: "PROCESSED",
          },
        ]);

        const columns = await client.query<{ column_name: string }>(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name IN ('call_center_call', 'provider_webhook_event')
        `);
        const names = columns.rows.map(({ column_name }) => column_name);
        expect(names).not.toContain("effectOwner");
        expect(names).not.toContain("canonicalProjectionStatus");
        expect(names).not.toContain("canonicalProjectionAttemptCount");
        expect(names).not.toContain("canonicalProjectionNextAttemptAt");
        expect(names).not.toContain("canonicalProjectionErrorCode");
        expect(names).not.toContain("canonicalProjectedAt");

        const retiredType = await client.query(`
          SELECT 1
          FROM pg_type
          WHERE typnamespace = current_schema()::regnamespace
            AND typname = 'CallCenterEffectOwner'
        `);
        expect(retiredType.rows).toEqual([]);
      },
    });
  });

  it("refuses a nonterminal legacy call without changing the schema", async () => {
    await withWebhookLifecycleFixture({
      setup: (client) =>
        client
          .query(
            `UPDATE "call_center_call" SET "status" = 'RINGING'
             WHERE "id" = 'legacy-history'`,
          )
          .then(() => undefined),
      verify: async (client) => {
        await expect(client.query(migrationSql)).rejects.toThrow(
          "Cannot retire effectOwner while a legacy call is nonterminal",
        );
        await client.query("ROLLBACK");
        const columns = await client.query<{ column_name: string }>(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'call_center_call'
        `);
        expect(columns.rows.map(({ column_name }) => column_name)).toContain(
          "effectOwner",
        );
      },
    });
  });

  it("refuses an unresolved legacy event", async () => {
    await withWebhookLifecycleFixture({
      setup: (client) =>
        client
          .query(
            `UPDATE "provider_webhook_event" SET "processingStatus" = 'FAILED'
             WHERE "id" = 'legacy-event'`,
          )
          .then(() => undefined),
      verify: async (client) => {
        await expect(client.query(migrationSql)).rejects.toThrow(
          "Cannot retire effectOwner while a legacy provider event is unresolved",
        );
      },
    });
  });

  it("rechecks a concurrent claim before destructive cleanup", async () => {
    await withWebhookLifecycleFixture({
      verify: async (client, { applicationName, schema }) => {
        const claimant = new Client({ connectionString: databaseUrl });
        await claimant.connect();
        try {
          await claimant.query(`SET search_path TO ${quotedIdentifier(schema)}, public`);
          await claimant.query("BEGIN");
          await claimant.query(`
            UPDATE "provider_webhook_event"
            SET "processingStatus" = 'PROCESSING'
            WHERE "id" = 'canonical-event'
          `);

          const migration = client.query(migrationSql);
          void migration.catch(() => undefined);
          let migrationIsWaiting = false;
          for (let attempt = 0; attempt < 50; attempt += 1) {
            const activity = await claimant.query<{ wait_event_type: string | null }>(
              `SELECT wait_event_type
               FROM pg_stat_activity
               WHERE application_name = $1`,
              [applicationName],
            );
            migrationIsWaiting = activity.rows[0]?.wait_event_type === "Lock";
            if (migrationIsWaiting) break;
          }
          expect(migrationIsWaiting).toBe(true);

          await claimant.query("COMMIT");
          await expect(migration).rejects.toThrow(
            "Cannot consolidate provider-event lifecycle while an event claim is active",
          );
        } finally {
          await claimant.query("ROLLBACK").catch(() => undefined);
          await claimant.end();
        }
      },
    });
  });
});
