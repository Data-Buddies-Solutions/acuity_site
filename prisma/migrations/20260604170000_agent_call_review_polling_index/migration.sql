-- CreateIndex
CREATE INDEX "agent_call_reviewStatus_endedAt_startedAt_idx" ON "agent_call"("reviewStatus", "endedAt" DESC, "startedAt" DESC);
