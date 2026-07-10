CREATE TYPE "AgentTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CLOSED_NO_ACTION');

CREATE TYPE "AgentTaskCategory" AS ENUM ('BILLING', 'APPOINTMENTS', 'DOCUMENTATION', 'OTHER');

CREATE TYPE "AgentTaskPriority" AS ENUM ('HIGH_PRIORITY', 'NORMAL', 'NON_URGENT');

CREATE TYPE "AgentTaskSource" AS ENUM ('AGENT');

CREATE TABLE "agent_task" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "locationId" TEXT,
    "agentCallId" TEXT,
    "callId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'OPEN',
    "category" "AgentTaskCategory" NOT NULL,
    "priority" "AgentTaskPriority" NOT NULL DEFAULT 'NORMAL',
    "officeKey" TEXT,
    "officePhone" TEXT NOT NULL,
    "inboundOfficePhone" TEXT,
    "summary" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "callerPhone" TEXT NOT NULL,
    "patientId" TEXT,
    "patientName" TEXT,
    "patientDob" TEXT,
    "source" "AgentTaskSource" NOT NULL DEFAULT 'AGENT',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "agent_task_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_task_practiceId_idempotencyKey_key" ON "agent_task"("practiceId", "idempotencyKey");
CREATE INDEX "agent_task_practiceId_status_category_createdAt_idx" ON "agent_task"("practiceId", "status", "category", "createdAt");
CREATE INDEX "agent_task_practiceId_locationId_status_createdAt_idx" ON "agent_task"("practiceId", "locationId", "status", "createdAt");
CREATE INDEX "agent_task_practiceId_status_priority_createdAt_idx" ON "agent_task"("practiceId", "status", "priority", "createdAt");
CREATE INDEX "agent_task_agentCallId_idx" ON "agent_task"("agentCallId");
CREATE INDEX "agent_task_callId_idx" ON "agent_task"("callId");

ALTER TABLE "agent_task"
ADD CONSTRAINT "agent_task_practiceId_fkey"
FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_task"
ADD CONSTRAINT "agent_task_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "practice_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_task"
ADD CONSTRAINT "agent_task_agentCallId_fkey"
FOREIGN KEY ("agentCallId") REFERENCES "agent_call"("id") ON DELETE SET NULL ON UPDATE CASCADE;
