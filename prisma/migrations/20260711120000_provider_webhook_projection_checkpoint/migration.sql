BEGIN;

ALTER TABLE "provider_webhook_event"
ADD COLUMN IF NOT EXISTS "canonicalProjectionStatus" "ProviderWebhookProcessingStatus",
ADD COLUMN IF NOT EXISTS "canonicalProjectionAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "canonicalProjectionNextAttemptAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "canonicalProjectionErrorCode" VARCHAR(100),
ADD COLUMN IF NOT EXISTS "canonicalProjectedAt" TIMESTAMP(3);

-- Historical events may already have had their retained payload redacted, so
-- they are not safe projector input. The transaction holds the table lock while
-- this initializes only rows that predate the checkpoint.
UPDATE "provider_webhook_event"
SET "canonicalProjectionStatus" = 'IGNORED'
WHERE "canonicalProjectionStatus" IS NULL;

ALTER TABLE "provider_webhook_event"
ALTER COLUMN "canonicalProjectionStatus" SET DEFAULT 'RECEIVED',
ALTER COLUMN "canonicalProjectionStatus" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'provider_webhook_event_canonical_projection_attempt_count_check'
      AND conrelid = 'provider_webhook_event'::regclass
  ) THEN
    ALTER TABLE "provider_webhook_event"
    ADD CONSTRAINT "provider_webhook_event_canonical_projection_attempt_count_check"
    CHECK ("canonicalProjectionAttemptCount" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "provider_webhook_event_canonical_projection_recovery_idx"
ON "provider_webhook_event"(
  "canonicalProjectionStatus",
  "canonicalProjectionNextAttemptAt",
  "receivedAt"
);

COMMIT;
