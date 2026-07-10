-- CreateEnum
CREATE TYPE "CallCenterQueueMemberRole" AS ENUM ('AGENT', 'SUPERVISOR');

-- CreateEnum
CREATE TYPE "CallCenterRoutingMode" AS ENUM ('LEGACY', 'SHADOW', 'ACTIVE');

-- CreateEnum
CREATE TYPE "CallCenterAgentPresence" AS ENUM ('AVAILABLE', 'PAUSED', 'BUSY', 'WRAP_UP', 'OFFLINE');

-- CreateEnum
CREATE TYPE "CallCenterAgentConnectionState" AS ENUM ('CONNECTING', 'READY', 'ERROR', 'CLOSED');

-- CreateEnum
CREATE TYPE "CallCenterCallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CallCenterCallStatus" AS ENUM ('RECEIVED', 'QUEUED', 'RINGING', 'CONNECTED', 'WRAP_UP', 'COMPLETED', 'VOICEMAIL', 'ABANDONED', 'FAILED');

-- CreateEnum
CREATE TYPE "CallCenterLegKind" AS ENUM ('CUSTOMER', 'AGENT');

-- CreateEnum
CREATE TYPE "CallCenterLegStatus" AS ENUM ('CREATED', 'DIALING', 'RINGING', 'ANSWERED', 'BRIDGED', 'ENDED', 'FAILED');

-- CreateEnum
CREATE TYPE "CallCenterTaskKind" AS ENUM ('MISSED_CALL', 'VOICEMAIL', 'CALLBACK', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "CallCenterTaskStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ProviderWebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "CallCenterCommandType" AS ENUM ('ANSWER_CUSTOMER', 'START_RINGBACK', 'DIAL_AGENT', 'STOP_PLAYBACK', 'BRIDGE_LEGS', 'HANGUP_LEG', 'PLAY_VOICEMAIL_GREETING', 'START_RECORDING');

-- CreateEnum
CREATE TYPE "CallCenterCommandStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "CallCenterEventAggregateType" AS ENUM ('CALL', 'AGENT_SESSION', 'TASK', 'CONFIGURATION');

-- AlterTable
ALTER TABLE "practice_call_center_settings" ADD COLUMN     "defaultOutboundNumberId" TEXT;

-- AlterTable
ALTER TABLE "call_center_voicemail" ADD COLUMN     "callCenterCallId" TEXT;

-- AlterTable
ALTER TABLE "call_center_presence" ADD COLUMN     "readyForCalls" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "call_center_session" ADD COLUMN     "telnyxCallLegId" TEXT;

-- AlterTable
ALTER TABLE "call_center_ring_attempt" ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "call_center_ring_attempt" ADD CONSTRAINT "call_center_ring_attempt_generation_check" CHECK ("generation" > 0);
CREATE UNIQUE INDEX "call_center_ring_attempt_queueItemId_seatId_generation_key" ON "call_center_ring_attempt"("queueItemId", "seatId", "generation");

-- CreateTable
CREATE TABLE "call_center_queue" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "routingMode" "CallCenterRoutingMode" NOT NULL DEFAULT 'LEGACY',
    "ringTimeoutSec" INTEGER NOT NULL DEFAULT 20,
    "maxWaitSec" INTEGER NOT NULL DEFAULT 30,
    "wrapUpSec" INTEGER NOT NULL DEFAULT 0,
    "voicemailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "voicemailGreeting" TEXT NOT NULL DEFAULT 'Please leave a message after the beep.',
    "overflowQueueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_queue_location" (
    "queueId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_center_queue_location_pkey" PRIMARY KEY ("queueId","locationId")
);

-- CreateTable
CREATE TABLE "call_center_number" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "practicePhoneNumberId" TEXT NOT NULL,
    "providerNumberId" TEXT,
    "inboundQueueId" TEXT,
    "inboundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "outboundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_number_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_queue_member" (
    "id" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CallCenterQueueMemberRole" NOT NULL DEFAULT 'AGENT',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_queue_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_endpoint" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT,
    "label" TEXT NOT NULL,
    "providerCredentialId" TEXT,
    "sipUsername" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_agent_session" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "browserSessionId" TEXT NOT NULL,
    "presence" "CallCenterAgentPresence" NOT NULL DEFAULT 'OFFLINE',
    "connectionState" "CallCenterAgentConnectionState" NOT NULL DEFAULT 'CONNECTING',
    "microphoneReady" BOOLEAN NOT NULL DEFAULT false,
    "audioReady" BOOLEAN NOT NULL DEFAULT false,
    "currentCallId" TEXT,
    "readyAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_agent_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_call" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "queueId" TEXT,
    "numberId" TEXT NOT NULL,
    "direction" "CallCenterCallDirection" NOT NULL,
    "status" "CallCenterCallStatus" NOT NULL DEFAULT 'RECEIVED',
    "fromPhone" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "callerName" TEXT,
    "providerCallSessionId" TEXT,
    "winningLegId" TEXT,
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedAt" TIMESTAMP(3),
    "firstRingAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "voicemailStartedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_call_leg" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "kind" "CallCenterLegKind" NOT NULL,
    "endpointId" TEXT,
    "agentSessionId" TEXT,
    "providerCallControlId" TEXT,
    "providerCallLegId" TEXT,
    "providerCallSessionId" TEXT,
    "status" "CallCenterLegStatus" NOT NULL DEFAULT 'CREATED',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "bridgedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "hangupCauseCode" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_call_leg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_task" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "callId" TEXT,
    "sourceEventRevision" BIGINT NOT NULL,
    "callerPhone" TEXT,
    "kind" "CallCenterTaskKind" NOT NULL,
    "status" "CallCenterTaskStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToUserId" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_webhook_event" (
    "id" TEXT NOT NULL,
    "provider" "CallCenterProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStatus" "ProviderWebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_command" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "legId" TEXT,
    "type" "CallCenterCommandType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "CallCenterCommandStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "arguments" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_center_command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_center_event" (
    "revision" BIGSERIAL NOT NULL,
    "practiceId" TEXT NOT NULL,
    "aggregateType" "CallCenterEventAggregateType" NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "idempotencyKey" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_center_event_pkey" PRIMARY KEY ("revision")
);

