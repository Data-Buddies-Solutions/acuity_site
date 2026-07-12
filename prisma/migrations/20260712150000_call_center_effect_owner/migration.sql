CREATE TYPE "CallCenterEffectOwner" AS ENUM ('LEGACY', 'CANONICAL');

ALTER TABLE "call_center_call"
ADD COLUMN "effectOwner" "CallCenterEffectOwner" NOT NULL DEFAULT 'LEGACY';

ALTER TABLE "provider_webhook_event"
ADD COLUMN "effectOwner" "CallCenterEffectOwner" DEFAULT 'LEGACY',
ADD COLUMN "providerCallSessionId" TEXT;

-- ACTIVE routing did not exist before this migration. Existing inbox rows were
-- handled by legacy; preserve that owner and recover their Telnyx session key.
UPDATE "provider_webhook_event"
SET
  "effectOwner" = 'LEGACY',
  "providerCallSessionId" = NULLIF("payload" #>> '{data,payload,call_session_id}', '');

CREATE INDEX "provider_webhook_event_session_owner_idx"
ON "provider_webhook_event"("provider", "providerCallSessionId", "effectOwner");
