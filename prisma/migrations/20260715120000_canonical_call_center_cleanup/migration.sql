-- Every historical call needs a canonical number owner. Import practice phone
-- numbers that predate the canonical configuration without enabling routing.
INSERT INTO "call_center_number" (
  "id", "practiceId", "practicePhoneNumberId", "inboundEnabled",
  "outboundEnabled", "enabled", "createdAt", "updatedAt"
)
SELECT
  'legacy-number-' || md5(phone."id"),
  phone."practiceId",
  phone."id",
  false,
  false,
  true,
  phone."createdAt",
  CURRENT_TIMESTAMP
FROM "practice_phone_number" phone
WHERE EXISTS (
  SELECT 1 FROM "call_center_session" session
  WHERE session."practiceId" = phone."practiceId"
)
ON CONFLICT ("practicePhoneNumberId") DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "call_center_session" session
    WHERE NOT EXISTS (
      SELECT 1 FROM "call_center_number" number
      WHERE number."practiceId" = session."practiceId"
    )
  ) THEN
    RAISE EXCEPTION 'Canonical cleanup cannot map a legacy practice without a phone number';
  END IF;
END $$;

CREATE TEMP TABLE "_legacy_session_call_map" AS
SELECT
  session."id" AS "sessionId",
  COALESCE(
    existing."id",
    'legacy-call-' || md5(
      session."practiceId" || ':' || COALESCE(
        NULLIF(session."telnyxCallSessionId", ''),
        'session:' || session."id"
      )
    )
  ) AS "callId",
  number."id" AS "numberId",
  number."inboundQueueId" AS "queueId"
FROM "call_center_session" session
LEFT JOIN LATERAL (
  SELECT call."id"
  FROM "call_center_call" call
  WHERE NULLIF(session."telnyxCallSessionId", '') IS NOT NULL
    AND call."providerCallSessionId" = session."telnyxCallSessionId"
  LIMIT 1
) existing ON true
JOIN LATERAL (
  SELECT candidate."id", candidate."inboundQueueId"
  FROM "call_center_number" candidate
  JOIN "practice_phone_number" phone
    ON phone."id" = candidate."practicePhoneNumberId"
  WHERE candidate."practiceId" = session."practiceId"
  ORDER BY
    CASE WHEN regexp_replace(phone."phoneNumber", '\D', '', 'g') = regexp_replace(
      CASE WHEN session."direction" = 'OUTBOUND'
        THEN COALESCE(session."fromPhone", '')
        ELSE COALESCE(session."toPhone", '')
      END,
      '\D', '', 'g'
    ) THEN 0 ELSE 1 END,
    CASE WHEN phone."locationId" = session."locationId" THEN 0 ELSE 1 END,
    CASE WHEN phone."isPrimary" THEN 0 ELSE 1 END,
    candidate."id"
  LIMIT 1
) number ON true;

CREATE UNIQUE INDEX "_legacy_session_call_map_session_key"
ON "_legacy_session_call_map"("sessionId");

