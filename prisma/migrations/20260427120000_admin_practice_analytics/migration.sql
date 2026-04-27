-- CreateEnum
CREATE TYPE "PracticeAgentStatus" AS ENUM ('SETUP', 'ACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "AgentCallStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ESCALATED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "UsageCostCategory" AS ENUM (
    'LLM_INPUT',
    'LLM_CACHED_INPUT',
    'LLM_OUTPUT',
    'SPEECH_TO_TEXT',
    'TEXT_TO_SPEECH',
    'TELEPHONY',
    'REVIEW',
    'OTHER'
);

-- CreateTable
CREATE TABLE "practice_agent" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PracticeAgentStatus" NOT NULL DEFAULT 'SETUP',
    "llmModel" TEXT,
    "voiceProvider" TEXT,
    "voiceName" TEXT,
    "configVersion" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_phone_number" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_phone_number_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_call" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT,
    "agentId" TEXT,
    "callId" TEXT NOT NULL,
    "callerPhone" TEXT NOT NULL,
    "officePhone" TEXT NOT NULL,
    "status" "AgentCallStatus" NOT NULL DEFAULT 'COMPLETED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "transferred" BOOLEAN NOT NULL DEFAULT false,
    "bookedAppointment" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAppointment" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAppointment" BOOLEAN NOT NULL DEFAULT false,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" TEXT,
    "reviewAverageScore" DOUBLE PRECISION,
    "reviewResult" JSONB,
    "llmModel" TEXT,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "totalTurns" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "ttsChars" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "toolErrors" INTEGER NOT NULL DEFAULT 0,
    "avgTtft" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgTtsttfb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cacheHitRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "peakContext" INTEGER NOT NULL DEFAULT 0,
    "avgTokensPerSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interruptionCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostMicros" INTEGER NOT NULL DEFAULT 0,
    "outcomeSummary" TEXT,
    "latencyValues" JSONB NOT NULL DEFAULT '{}',
    "data" JSONB,
    "audioData" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_cost_line_item" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "agentCallId" TEXT,
    "category" "UsageCostCategory" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_cost_line_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_agent_practiceId_idx" ON "practice_agent"("practiceId");

-- CreateIndex
CREATE INDEX "practice_agent_status_idx" ON "practice_agent"("status");

-- CreateIndex
CREATE UNIQUE INDEX "practice_phone_number_phoneNumber_key" ON "practice_phone_number"("phoneNumber");

-- CreateIndex
CREATE INDEX "practice_phone_number_practiceId_idx" ON "practice_phone_number"("practiceId");

-- CreateIndex
CREATE INDEX "practice_phone_number_locationId_idx" ON "practice_phone_number"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_call_callId_key" ON "agent_call"("callId");

-- CreateIndex
CREATE INDEX "agent_call_practiceId_startedAt_idx" ON "agent_call"("practiceId", "startedAt");

-- CreateIndex
CREATE INDEX "agent_call_practiceId_needsReview_idx" ON "agent_call"("practiceId", "needsReview");

-- CreateIndex
CREATE INDEX "agent_call_practiceId_status_idx" ON "agent_call"("practiceId", "status");

-- CreateIndex
CREATE INDEX "agent_call_locationId_idx" ON "agent_call"("locationId");

-- CreateIndex
CREATE INDEX "agent_call_agentId_idx" ON "agent_call"("agentId");

-- CreateIndex
CREATE INDEX "agent_call_callerPhone_idx" ON "agent_call"("callerPhone");

-- CreateIndex
CREATE INDEX "agent_call_officePhone_idx" ON "agent_call"("officePhone");

-- CreateIndex
CREATE INDEX "usage_cost_line_item_practiceId_occurredAt_idx" ON "usage_cost_line_item"("practiceId", "occurredAt");

-- CreateIndex
CREATE INDEX "usage_cost_line_item_agentCallId_idx" ON "usage_cost_line_item"("agentCallId");

-- CreateIndex
CREATE INDEX "usage_cost_line_item_category_idx" ON "usage_cost_line_item"("category");

-- AddForeignKey
ALTER TABLE "practice_agent" ADD CONSTRAINT "practice_agent_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_phone_number" ADD CONSTRAINT "practice_phone_number_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "practice_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_phone_number" ADD CONSTRAINT "practice_phone_number_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_call" ADD CONSTRAINT "agent_call_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "practice_agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_call" ADD CONSTRAINT "agent_call_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "practice_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_call" ADD CONSTRAINT "agent_call_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_cost_line_item" ADD CONSTRAINT "usage_cost_line_item_agentCallId_fkey" FOREIGN KEY ("agentCallId") REFERENCES "agent_call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_cost_line_item" ADD CONSTRAINT "usage_cost_line_item_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