-- CreateIndex
CREATE INDEX "call_center_queue_practiceId_enabled_idx" ON "call_center_queue"("practiceId", "enabled");

-- CreateIndex
CREATE INDEX "call_center_queue_overflowQueueId_idx" ON "call_center_queue"("overflowQueueId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_queue_practiceId_name_key" ON "call_center_queue"("practiceId", "name");

-- CreateIndex
CREATE INDEX "call_center_queue_location_locationId_idx" ON "call_center_queue_location"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_number_practicePhoneNumberId_key" ON "call_center_number"("practicePhoneNumberId");

-- CreateIndex
CREATE INDEX "call_center_number_practiceId_enabled_idx" ON "call_center_number"("practiceId", "enabled");

-- CreateIndex
CREATE INDEX "call_center_number_inboundQueueId_inboundEnabled_enabled_idx" ON "call_center_number"("inboundQueueId", "inboundEnabled", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_number_providerNumberId_key" ON "call_center_number"("providerNumberId");

-- CreateIndex
CREATE INDEX "call_center_queue_member_queueId_role_enabled_idx" ON "call_center_queue_member"("queueId", "role", "enabled");

-- CreateIndex
CREATE INDEX "call_center_queue_member_userId_enabled_idx" ON "call_center_queue_member"("userId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_queue_member_queueId_userId_key" ON "call_center_queue_member"("queueId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_endpoint_providerCredentialId_key" ON "call_center_endpoint"("providerCredentialId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_endpoint_sipUsername_key" ON "call_center_endpoint"("sipUsername");

-- CreateIndex
CREATE INDEX "call_center_endpoint_practiceId_enabled_idx" ON "call_center_endpoint"("practiceId", "enabled");

-- CreateIndex
CREATE INDEX "call_center_endpoint_practiceId_locationId_enabled_idx" ON "call_center_endpoint"("practiceId", "locationId", "enabled");

-- CreateIndex
CREATE INDEX "call_center_endpoint_locationId_idx" ON "call_center_endpoint"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_endpoint_practiceId_label_key" ON "call_center_endpoint"("practiceId", "label");

-- CreateIndex
CREATE INDEX "call_center_agent_session_practiceId_userId_presence_idx" ON "call_center_agent_session"("practiceId", "userId", "presence");

-- CreateIndex
CREATE INDEX "call_center_agent_session_practiceId_presence_connectionSta_idx" ON "call_center_agent_session"("practiceId", "presence", "connectionState", "lastHeartbeatAt", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "call_center_agent_session_userId_idx" ON "call_center_agent_session"("userId");

-- CreateIndex
CREATE INDEX "call_center_agent_session_currentCallId_idx" ON "call_center_agent_session"("currentCallId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_agent_session_endpointId_browserSessionId_key" ON "call_center_agent_session"("endpointId", "browserSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_call_providerCallSessionId_key" ON "call_center_call"("providerCallSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_call_winningLegId_key" ON "call_center_call"("winningLegId");

-- CreateIndex
CREATE INDEX "call_center_call_practiceId_status_receivedAt_idx" ON "call_center_call"("practiceId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "call_center_call_practiceId_queueId_status_receivedAt_idx" ON "call_center_call"("practiceId", "queueId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "call_center_call_numberId_idx" ON "call_center_call"("numberId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_call_leg_providerCallControlId_key" ON "call_center_call_leg"("providerCallControlId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_call_leg_providerCallLegId_key" ON "call_center_call_leg"("providerCallLegId");

-- CreateIndex
CREATE INDEX "call_center_call_leg_callId_status_idx" ON "call_center_call_leg"("callId", "status");

-- CreateIndex
CREATE INDEX "call_center_call_leg_endpointId_status_idx" ON "call_center_call_leg"("endpointId", "status");

-- CreateIndex
CREATE INDEX "call_center_call_leg_agentSessionId_idx" ON "call_center_call_leg"("agentSessionId");

-- CreateIndex
CREATE INDEX "call_center_call_leg_providerCallSessionId_idx" ON "call_center_call_leg"("providerCallSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_session_telnyxCallLegId_key" ON "call_center_session"("telnyxCallLegId");

-- CreateIndex
CREATE INDEX "call_center_task_practiceId_status_createdAt_idx" ON "call_center_task"("practiceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "call_center_task_callId_idx" ON "call_center_task"("callId");

-- CreateIndex
CREATE INDEX "call_center_task_sourceEventRevision_idx" ON "call_center_task"("sourceEventRevision");

-- CreateIndex
CREATE INDEX "call_center_task_assignedToUserId_status_idx" ON "call_center_task"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "call_center_task_resolvedByUserId_idx" ON "call_center_task"("resolvedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_task_practiceId_dedupeKey_key" ON "call_center_task"("practiceId", "dedupeKey");

-- CreateIndex
CREATE INDEX "provider_webhook_event_processingStatus_nextAttemptAt_recei_idx" ON "provider_webhook_event"("processingStatus", "nextAttemptAt", "receivedAt");

-- CreateIndex
CREATE INDEX "provider_webhook_event_provider_eventType_receivedAt_idx" ON "provider_webhook_event"("provider", "eventType", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_webhook_event_provider_providerEventId_key" ON "provider_webhook_event"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "call_center_command_status_nextAttemptAt_createdAt_idx" ON "call_center_command"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "call_center_command_practiceId_callId_idx" ON "call_center_command"("practiceId", "callId");

-- CreateIndex
CREATE INDEX "call_center_command_legId_idx" ON "call_center_command"("legId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_command_practiceId_type_idempotencyKey_key" ON "call_center_command"("practiceId", "type", "idempotencyKey");

-- CreateIndex
CREATE INDEX "call_center_event_practiceId_revision_idx" ON "call_center_event"("practiceId", "revision");

-- CreateIndex
CREATE INDEX "call_center_event_practiceId_aggregateType_aggregateId_revi_idx" ON "call_center_event"("practiceId", "aggregateType", "aggregateId", "revision");

-- CreateIndex
CREATE INDEX "call_center_event_actorUserId_idx" ON "call_center_event"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_event_practiceId_type_idempotencyKey_key" ON "call_center_event"("practiceId", "type", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "practice_call_center_settings_defaultOutboundNumberId_key" ON "practice_call_center_settings"("defaultOutboundNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "call_center_voicemail_callCenterCallId_key" ON "call_center_voicemail"("callCenterCallId");

-- AddForeignKey
ALTER TABLE "practice_call_center_settings" ADD CONSTRAINT "practice_call_center_settings_defaultOutboundNumberId_fkey" FOREIGN KEY ("defaultOutboundNumberId") REFERENCES "call_center_number"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_queue" ADD CONSTRAINT "call_center_queue_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_queue" ADD CONSTRAINT "call_center_queue_overflowQueueId_fkey" FOREIGN KEY ("overflowQueueId") REFERENCES "call_center_queue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_queue_location" ADD CONSTRAINT "call_center_queue_location_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "call_center_queue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_queue_location" ADD CONSTRAINT "call_center_queue_location_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "practice_location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_number" ADD CONSTRAINT "call_center_number_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_number" ADD CONSTRAINT "call_center_number_practicePhoneNumberId_fkey" FOREIGN KEY ("practicePhoneNumberId") REFERENCES "practice_phone_number"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_number" ADD CONSTRAINT "call_center_number_inboundQueueId_fkey" FOREIGN KEY ("inboundQueueId") REFERENCES "call_center_queue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_queue_member" ADD CONSTRAINT "call_center_queue_member_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "call_center_queue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_queue_member" ADD CONSTRAINT "call_center_queue_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_endpoint" ADD CONSTRAINT "call_center_endpoint_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_endpoint" ADD CONSTRAINT "call_center_endpoint_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "practice_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_agent_session" ADD CONSTRAINT "call_center_agent_session_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_agent_session" ADD CONSTRAINT "call_center_agent_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_agent_session" ADD CONSTRAINT "call_center_agent_session_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "call_center_endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_agent_session" ADD CONSTRAINT "call_center_agent_session_currentCallId_fkey" FOREIGN KEY ("currentCallId") REFERENCES "call_center_call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_call" ADD CONSTRAINT "call_center_call_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_call" ADD CONSTRAINT "call_center_call_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "call_center_queue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_call" ADD CONSTRAINT "call_center_call_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "call_center_number"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_call" ADD CONSTRAINT "call_center_call_winningLegId_fkey" FOREIGN KEY ("winningLegId") REFERENCES "call_center_call_leg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_call_leg" ADD CONSTRAINT "call_center_call_leg_callId_fkey" FOREIGN KEY ("callId") REFERENCES "call_center_call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_call_leg" ADD CONSTRAINT "call_center_call_leg_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "call_center_endpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_call_leg" ADD CONSTRAINT "call_center_call_leg_agentSessionId_fkey" FOREIGN KEY ("agentSessionId") REFERENCES "call_center_agent_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_task" ADD CONSTRAINT "call_center_task_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_task" ADD CONSTRAINT "call_center_task_callId_fkey" FOREIGN KEY ("callId") REFERENCES "call_center_call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_task" ADD CONSTRAINT "call_center_task_sourceEventRevision_fkey" FOREIGN KEY ("sourceEventRevision") REFERENCES "call_center_event"("revision") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_task" ADD CONSTRAINT "call_center_task_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_task" ADD CONSTRAINT "call_center_task_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_command" ADD CONSTRAINT "call_center_command_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_command" ADD CONSTRAINT "call_center_command_callId_fkey" FOREIGN KEY ("callId") REFERENCES "call_center_call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_command" ADD CONSTRAINT "call_center_command_legId_fkey" FOREIGN KEY ("legId") REFERENCES "call_center_call_leg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_event" ADD CONSTRAINT "call_center_event_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_event" ADD CONSTRAINT "call_center_event_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_center_voicemail" ADD CONSTRAINT "call_center_voicemail_callCenterCallId_fkey" FOREIGN KEY ("callCenterCallId") REFERENCES "call_center_call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain invariants Prisma cannot represent.
ALTER TABLE "call_center_queue"
ADD CONSTRAINT "call_center_queue_timeout_bounds_check"
CHECK (
  "ringTimeoutSec" > 0
  AND "ringTimeoutSec" <= 300
  AND "maxWaitSec" >= "ringTimeoutSec"
  AND "maxWaitSec" <= 1800
  AND "wrapUpSec" >= 0
  AND "wrapUpSec" <= 1800
);

ALTER TABLE "call_center_number"
ADD CONSTRAINT "call_center_number_inbound_route_check"
CHECK (
  NOT "inboundEnabled"
  OR ("enabled" AND "inboundQueueId" IS NOT NULL)
);

ALTER TABLE "call_center_endpoint"
ADD CONSTRAINT "call_center_endpoint_enabled_config_check"
CHECK (
  NOT "enabled"
  OR ("providerCredentialId" IS NOT NULL AND "sipUsername" IS NOT NULL)
);

ALTER TABLE "call_center_agent_session"
ADD CONSTRAINT "call_center_agent_session_available_check"
CHECK (
  "presence" <> 'AVAILABLE'
  OR (
    "connectionState" = 'READY'
    AND "microphoneReady"
    AND "audioReady"
    AND "currentCallId" IS NULL
  )
);

ALTER TABLE "call_center_call"
ADD CONSTRAINT "call_center_call_state_version_check"
CHECK ("stateVersion" >= 0);

ALTER TABLE "call_center_call_leg"
ADD CONSTRAINT "call_center_call_leg_attempt_number_check"
CHECK ("attemptNumber" > 0);

ALTER TABLE "call_center_task"
ADD CONSTRAINT "call_center_task_source_check"
CHECK (
  ("callId" IS NOT NULL AND "callerPhone" IS NULL)
  OR ("callId" IS NULL AND "callerPhone" IS NOT NULL)
);

ALTER TABLE "provider_webhook_event"
ADD CONSTRAINT "provider_webhook_event_attempt_count_check"
CHECK ("attemptCount" >= 0);

ALTER TABLE "call_center_command"
ADD CONSTRAINT "call_center_command_attempt_count_check"
CHECK ("attemptCount" >= 0);

-- Prisma cannot express partial indexes. Expired leases must be closed before a
-- replacement session is acquired; the recovery lane owns that cleanup.
CREATE UNIQUE INDEX "call_center_agent_session_active_endpoint_key"
ON "call_center_agent_session"("endpointId")
WHERE "presence" <> 'OFFLINE' AND "connectionState" <> 'CLOSED';