-- Multiple legacy rows often represented the customer and browser legs of one
-- provider session. Import one call per provider session, not one per leg.
WITH ranked AS (
  SELECT
    map."callId",
    map."numberId",
    map."queueId",
    session.*,
    ROW_NUMBER() OVER (
      PARTITION BY map."callId"
      ORDER BY
        CASE session."direction"
          WHEN 'INBOUND' THEN 0 WHEN 'OUTBOUND' THEN 1 ELSE 2
        END,
        session."startedAt",
        session."id"
    ) AS rank,
    MIN(session."startedAt") OVER (PARTITION BY map."callId") AS first_seen,
    MAX(session."answeredAt") OVER (PARTITION BY map."callId") AS answered,
    MAX(COALESCE(session."endedAt", session."updatedAt"))
      OVER (PARTITION BY map."callId") AS last_seen
  FROM "call_center_session" session
  JOIN "_legacy_session_call_map" map ON map."sessionId" = session."id"
)
INSERT INTO "call_center_call" (
  "id", "practiceId", "queueId", "numberId", "direction", "effectOwner",
  "status", "fromPhone", "toPhone", "callerName", "providerCallSessionId",
  "stateVersion", "receivedAt", "answeredAt", "endedAt", "createdAt", "updatedAt"
)
SELECT
  ranked."callId",
  ranked."practiceId",
  CASE WHEN ranked."direction" = 'OUTBOUND' THEN NULL ELSE ranked."queueId" END,
  ranked."numberId",
  CASE WHEN ranked."direction" = 'OUTBOUND'
    THEN 'OUTBOUND'::"CallCenterCallDirection"
    ELSE 'INBOUND'::"CallCenterCallDirection"
  END,
  'CANONICAL'::"CallCenterEffectOwner",
  CASE ranked."status"
    WHEN 'COMPLETED' THEN 'COMPLETED'::"CallCenterCallStatus"
    WHEN 'ACTIVE' THEN 'COMPLETED'::"CallCenterCallStatus"
    WHEN 'VOICEMAIL' THEN 'VOICEMAIL'::"CallCenterCallStatus"
    WHEN 'MISSED' THEN 'ABANDONED'::"CallCenterCallStatus"
    WHEN 'FAILED' THEN 'FAILED'::"CallCenterCallStatus"
    ELSE 'ABANDONED'::"CallCenterCallStatus"
  END,
  COALESCE(ranked."fromPhone", 'unknown'),
  COALESCE(ranked."toPhone", 'unknown'),
  ranked."callerName",
  CASE
    WHEN NULLIF(ranked."telnyxCallSessionId", '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "call_center_call" existing
        WHERE existing."providerCallSessionId" = ranked."telnyxCallSessionId"
      )
    THEN ranked."telnyxCallSessionId"
    ELSE NULL
  END,
  0,
  ranked.first_seen,
  ranked.answered,
  ranked.last_seen,
  ranked.first_seen,
  ranked.last_seen
FROM ranked
WHERE ranked.rank = 1
ON CONFLICT ("id") DO NOTHING;

-- Give duplicate voicemail recordings their own historical call so no audio is
-- discarded while keeping the canonical one-voicemail-per-call invariant.
CREATE TEMP TABLE "_legacy_voicemail_call_map" AS
WITH mapped AS (
  SELECT
    voicemail."id" AS "voicemailId",
    COALESCE(voicemail."callCenterCallId", session_map."callId") AS "baseCallId",
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(voicemail."callCenterCallId", session_map."callId")
      ORDER BY voicemail."createdAt", voicemail."id"
    ) AS rank
  FROM "call_center_voicemail" voicemail
  LEFT JOIN "_legacy_session_call_map" session_map
    ON session_map."sessionId" = voicemail."sessionId"
)
SELECT
  "voicemailId",
  CASE WHEN rank = 1 THEN "baseCallId"
    ELSE 'legacy-voicemail-call-' || md5("voicemailId")
  END AS "callId",
  "baseCallId",
  rank
FROM mapped;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "_legacy_voicemail_call_map" WHERE "baseCallId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Canonical cleanup could not map every voicemail';
  END IF;
END $$;

INSERT INTO "call_center_call" (
  "id", "practiceId", "queueId", "numberId", "direction", "effectOwner",
  "status", "fromPhone", "toPhone", "callerName", "stateVersion",
  "receivedAt", "voicemailStartedAt", "endedAt", "createdAt", "updatedAt"
)
SELECT
  mapping."callId",
  source."practiceId",
  source."queueId",
  source."numberId",
  'INBOUND'::"CallCenterCallDirection",
  'CANONICAL'::"CallCenterEffectOwner",
  'VOICEMAIL'::"CallCenterCallStatus",
  voicemail."fromPhone",
  source."toPhone",
  voicemail."callerName",
  0,
  voicemail."createdAt",
  voicemail."createdAt",
  voicemail."createdAt",
  voicemail."createdAt",
  voicemail."updatedAt"
