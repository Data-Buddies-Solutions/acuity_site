ALTER TABLE "call_center_call_leg"
ADD COLUMN "agentKey" TEXT;

WITH ranked_agent_legs AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "callId", "endpointId"
      ORDER BY "startedAt" ASC, "id" ASC
    ) AS rank
  FROM "call_center_call_leg"
  WHERE "kind" = 'AGENT'
    AND "endpointId" IS NOT NULL
)
UPDATE "call_center_call_leg" AS leg
SET "agentKey" = leg."callId" || ':' || leg."endpointId"
FROM ranked_agent_legs
WHERE leg."id" = ranked_agent_legs."id"
  AND ranked_agent_legs.rank = 1;

CREATE UNIQUE INDEX "call_center_call_leg_agentKey_key"
ON "call_center_call_leg"("agentKey");

WITH ranked_active_legs AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "endpointId"
      ORDER BY "bridgedAt" ASC NULLS LAST, "answeredAt" ASC NULLS LAST, "id" ASC
    ) AS rank
  FROM "call_center_call_leg"
  WHERE "endpointId" IS NOT NULL
    AND "kind" = 'AGENT'
    AND "status" IN ('ANSWERED', 'BRIDGED')
)
UPDATE "call_center_call_leg"
SET
  "endedAt" = COALESCE("endedAt", CURRENT_TIMESTAMP),
  "errorCode" = COALESCE("errorCode", 'AGENT_ALREADY_ACTIVE_MIGRATION'),
  "status" = 'ENDED'
WHERE "id" IN (
  SELECT "id"
  FROM ranked_active_legs
  WHERE rank > 1
);

CREATE UNIQUE INDEX "call_center_call_leg_one_active_agent_key"
ON "call_center_call_leg"("endpointId")
WHERE "endpointId" IS NOT NULL
  AND "kind" = 'AGENT'
  AND "status" IN ('ANSWERED', 'BRIDGED');

UPDATE "call_center_queue"
SET
  "ringTimeoutSec" = 20,
  "maxWaitSec" = 20,
  "overflowQueueId" = NULL,
  "wrapUpSec" = 0;

UPDATE "call_center_agent_session"
SET
  "currentCallId" = NULL,
  "offeredCallId" = NULL,
  "presence" = CASE
    WHEN "connectionState" = 'READY'
      AND "microphoneReady" = TRUE
      AND "audioReady" = TRUE
      AND "leaseExpiresAt" > CURRENT_TIMESTAMP
    THEN 'AVAILABLE'::"CallCenterAgentPresence"
    ELSE 'PAUSED'::"CallCenterAgentPresence"
  END,
  "readyAt" = CASE
    WHEN "connectionState" = 'READY'
      AND "microphoneReady" = TRUE
      AND "audioReady" = TRUE
      AND "leaseExpiresAt" > CURRENT_TIMESTAMP
    THEN COALESCE("readyAt", CURRENT_TIMESTAMP)
    ELSE NULL
  END;

UPDATE "call_center_call"
SET
  "deadlineAt" = LEAST(
    COALESCE("deadlineAt", "receivedAt" + INTERVAL '20 seconds'),
    "receivedAt" + INTERVAL '20 seconds'
  ),
  "queueDeadlineAt" = LEAST(
    COALESCE("queueDeadlineAt", "receivedAt" + INTERVAL '20 seconds'),
    "receivedAt" + INTERVAL '20 seconds'
  )
WHERE "direction" = 'INBOUND'
  AND "winningLegId" IS NULL
  AND "status" IN ('RECEIVED', 'QUEUED', 'RINGING');
