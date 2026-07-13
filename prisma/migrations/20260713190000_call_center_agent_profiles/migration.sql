-- A provider endpoint is the durable calling profile for one authenticated
-- practice user. The nullable rollout keeps existing LEGACY configuration
-- readable until an administrator assigns each profile before activation.
ALTER TABLE "call_center_endpoint"
ADD COLUMN "userId" TEXT;

CREATE UNIQUE INDEX "call_center_endpoint_practiceId_userId_key"
ON "call_center_endpoint"("practiceId", "userId");

ALTER TABLE "call_center_endpoint"
ADD CONSTRAINT "call_center_endpoint_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