FROM "_legacy_voicemail_call_map" mapping
JOIN "call_center_voicemail" voicemail ON voicemail."id" = mapping."voicemailId"
JOIN "call_center_call" source ON source."id" = mapping."baseCallId"
WHERE mapping.rank > 1
ON CONFLICT ("id") DO NOTHING;

UPDATE "call_center_voicemail" voicemail
SET "callCenterCallId" = mapping."callId"
FROM "_legacy_voicemail_call_map" mapping
WHERE mapping."voicemailId" = voicemail."id";

-- Every imported activity gets a canonical event and task. These stable keys
-- make the data migration safe to retry.
INSERT INTO "call_center_event" (
  "practiceId", "aggregateType", "aggregateId", "type", "occurredAt",
  "idempotencyKey", "data", "createdAt"
)
SELECT
  missed."practiceId", 'TASK'::"CallCenterEventAggregateType",
  'legacy-missed-' || md5(missed."id"), 'TASK_IMPORTED', missed."createdAt",
  'legacy-missed:' || missed."id",
  jsonb_build_object('legacyMissedCallId', missed."id"), missed."createdAt"
FROM "call_center_missed_call" missed
ON CONFLICT ("practiceId", "type", "idempotencyKey") DO NOTHING;

INSERT INTO "call_center_task" (
  "id", "practiceId", "callId", "sourceEventRevision", "kind",
  "status", "resolvedAt", "dedupeKey", "createdAt", "updatedAt"
)
SELECT
  'legacy-missed-' || md5(missed."id"), missed."practiceId", map."callId",
  event."revision", 'MISSED_CALL'::"CallCenterTaskKind",
  CASE WHEN missed."calledBack" OR missed."resolvedAt" IS NOT NULL
    THEN 'RESOLVED'::"CallCenterTaskStatus" ELSE 'OPEN'::"CallCenterTaskStatus" END,
  missed."resolvedAt", 'legacy-missed:' || missed."id",
  missed."createdAt", missed."updatedAt"
FROM "call_center_missed_call" missed
JOIN "_legacy_session_call_map" map ON map."sessionId" = missed."sessionId"
JOIN "call_center_event" event
  ON event."practiceId" = missed."practiceId"
  AND event."type" = 'TASK_IMPORTED'
  AND event."idempotencyKey" = 'legacy-missed:' || missed."id"
ON CONFLICT ("practiceId", "dedupeKey") DO NOTHING;

INSERT INTO "call_center_event" (
  "practiceId", "aggregateType", "aggregateId", "type", "occurredAt",
  "idempotencyKey", "data", "createdAt"
)
SELECT
  source."practiceId", 'TASK'::"CallCenterEventAggregateType",
  'legacy-voicemail-' || md5(voicemail."id"), 'TASK_IMPORTED', voicemail."createdAt",
  'legacy-voicemail:' || voicemail."id",
  jsonb_build_object('legacyVoicemailId', voicemail."id"), voicemail."createdAt"
FROM "call_center_voicemail" voicemail
JOIN "call_center_call" source ON source."id" = voicemail."callCenterCallId"
ON CONFLICT ("practiceId", "type", "idempotencyKey") DO NOTHING;

INSERT INTO "call_center_task" (
  "id", "practiceId", "callId", "sourceEventRevision", "kind",
  "status", "resolvedAt", "dedupeKey", "createdAt", "updatedAt"
)
SELECT
  'legacy-voicemail-' || md5(voicemail."id"), source."practiceId",
  voicemail."callCenterCallId", event."revision",
  'VOICEMAIL'::"CallCenterTaskKind",
  CASE WHEN voicemail."resolvedAt" IS NOT NULL
    THEN 'RESOLVED'::"CallCenterTaskStatus" ELSE 'OPEN'::"CallCenterTaskStatus" END,
  voicemail."resolvedAt", 'legacy-voicemail:' || voicemail."id",
  voicemail."createdAt", voicemail."updatedAt"
