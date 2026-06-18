-- Extend inbound caller ringback before voicemail to 30 seconds.
ALTER TABLE "practice_call_center_settings"
ALTER COLUMN "voicemailTimeoutSec" SET DEFAULT 30;

UPDATE "practice_call_center_settings"
SET "voicemailTimeoutSec" = 30
WHERE "voicemailTimeoutSec" < 30;
