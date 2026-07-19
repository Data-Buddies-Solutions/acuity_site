BEGIN;

DO $$
BEGIN
  IF current_setting('acuity.call_center_rollback_closed', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'call-center rollback window is not closed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "call_center_queue"
    WHERE "ringTimeoutSec" <> 20
      OR "maxWaitSec" <> 20
      OR "wrapUpSec" <> 0
      OR "overflowQueueId" IS NOT NULL
  )
  OR EXISTS (
    SELECT 1
    FROM "call_center_agent_session"
    WHERE "offeredCallId" IS NOT NULL
      OR "currentCallId" IS NOT NULL
  )
  OR EXISTS (
    SELECT 1
    FROM "call_center_call"
    WHERE "queueDeadlineAt" IS NOT NULL
      AND "status" IN ('RECEIVED', 'QUEUED', 'RINGING', 'CONNECTED', 'WRAP_UP')
  ) THEN
    RAISE EXCEPTION 'rollback-only call-center state is still in use';
  END IF;
END $$;

DROP INDEX IF EXISTS "call_center_queue_overflowQueueId_idx";
ALTER TABLE "call_center_queue"
DROP CONSTRAINT IF EXISTS "call_center_queue_overflowQueueId_fkey",
DROP CONSTRAINT IF EXISTS "call_center_queue_timeout_bounds_check",
DROP COLUMN "ringTimeoutSec",
DROP COLUMN "maxWaitSec",
DROP COLUMN "wrapUpSec",
DROP COLUMN "overflowQueueId";

DROP INDEX IF EXISTS "call_center_agent_session_offeredCallId_idx";
DROP INDEX IF EXISTS "call_center_agent_session_currentCallId_idx";
ALTER TABLE "call_center_agent_session"
DROP CONSTRAINT IF EXISTS "call_center_agent_session_single_occupancy_check",
DROP CONSTRAINT IF EXISTS "call_center_agent_session_offeredCallId_fkey",
DROP CONSTRAINT IF EXISTS "call_center_agent_session_currentCallId_fkey",
DROP CONSTRAINT IF EXISTS "call_center_agent_session_available_check",
DROP COLUMN "offeredCallId",
DROP COLUMN "currentCallId";

ALTER TABLE "call_center_agent_session"
ADD CONSTRAINT "call_center_agent_session_available_check"
CHECK (
  "presence" <> 'AVAILABLE'
  OR (
    "connectionState" = 'READY'
    AND "microphoneReady"
    AND "audioReady"
  )
);

ALTER TABLE "call_center_call"
DROP COLUMN "queueDeadlineAt";

COMMIT;
