CREATE INDEX "call_center_call_practiceId_fromPhone_receivedAt_idx"
ON "call_center_call"("practiceId", "fromPhone", "receivedAt");

CREATE INDEX "call_center_call_practiceId_toPhone_receivedAt_idx"
ON "call_center_call"("practiceId", "toPhone", "receivedAt");
