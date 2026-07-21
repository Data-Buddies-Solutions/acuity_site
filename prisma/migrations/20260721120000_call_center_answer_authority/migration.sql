CREATE TYPE "CallCenterAnswerReservationStatus" AS ENUM (
  'ACCEPTED',
  'ANSWERED',
  'BRIDGED',
  'RELEASED',
  'FAILED',
  'EXPIRED'
);

ALTER TABLE "call_center_call"
ADD COLUMN "routingRequestedAt" TIMESTAMP(3),
ADD COLUMN "firstAgentInitiatedAt" TIMESTAMP(3),
ADD COLUMN "hardDeadlineAt" TIMESTAMP(3);

UPDATE "call_center_call"
SET
  "routingRequestedAt" = COALESCE("queuedAt", "receivedAt"),
  "firstAgentInitiatedAt" = COALESCE("firstRingAt", "queuedAt", "receivedAt"),
  "hardDeadlineAt" = COALESCE("queuedAt", "receivedAt") + INTERVAL '60 seconds'
WHERE "direction" = 'INBOUND'
  AND "status" IN ('RECEIVED', 'QUEUED', 'RINGING', 'CONNECTED');

CREATE TABLE "call_center_answer_reservation" (
  "id" TEXT NOT NULL,
  "callId" TEXT NOT NULL,
  "legId" TEXT NOT NULL,
  "agentSessionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "CallCenterAnswerReservationStatus" NOT NULL DEFAULT 'ACCEPTED',
  "acceptedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "answeredAt" TIMESTAMP(3),
  "bridgedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "call_center_answer_reservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "call_center_answer_reservation_callId_fkey"
    FOREIGN KEY ("callId") REFERENCES "call_center_call"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "call_center_answer_reservation_legId_fkey"
    FOREIGN KEY ("legId") REFERENCES "call_center_call_leg"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "call_center_answer_reservation_agentSessionId_fkey"
    FOREIGN KEY ("agentSessionId") REFERENCES "call_center_agent_session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "call_center_answer_reservation_callId_key"
ON "call_center_answer_reservation"("callId");

CREATE INDEX "call_center_answer_reservation_legId_idx"
ON "call_center_answer_reservation"("legId");

CREATE INDEX "call_center_answer_reservation_agentSessionId_idx"
ON "call_center_answer_reservation"("agentSessionId");

CREATE INDEX "call_center_answer_reservation_status_expiresAt_idx"
ON "call_center_answer_reservation"("status", "expiresAt");
