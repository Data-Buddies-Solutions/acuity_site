DROP INDEX IF EXISTS "agent_call_practiceId_needsReview_idx";

ALTER TABLE "agent_call"
  DROP COLUMN IF EXISTS "needsReview",
  DROP COLUMN IF EXISTS "reviewStatus",
  DROP COLUMN IF EXISTS "reviewAverageScore",
  DROP COLUMN IF EXISTS "reviewResult";
