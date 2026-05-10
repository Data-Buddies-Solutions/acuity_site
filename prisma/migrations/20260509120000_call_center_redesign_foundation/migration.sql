-- CreateEnum
CREATE TYPE "CallCenterPresenceStatus" AS ENUM ('AVAILABLE', 'BUSY', 'OFFLINE', 'PAUSED');

-- CreateEnum
CREATE TYPE "CallCenterQueueStatus" AS ENUM ('RINGING', 'WAITING', 'ASSIGNED', 'ACTIVE', 'VOICEMAIL', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "CallCenterRingAttemptStatus" AS ENUM ('DIALING', 'RINGING', 'ANSWERED', 'BRIDGED', 'CANCELED', 'NO_ANSWER', 'FAILED');

-- CreateTable
CREATE TABLE "call_center_agent_seat" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT,
    "label" TEXT NOT NULL,
    "extension" TEXT,
    "telnyxCredentialId" TEXT,
    "sipUsername" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_agent_seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_presence" (
    "id" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "userId" TEXT,
    "browserSessionId" TEXT NOT NULL,
    "status" "CallCenterPresenceStatus" NOT NULL DEFAULT 'OFFLINE',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_queue_item" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT,
    "callerSessionId" TEXT,
    "fromPhone" TEXT,
    "toPhone" TEXT,
    "status" "CallCenterQueueStatus" NOT NULL DEFAULT 'RINGING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "voicemailStartedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_queue_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_ring_attempt" (
    "id" TEXT NOT NULL,
    "queueItemId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "telnyxCallControlId" TEXT,
    "status" "CallCenterRingAttemptStatus" NOT NULL DEFAULT 'DIALING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "hangupCause" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_ring_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_center_agent_seat_practiceId_idx" ON "call_center_agent_seat"("practiceId");

-- CreateIndex
CREATE INDEX "call_center_agent_seat_practiceId_locationId_idx" ON "call_center_agent_seat"("practiceId", "locationId");

-- CreateIndex
CREATE INDEX "call_center_agent_seat_practiceId_locationId_enabled_idx" ON "call_center_agent_seat"("practiceId", "locationId", "enabled");

-- CreateIndex
CREATE INDEX "call_center_agent_seat_practiceId_locationId_extension_idx" ON "call_center_agent_seat"("practiceId", "locationId", "extension");

-- CreateIndex
CREATE INDEX "call_center_agent_seat_telnyxCredentialId_idx" ON "call_center_agent_seat"("telnyxCredentialId");

-- CreateIndex
CREATE INDEX "call_center_agent_seat_sipUsername_idx" ON "call_center_agent_seat"("sipUsername");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_presence_seatId_browserSessionId_key" ON "call_center_presence"("seatId", "browserSessionId");

-- CreateIndex
CREATE INDEX "call_center_presence_seatId_idx" ON "call_center_presence"("seatId");

-- CreateIndex
CREATE INDEX "call_center_presence_userId_idx" ON "call_center_presence"("userId");

-- CreateIndex
CREATE INDEX "call_center_presence_status_lastSeenAt_idx" ON "call_center_presence"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "call_center_presence_currentSessionId_idx" ON "call_center_presence"("currentSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_queue_item_callerSessionId_key" ON "call_center_queue_item"("callerSessionId");

-- CreateIndex
CREATE INDEX "call_center_queue_item_practiceId_locationId_status_enteredAt_idx" ON "call_center_queue_item"("practiceId", "locationId", "status", "enteredAt");

-- CreateIndex
CREATE INDEX "call_center_queue_item_practiceId_status_enteredAt_idx" ON "call_center_queue_item"("practiceId", "status", "enteredAt");

-- CreateIndex
CREATE INDEX "call_center_queue_item_locationId_idx" ON "call_center_queue_item"("locationId");

-- CreateIndex
CREATE INDEX "call_center_queue_item_callerSessionId_idx" ON "call_center_queue_item"("callerSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_ring_attempt_telnyxCallControlId_key" ON "call_center_ring_attempt"("telnyxCallControlId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_ring_attempt_queueItemId_seatId_key" ON "call_center_ring_attempt"("queueItemId", "seatId");

-- CreateIndex
CREATE INDEX "call_center_ring_attempt_queueItemId_idx" ON "call_center_ring_attempt"("queueItemId");

-- CreateIndex
CREATE INDEX "call_center_ring_attempt_seatId_idx" ON "call_center_ring_attempt"("seatId");

-- CreateIndex
CREATE INDEX "call_center_ring_attempt_status_idx" ON "call_center_ring_attempt"("status");

-- AddForeignKey
ALTER TABLE "call_center_agent_seat" ADD CONSTRAINT "call_center_agent_seat_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_agent_seat" ADD CONSTRAINT "call_center_agent_seat_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "practice_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_presence" ADD CONSTRAINT "call_center_presence_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "call_center_agent_seat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_presence" ADD CONSTRAINT "call_center_presence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_queue_item" ADD CONSTRAINT "call_center_queue_item_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_queue_item" ADD CONSTRAINT "call_center_queue_item_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "practice_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_queue_item" ADD CONSTRAINT "call_center_queue_item_callerSessionId_fkey" FOREIGN KEY ("callerSessionId") REFERENCES "call_center_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_ring_attempt" ADD CONSTRAINT "call_center_ring_attempt_queueItemId_fkey" FOREIGN KEY ("queueItemId") REFERENCES "call_center_queue_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_ring_attempt" ADD CONSTRAINT "call_center_ring_attempt_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "call_center_agent_seat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
