CREATE TYPE "AgentCallEvaluationBucket" AS ENUM ('GOLDEN', 'BAD');

CREATE TABLE "agent_call_evaluation_label" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "bucket" "AgentCallEvaluationBucket" NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_call_evaluation_label_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_call_evaluation_label_callId_bucket_key" ON "agent_call_evaluation_label"("callId", "bucket");
CREATE INDEX "agent_call_evaluation_label_practiceId_bucket_idx" ON "agent_call_evaluation_label"("practiceId", "bucket");
CREATE INDEX "agent_call_evaluation_label_callId_idx" ON "agent_call_evaluation_label"("callId");

ALTER TABLE "agent_call_evaluation_label"
ADD CONSTRAINT "agent_call_evaluation_label_callId_fkey"
FOREIGN KEY ("callId") REFERENCES "agent_call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_call_evaluation_label"
ADD CONSTRAINT "agent_call_evaluation_label_practiceId_fkey"
FOREIGN KEY ("practiceId") REFERENCES "practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