FROM "call_center_voicemail" voicemail
JOIN "call_center_call" source ON source."id" = voicemail."callCenterCallId"
JOIN "call_center_event" event
  ON event."practiceId" = source."practiceId"
  AND event."type" = 'TASK_IMPORTED'
  AND event."idempotencyKey" = 'legacy-voicemail:' || voicemail."id"
ON CONFLICT ("practiceId", "dedupeKey") DO NOTHING;

CREATE TEMP TABLE "_legacy_note_call_map" AS
SELECT
  note."id" AS "noteId",
  COALESCE(
    direct."callId",
    missed_map."callId",
    voicemail."callCenterCallId",
    recent."id"
  ) AS "callId"
FROM "call_center_note" note
LEFT JOIN "_legacy_session_call_map" direct ON direct."sessionId" = note."sessionId"
LEFT JOIN "call_center_missed_call" missed ON missed."id" = note."missedCallId"
LEFT JOIN "_legacy_session_call_map" missed_map
  ON missed_map."sessionId" = missed."sessionId"
LEFT JOIN "call_center_voicemail" voicemail ON voicemail."id" = note."voicemailId"
LEFT JOIN LATERAL (
  SELECT call."id"
  FROM "call_center_call" call
  WHERE call."practiceId" = note."practiceId"
    AND (call."fromPhone" = note."fromPhone" OR call."toPhone" = note."fromPhone")
    AND call."receivedAt" <= note."createdAt"
  ORDER BY call."receivedAt" DESC
  LIMIT 1
) recent ON true;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "_legacy_note_call_map" WHERE "callId" IS NULL) THEN
    RAISE EXCEPTION 'Canonical cleanup could not map every legacy note';
  END IF;
END $$;

INSERT INTO "call_center_event" (
  "practiceId", "aggregateType", "aggregateId", "type", "occurredAt",
  "actorUserId", "idempotencyKey", "data", "createdAt"
)
SELECT
  note."practiceId", 'TASK'::"CallCenterEventAggregateType",
  'legacy-note-' || md5(note."id"), 'TASK_IMPORTED', note."createdAt",
  note."createdByUserId", 'legacy-note:' || note."id",
  jsonb_build_object('disposition', note."disposition", 'legacyNoteId', note."id"),
  note."createdAt"
FROM "call_center_note" note
ON CONFLICT ("practiceId", "type", "idempotencyKey") DO NOTHING;

INSERT INTO "call_center_task" (
  "id", "practiceId", "callId", "sourceEventRevision", "kind",
  "note", "status", "resolvedByUserId", "resolvedAt", "dedupeKey",
  "createdAt", "updatedAt"
)
SELECT
  'legacy-note-' || md5(note."id"), note."practiceId", map."callId",
  event."revision",
  CASE note."disposition"
    WHEN 'CALLBACK_NEEDED' THEN 'CALLBACK'::"CallCenterTaskKind"
    WHEN 'FOLLOW_UP_REQUIRED' THEN 'FOLLOW_UP'::"CallCenterTaskKind"
    ELSE 'NOTE'::"CallCenterTaskKind"
  END,
  note."body",
  CASE WHEN note."resolvedThread" OR note."disposition" IN ('RESOLVED', 'WRONG_NUMBER', 'OTHER')
    THEN 'RESOLVED'::"CallCenterTaskStatus" ELSE 'OPEN'::"CallCenterTaskStatus" END,
  CASE WHEN note."resolvedThread" THEN note."createdByUserId" ELSE NULL END,
  CASE WHEN note."resolvedThread" OR note."disposition" IN ('RESOLVED', 'WRONG_NUMBER', 'OTHER')
    THEN note."updatedAt" ELSE NULL END,
  'legacy-note:' || note."id", note."createdAt", note."updatedAt"
