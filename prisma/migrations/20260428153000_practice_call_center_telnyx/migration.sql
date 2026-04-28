-- CreateEnum
CREATE TYPE "CallCenterProvider" AS ENUM ('TELNYX');

-- CreateEnum
CREATE TYPE "CallCenterSessionDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CallCenterSessionStatus" AS ENUM ('RINGING', 'ACTIVE', 'COMPLETED', 'MISSED', 'VOICEMAIL', 'FAILED');

-- CreateTable
CREATE TABLE "practice_call_center_settings" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" "CallCenterProvider" NOT NULL DEFAULT 'TELNYX',
    "telnyxConnectionId" TEXT,
    "telnyxCredentialId" TEXT,
    "inboundPhoneNumber" TEXT,
    "outboundCallerNumber" TEXT,
    "voicemailGreeting" TEXT NOT NULL DEFAULT 'Please leave a message after the beep.',
    "voicemailTimeoutSec" INTEGER NOT NULL DEFAULT 10,
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_call_center_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_session" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT,
    "agentCallId" TEXT,
    "provider" "CallCenterProvider" NOT NULL DEFAULT 'TELNYX',
    "telnyxCallControlId" TEXT,
    "telnyxCallSessionId" TEXT,
    "direction" "CallCenterSessionDirection" NOT NULL DEFAULT 'UNKNOWN',
    "status" "CallCenterSessionStatus" NOT NULL DEFAULT 'RINGING',
    "fromPhone" TEXT,
    "toPhone" TEXT,
    "callerName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_missed_call" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT,
    "sessionId" TEXT,
    "agentCallId" TEXT,
    "fromPhone" TEXT NOT NULL,
    "callerName" TEXT,
    "calledBack" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_missed_call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_voicemail" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT,
    "sessionId" TEXT,
    "missedCallId" TEXT,
    "fromPhone" TEXT NOT NULL,
    "callerName" TEXT,
    "recordingUrl" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "listenedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_voicemail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practice_call_center_settings_practiceId_key" ON "practice_call_center_settings"("practiceId");

-- CreateIndex
CREATE INDEX "practice_call_center_settings_enabled_idx" ON "practice_call_center_settings"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_session_telnyxCallControlId_key" ON "call_center_session"("telnyxCallControlId");

-- CreateIndex
CREATE INDEX "call_center_session_practiceId_startedAt_idx" ON "call_center_session"("practiceId", "startedAt");

-- CreateIndex
CREATE INDEX "call_center_session_practiceId_status_idx" ON "call_center_session"("practiceId", "status");

-- CreateIndex
CREATE INDEX "call_center_session_locationId_idx" ON "call_center_session"("locationId");

-- CreateIndex
CREATE INDEX "call_center_session_agentCallId_idx" ON "call_center_session"("agentCallId");

-- CreateIndex
CREATE INDEX "call_center_session_telnyxCallSessionId_idx" ON "call_center_session"("telnyxCallSessionId");

-- CreateIndex
CREATE INDEX "call_center_missed_call_practiceId_calledBack_createdAt_idx" ON "call_center_missed_call"("practiceId", "calledBack", "createdAt");

-- CreateIndex
CREATE INDEX "call_center_missed_call_practiceId_fromPhone_idx" ON "call_center_missed_call"("practiceId", "fromPhone");

-- CreateIndex
CREATE INDEX "call_center_missed_call_locationId_idx" ON "call_center_missed_call"("locationId");

-- CreateIndex
CREATE INDEX "call_center_missed_call_sessionId_idx" ON "call_center_missed_call"("sessionId");

-- CreateIndex
CREATE INDEX "call_center_missed_call_agentCallId_idx" ON "call_center_missed_call"("agentCallId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_voicemail_recordingId_key" ON "call_center_voicemail"("recordingId");

-- CreateIndex
CREATE INDEX "call_center_voicemail_practiceId_createdAt_idx" ON "call_center_voicemail"("practiceId", "createdAt");

-- CreateIndex
CREATE INDEX "call_center_voicemail_practiceId_resolvedAt_idx" ON "call_center_voicemail"("practiceId", "resolvedAt");

-- CreateIndex
CREATE INDEX "call_center_voicemail_practiceId_fromPhone_idx" ON "call_center_voicemail"("practiceId", "fromPhone");

-- CreateIndex
CREATE INDEX "call_center_voicemail_locationId_idx" ON "call_center_voicemail"("locationId");

-- CreateIndex
CREATE INDEX "call_center_voicemail_sessionId_idx" ON "call_center_voicemail"("sessionId");

-- CreateIndex
CREATE INDEX "call_center_voicemail_missedCallId_idx" ON "call_center_voicemail"("missedCallId");

-- AddForeignKey
ALTER TABLE "practice_call_center_settings" ADD CONSTRAINT "practice_call_center_settings_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_session" ADD CONSTRAINT "call_center_session_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_session" ADD CONSTRAINT "call_center_session_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "practice_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_session" ADD CONSTRAINT "call_center_session_agentCallId_fkey" FOREIGN KEY ("agentCallId") REFERENCES "agent_call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_missed_call" ADD CONSTRAINT "call_center_missed_call_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_missed_call" ADD CONSTRAINT "call_center_missed_call_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "practice_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_missed_call" ADD CONSTRAINT "call_center_missed_call_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "call_center_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_missed_call" ADD CONSTRAINT "call_center_missed_call_agentCallId_fkey" FOREIGN KEY ("agentCallId") REFERENCES "agent_call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_voicemail" ADD CONSTRAINT "call_center_voicemail_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_voicemail" ADD CONSTRAINT "call_center_voicemail_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "practice_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_voicemail" ADD CONSTRAINT "call_center_voicemail_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "call_center_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_voicemail" ADD CONSTRAINT "call_center_voicemail_missedCallId_fkey" FOREIGN KEY ("missedCallId") REFERENCES "call_center_missed_call"("id") ON DELETE SET NULL ON UPDATE CASCADE;
