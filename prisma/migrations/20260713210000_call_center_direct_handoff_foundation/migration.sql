BEGIN;

CREATE TYPE "CallCenterHandoffStatus" AS ENUM (
  'ISSUED',
  'INGRESS_SEEN',
  'CONNECTED',
  'EXPIRED',
  'FAILED'
);

CREATE TABLE "call_center_handoff" (
  "id" TEXT NOT NULL,
  "practiceId" TEXT NOT NULL,
  "queueId" TEXT NOT NULL,
  "numberId" TEXT NOT NULL,
  "callId" TEXT,
  "sourceSystem" TEXT NOT NULL,
  "sourceCallId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "callerPhone" TEXT NOT NULL,
  "status" "CallCenterHandoffStatus" NOT NULL DEFAULT 'ISSUED',
  "providerCallSessionId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "ingressSeenAt" TIMESTAMP(3),
  "connectedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "call_center_handoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "call_center_handoff_callId_key"
ON "call_center_handoff"("callId");

CREATE UNIQUE INDEX "call_center_handoff_tokenHash_key"
ON "call_center_handoff"("tokenHash");

CREATE UNIQUE INDEX "call_center_handoff_providerCallSessionId_key"
ON "call_center_handoff"("providerCallSessionId");

CREATE UNIQUE INDEX "call_center_handoff_practiceId_sourceSystem_idempotencyKey_key"
ON "call_center_handoff"("practiceId", "sourceSystem", "idempotencyKey");

CREATE UNIQUE INDEX "call_center_handoff_practiceId_sourceSystem_sourceCallId_key"
ON "call_center_handoff"("practiceId", "sourceSystem", "sourceCallId");

CREATE INDEX "call_center_handoff_status_expiresAt_idx"
ON "call_center_handoff"("status", "expiresAt");

CREATE INDEX "call_center_handoff_queueId_idx"
ON "call_center_handoff"("queueId");

ALTER TABLE "call_center_handoff"
ADD CONSTRAINT "call_center_handoff_practiceId_fkey"
FOREIGN KEY ("practiceId") REFERENCES "practice"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_center_handoff"
ADD CONSTRAINT "call_center_handoff_queueId_fkey"
FOREIGN KEY ("queueId") REFERENCES "call_center_queue"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "call_center_handoff"
ADD CONSTRAINT "call_center_handoff_numberId_fkey"
FOREIGN KEY ("numberId") REFERENCES "call_center_number"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "call_center_handoff"
ADD CONSTRAINT "call_center_handoff_callId_fkey"
FOREIGN KEY ("callId") REFERENCES "call_center_call"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "call_center_handoff"
ADD CONSTRAINT "call_center_handoff_identity_check"
CHECK (
  BTRIM("sourceSystem") <> ''
  AND BTRIM("sourceCallId") <> ''
  AND BTRIM("idempotencyKey") <> ''
  AND BTRIM("requestFingerprint") <> ''
  AND BTRIM("tokenHash") <> ''
  AND "callerPhone" ~ '^\+[1-9][0-9]{7,14}$'
  AND ("failureCode" IS NULL OR BTRIM("failureCode") <> '')
);

ALTER TABLE "call_center_handoff"
ADD CONSTRAINT "call_center_handoff_expiry_check"
CHECK ("expiresAt" > "createdAt");

ALTER TABLE "call_center_handoff"
ADD CONSTRAINT "call_center_handoff_lifecycle_check"
CHECK (
  (
    "status" = 'ISSUED'
    AND "providerCallSessionId" IS NULL
    AND "ingressSeenAt" IS NULL
    AND "connectedAt" IS NULL
    AND "failedAt" IS NULL
    AND "failureCode" IS NULL
  )
  OR (
    "status" = 'INGRESS_SEEN'
    AND "providerCallSessionId" IS NOT NULL
    AND "ingressSeenAt" IS NOT NULL
    AND "connectedAt" IS NULL
    AND "failedAt" IS NULL
    AND "failureCode" IS NULL
  )
  OR (
    "status" = 'CONNECTED'
    AND "providerCallSessionId" IS NOT NULL
    AND "ingressSeenAt" IS NOT NULL
    AND "connectedAt" IS NOT NULL
    AND "connectedAt" >= "ingressSeenAt"
    AND "failedAt" IS NULL
    AND "failureCode" IS NULL
  )
  OR (
    "status" = 'EXPIRED'
    AND "connectedAt" IS NULL
    AND "failedAt" IS NOT NULL
    AND "failureCode" IS NOT NULL
    AND (
      ("providerCallSessionId" IS NULL AND "ingressSeenAt" IS NULL)
      OR ("providerCallSessionId" IS NOT NULL AND "ingressSeenAt" IS NOT NULL)
    )
  )
  OR (
    "status" = 'FAILED'
    AND "connectedAt" IS NULL
    AND "failedAt" IS NOT NULL
    AND "failureCode" IS NOT NULL
    AND (
      ("providerCallSessionId" IS NULL AND "ingressSeenAt" IS NULL)
      OR ("providerCallSessionId" IS NOT NULL AND "ingressSeenAt" IS NOT NULL)
    )
  )
);

COMMIT;
