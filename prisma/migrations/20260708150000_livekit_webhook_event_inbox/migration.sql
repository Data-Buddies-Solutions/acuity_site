CREATE TYPE "LiveKitWebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

CREATE TABLE "livekit_webhook_event" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "roomSid" TEXT,
    "roomName" TEXT,
    "participantSid" TEXT,
    "participantIdentity" TEXT,
    "agentCallId" TEXT,
    "processingStatus" "LiveKitWebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorMessage" TEXT,
    "payload" JSONB NOT NULL,
    "createdAtFromLiveKit" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "livekit_webhook_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "livekit_webhook_event_eventId_key" ON "livekit_webhook_event"("eventId");
CREATE INDEX "livekit_webhook_event_eventType_receivedAt_idx" ON "livekit_webhook_event"("eventType", "receivedAt");
CREATE INDEX "livekit_webhook_event_roomSid_idx" ON "livekit_webhook_event"("roomSid");
CREATE INDEX "livekit_webhook_event_roomName_idx" ON "livekit_webhook_event"("roomName");
CREATE INDEX "livekit_webhook_event_processingStatus_receivedAt_idx" ON "livekit_webhook_event"("processingStatus", "receivedAt");
CREATE INDEX "livekit_webhook_event_agentCallId_idx" ON "livekit_webhook_event"("agentCallId");

ALTER TABLE "livekit_webhook_event"
ADD CONSTRAINT "livekit_webhook_event_agentCallId_fkey"
FOREIGN KEY ("agentCallId") REFERENCES "agent_call"("id") ON DELETE SET NULL ON UPDATE CASCADE;
