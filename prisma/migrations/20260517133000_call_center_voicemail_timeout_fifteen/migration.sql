ALTER TABLE "practice_call_center_settings"
ALTER COLUMN "voicemailTimeoutSec" SET DEFAULT 15;

UPDATE "practice_call_center_settings"
SET "voicemailTimeoutSec" = 15
WHERE "voicemailTimeoutSec" < 15;
