ALTER TABLE "call_center_agent_seat" ADD COLUMN "queueKey" TEXT;

CREATE INDEX "call_center_agent_seat_practiceId_queueKey_idx" ON "call_center_agent_seat"("practiceId", "queueKey");
CREATE INDEX "call_center_agent_seat_practiceId_queueKey_enabled_idx" ON "call_center_agent_seat"("practiceId", "queueKey", "enabled");