FROM "call_center_note" note
JOIN "_legacy_note_call_map" map ON map."noteId" = note."id"
JOIN "call_center_event" event
  ON event."practiceId" = note."practiceId"
  AND event."type" = 'TASK_IMPORTED'
  AND event."idempotencyKey" = 'legacy-note:' || note."id"
ON CONFLICT ("practiceId", "dedupeKey") DO NOTHING;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "call_center_missed_call") !=
     (SELECT COUNT(*) FROM "call_center_task" WHERE "dedupeKey" LIKE 'legacy-missed:%') THEN
    RAISE EXCEPTION 'Canonical cleanup did not preserve every missed call';
  END IF;
  IF (SELECT COUNT(*) FROM "call_center_voicemail") !=
     (SELECT COUNT(*) FROM "call_center_task" WHERE "dedupeKey" LIKE 'legacy-voicemail:%') THEN
    RAISE EXCEPTION 'Canonical cleanup did not preserve every voicemail';
  END IF;
  IF (SELECT COUNT(*) FROM "call_center_note") !=
     (SELECT COUNT(*) FROM "call_center_task" WHERE "dedupeKey" LIKE 'legacy-note:%') THEN
    RAISE EXCEPTION 'Canonical cleanup did not preserve every note';
  END IF;
END $$;

ALTER TABLE "call_center_task"
  DROP CONSTRAINT IF EXISTS "call_center_task_source_check";
ALTER TABLE "call_center_task" ALTER COLUMN "callId" SET NOT NULL;
ALTER TABLE "call_center_task" DROP COLUMN "callerPhone";

ALTER TABLE "call_center_voicemail"
  DROP CONSTRAINT IF EXISTS "call_center_voicemail_callCenterCallId_fkey";
ALTER TABLE "call_center_voicemail"
  ALTER COLUMN "callCenterCallId" SET NOT NULL;
ALTER TABLE "call_center_voicemail"
  ADD CONSTRAINT "call_center_voicemail_callCenterCallId_fkey"
  FOREIGN KEY ("callCenterCallId") REFERENCES "call_center_call"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "call_center_voicemail"
  DROP COLUMN "practiceId",
  DROP COLUMN "locationId",
  DROP COLUMN "sessionId",
  DROP COLUMN "missedCallId",
  DROP COLUMN "fromPhone",
  DROP COLUMN "callerName";

DROP TABLE "call_center_note";
DROP TABLE "call_center_ring_attempt";
DROP TABLE "call_center_presence";
DROP TABLE "call_center_queue_item";
DROP TABLE "call_center_missed_call";
DROP TABLE "call_center_session";
DROP TABLE "call_center_agent_seat";

-- A configured, enabled queue is canonical. There is no rollout mode to select.
ALTER TABLE "call_center_queue" DROP COLUMN "routingMode";

-- Configuration is live when its queue, number, membership, and endpoint rows
-- are enabled. Retire the second practice-level switch and unused legacy fields.
ALTER TABLE "practice_call_center_settings"
  DROP COLUMN "enabled",
  DROP COLUMN "provider",
  DROP COLUMN "telnyxCredentialId",
  DROP COLUMN "inboundPhoneNumber",
  DROP COLUMN "outboundCallerNumber",
  DROP COLUMN "voicemailGreeting",
  DROP COLUMN "voicemailTimeoutSec",
  DROP COLUMN "recordingEnabled";

ALTER TABLE "call_center_call"
  ALTER COLUMN "effectOwner" SET DEFAULT 'CANONICAL';
ALTER TABLE "provider_webhook_event"
  ALTER COLUMN "effectOwner" SET DEFAULT 'CANONICAL';

DROP TYPE "CallCenterNoteDisposition";
DROP TYPE "CallCenterRingAttemptStatus";
DROP TYPE "CallCenterQueueStatus";
DROP TYPE "CallCenterPresenceStatus";
DROP TYPE "CallCenterSessionStatus";
DROP TYPE "CallCenterSessionDirection";
DROP TYPE "CallCenterRoutingMode";
