ALTER TABLE "call_center_call"
ADD COLUMN "deadlineAt" TIMESTAMP(3),
ADD COLUMN "queueDeadlineAt" TIMESTAMP(3);

ALTER TABLE "call_center_command"
ADD COLUMN "dependsOnCommandId" TEXT;

CREATE INDEX "call_center_command_dependsOnCommandId_idx"
ON "call_center_command"("dependsOnCommandId");

ALTER TABLE "call_center_command"
ADD CONSTRAINT "call_center_command_dependsOnCommandId_fkey"
FOREIGN KEY ("dependsOnCommandId") REFERENCES "call_center_command"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
