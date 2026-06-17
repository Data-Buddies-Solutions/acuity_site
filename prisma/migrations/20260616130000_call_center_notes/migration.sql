-- CreateEnum
CREATE TYPE "CallCenterNoteDisposition" AS ENUM ('RESOLVED', 'CALLBACK_NEEDED', 'FOLLOW_UP_REQUIRED', 'WRONG_NUMBER', 'OTHER');

-- CreateTable
CREATE TABLE "call_center_note" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT,
    "fromPhone" TEXT NOT NULL,
    "sessionId" TEXT,
    "missedCallId" TEXT,
    "voicemailId" TEXT,
    "stationSeatId" TEXT,
    "stationLabelSnapshot" TEXT,
    "createdByUserId" TEXT,
    "createdByLabel" TEXT,
    "disposition" "CallCenterNoteDisposition" NOT NULL,
    "body" TEXT,
    "resolvedThread" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_center_note_practiceId_fromPhone_createdAt_idx" ON "call_center_note"("practiceId", "fromPhone", "createdAt");

-- CreateIndex
CREATE INDEX "call_center_note_practiceId_disposition_createdAt_idx" ON "call_center_note"("practiceId", "disposition", "createdAt");

-- CreateIndex
CREATE INDEX "call_center_note_locationId_idx" ON "call_center_note"("locationId");

-- CreateIndex
CREATE INDEX "call_center_note_sessionId_idx" ON "call_center_note"("sessionId");

-- CreateIndex
CREATE INDEX "call_center_note_missedCallId_idx" ON "call_center_note"("missedCallId");

-- CreateIndex
CREATE INDEX "call_center_note_voicemailId_idx" ON "call_center_note"("voicemailId");

-- CreateIndex
CREATE INDEX "call_center_note_stationSeatId_idx" ON "call_center_note"("stationSeatId");

-- CreateIndex
CREATE INDEX "call_center_note_createdByUserId_idx" ON "call_center_note"("createdByUserId");

-- AddForeignKey
ALTER TABLE "call_center_note" ADD CONSTRAINT "call_center_note_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_note" ADD CONSTRAINT "call_center_note_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "practice_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_note" ADD CONSTRAINT "call_center_note_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "call_center_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_note" ADD CONSTRAINT "call_center_note_missedCallId_fkey" FOREIGN KEY ("missedCallId") REFERENCES "call_center_missed_call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_note" ADD CONSTRAINT "call_center_note_voicemailId_fkey" FOREIGN KEY ("voicemailId") REFERENCES "call_center_voicemail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_note" ADD CONSTRAINT "call_center_note_stationSeatId_fkey" FOREIGN KEY ("stationSeatId") REFERENCES "call_center_agent_seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_note" ADD CONSTRAINT "call_center_note_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
