ALTER TABLE "call_center_agent_session"
ADD COLUMN IF NOT EXISTS "stateVersion" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'call_center_agent_session_state_version_check'
      AND conrelid = '"call_center_agent_session"'::regclass
  ) THEN
    ALTER TABLE "call_center_agent_session"
    ADD CONSTRAINT "call_center_agent_session_state_version_check"
    CHECK ("stateVersion" >= 0);
  END IF;
END $$;
