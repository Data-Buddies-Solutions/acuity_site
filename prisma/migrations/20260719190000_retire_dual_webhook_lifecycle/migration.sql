BEGIN;

-- Removal was authorized on 2026-07-19 after production and Telnyx delivery
-- evidence showed no nonterminal legacy call or unresolved legacy event, and
-- the release owner accepted the residual assumption that Telnyx will not
-- redeliver a finalized Voice webhook more than 72 hours after its final
-- delivery record. Keep the database gate decisive in case production changes
-- before this migration runs.
-- Match runtime lock order, then prevent a new call/event claim between the
-- guard, checkpoint backfill, and column removal.
LOCK TABLE "call_center_call" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "provider_webhook_event" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "call_center_call"
    WHERE "effectOwner" = 'LEGACY'
      AND "status" IN ('RECEIVED', 'QUEUED', 'RINGING', 'CONNECTED', 'WRAP_UP')
  ) THEN
    RAISE EXCEPTION
      'Cannot retire effectOwner while a legacy call is nonterminal';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "provider_webhook_event"
    WHERE "effectOwner" = 'LEGACY'
      AND "processingStatus" NOT IN ('PROCESSED', 'IGNORED')
  ) THEN
    RAISE EXCEPTION
      'Cannot retire effectOwner while a legacy provider event is unresolved';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "provider_webhook_event"
    WHERE "effectOwner" IS NULL
      AND "processingStatus" NOT IN ('PROCESSED', 'IGNORED')
  ) THEN
    RAISE EXCEPTION
      'Cannot retire effectOwner while provider-event admission is unresolved';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "provider_webhook_event"
    WHERE "processingStatus" = 'PROCESSING'
       OR "canonicalProjectionStatus" = 'PROCESSING'
  ) THEN
    RAISE EXCEPTION
      'Cannot consolidate provider-event lifecycle while an event claim is active';
  END IF;
END $$;

-- Canonical projection was the authoritative lifecycle for canonical events.
-- Move that checkpoint into the retained event fields before dropping the
-- duplicate status, retry, error, and timestamp set.
UPDATE "provider_webhook_event"
SET
  "processingStatus" = "canonicalProjectionStatus",
  "attemptCount" = "canonicalProjectionAttemptCount",
  "nextAttemptAt" = "canonicalProjectionNextAttemptAt",
  "errorCode" = "canonicalProjectionErrorCode",
  "processedAt" = "canonicalProjectedAt"
WHERE "effectOwner" = 'CANONICAL';

DROP INDEX "provider_webhook_event_canonical_projection_recovery_idx";
DROP INDEX "provider_webhook_event_session_owner_idx";
DROP INDEX "call_center_call_direction_effectOwner_status_deadlineAt_idx";

ALTER TABLE "provider_webhook_event"
  DROP CONSTRAINT "provider_webhook_event_canonical_projection_attempt_count_check",
  DROP COLUMN "canonicalProjectionStatus",
  DROP COLUMN "canonicalProjectionAttemptCount",
  DROP COLUMN "canonicalProjectionNextAttemptAt",
  DROP COLUMN "canonicalProjectionErrorCode",
  DROP COLUMN "canonicalProjectedAt",
  DROP COLUMN "effectOwner";

ALTER TABLE "call_center_call"
  DROP COLUMN "effectOwner";

CREATE INDEX "provider_webhook_event_provider_providerCallSessionId_idx"
ON "provider_webhook_event"("provider", "providerCallSessionId");

CREATE INDEX "call_center_call_direction_status_deadlineAt_idx"
ON "call_center_call"("direction", "status", "deadlineAt");

DROP TYPE "CallCenterEffectOwner";

COMMIT;
