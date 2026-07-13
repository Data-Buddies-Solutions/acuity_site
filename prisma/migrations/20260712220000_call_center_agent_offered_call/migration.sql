BEGIN;

ALTER TABLE "call_center_agent_session"
ADD COLUMN "offeredCallId" TEXT;

ALTER TABLE "call_center_agent_session"
ADD CONSTRAINT "call_center_agent_session_single_occupancy_check"
CHECK (NOT ("offeredCallId" IS NOT NULL AND "currentCallId" IS NOT NULL));

CREATE INDEX "call_center_agent_session_offeredCallId_idx"
ON "call_center_agent_session"("offeredCallId");

ALTER TABLE "call_center_agent_session"
ADD CONSTRAINT "call_center_agent_session_offeredCallId_fkey"
FOREIGN KEY ("offeredCallId") REFERENCES "call_center_call"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
