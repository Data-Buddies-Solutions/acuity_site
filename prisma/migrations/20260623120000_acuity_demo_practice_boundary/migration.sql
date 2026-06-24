-- Isolate synthetic demo traffic from Abita Eye Group production analytics.

INSERT INTO "practice" (
    "id",
    "name",
    "onboardingStatus",
    "practiceType",
    "launchedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    'practice_acuity_demo',
    'Acuity Demo',
    'LIVE',
    'OPHTHALMOLOGY',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "practice" WHERE "name" = 'Acuity Demo'
);

UPDATE "practice"
SET
    "onboardingStatus" = 'LIVE',
    "practiceType" = 'OPHTHALMOLOGY',
    "launchedAt" = COALESCE("launchedAt", CURRENT_TIMESTAMP),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Acuity Demo';

CREATE TEMP TABLE "_acuity_demo_practice" AS
SELECT "id"
FROM "practice"
WHERE "name" = 'Acuity Demo'
ORDER BY "createdAt" ASC
LIMIT 1;

CREATE TEMP TABLE "_abita_practice" AS
SELECT "id"
FROM "practice"
WHERE "name" = 'Abita Eye Group'
ORDER BY "createdAt" ASC
LIMIT 1;

CREATE TEMP TABLE "_acuity_demo_location_source" AS
SELECT DISTINCT pl."id" AS "locationId"
FROM "practice_location" pl
JOIN "_abita_practice" ap ON ap."id" = pl."practiceId"
WHERE pl."name" = 'Demo'
UNION
SELECT DISTINCT ppn."locationId" AS "locationId"
FROM "practice_phone_number" ppn
JOIN "_abita_practice" ap ON ap."id" = ppn."practiceId"
WHERE ppn."label" = 'Demo'
  AND ppn."locationId" IS NOT NULL;

CREATE TEMP TABLE "_acuity_demo_phone_source" AS
SELECT DISTINCT
    ppn."id" AS "phoneNumberId",
    ppn."phoneNumber" AS "phoneNumber",
    ppn."locationId" AS "locationId"
FROM "practice_phone_number" ppn
JOIN "_abita_practice" ap ON ap."id" = ppn."practiceId"
LEFT JOIN "practice_location" pl ON pl."id" = ppn."locationId"
WHERE ppn."label" = 'Demo'
   OR pl."name" = 'Demo'
   OR ppn."locationId" IN (
       SELECT "locationId" FROM "_acuity_demo_location_source"
   );

CREATE TEMP TABLE "_acuity_demo_phone_variant" AS
WITH base AS (
    SELECT
        "phoneNumber",
        regexp_replace("phoneNumber", '\D', '', 'g') AS "digits"
    FROM "_acuity_demo_phone_source"
    WHERE COALESCE("phoneNumber", '') <> ''
)
SELECT "phoneNumber" AS "phoneNumber"
FROM base
UNION
SELECT "digits" AS "phoneNumber"
FROM base
WHERE "digits" <> ''
UNION
SELECT '+' || "digits" AS "phoneNumber"
FROM base
WHERE "digits" <> ''
UNION
SELECT '+1' || "digits" AS "phoneNumber"
FROM base
WHERE length("digits") = 10
UNION
SELECT '1' || "digits" AS "phoneNumber"
FROM base
WHERE length("digits") = 10
UNION
SELECT substring("digits" FROM 2) AS "phoneNumber"
FROM base
WHERE length("digits") = 11
  AND left("digits", 1) = '1';

UPDATE "practice_location" pl
SET
    "practiceId" = dp."id",
    "isPrimary" = true,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp,
     "_acuity_demo_location_source" dls
WHERE pl."id" = dls."locationId";

INSERT INTO "practice_location" (
    "id",
    "practiceId",
    "name",
    "phone",
    "isPrimary",
    "createdAt",
    "updatedAt"
)
SELECT
    'practice_location_acuity_demo',
    dp."id",
    'Demo',
    (
        SELECT "phoneNumber"
        FROM "_acuity_demo_phone_source"
        ORDER BY "phoneNumberId" ASC
        LIMIT 1
    ),
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp
WHERE NOT EXISTS (
    SELECT 1
    FROM "practice_location" pl
    WHERE pl."practiceId" = dp."id"
      AND pl."name" = 'Demo'
);

CREATE TEMP TABLE "_acuity_demo_location" AS
SELECT pl."id" AS "locationId"
FROM "practice_location" pl
JOIN "_acuity_demo_practice" dp ON dp."id" = pl."practiceId"
WHERE pl."name" = 'Demo';

UPDATE "practice_phone_number" ppn
SET
    "practiceId" = dp."id",
    "locationId" = COALESCE(
        CASE
            WHEN ppn."locationId" IN (
                SELECT "locationId" FROM "_acuity_demo_location"
            )
            THEN ppn."locationId"
        END,
        (
            SELECT "locationId"
            FROM "_acuity_demo_location"
            ORDER BY "locationId" ASC
            LIMIT 1
        ),
        ppn."locationId"
    ),
    "label" = 'Demo',
    "isPrimary" = true,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp,
     "_acuity_demo_phone_source" dps
WHERE ppn."id" = dps."phoneNumberId";

INSERT INTO "practice_agent" (
    "id",
    "practiceId",
    "name",
    "status",
    "createdAt",
    "updatedAt"
)
SELECT
    'practice_agent_acuity_demo',
    dp."id",
    'Acuity Demo Voice Agent',
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp
WHERE NOT EXISTS (
    SELECT 1
    FROM "practice_agent" pa
    WHERE pa."practiceId" = dp."id"
);

UPDATE "practice_agent" pa
SET
    "status" = 'ACTIVE',
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp
WHERE pa."id" = (
    SELECT pa_inner."id"
    FROM "practice_agent" pa_inner
    WHERE pa_inner."practiceId" = dp."id"
    ORDER BY pa_inner."createdAt" ASC
    LIMIT 1
);

CREATE TEMP TABLE "_acuity_demo_agent" AS
SELECT pa."id"
FROM "practice_agent" pa
JOIN "_acuity_demo_practice" dp ON dp."id" = pa."practiceId"
ORDER BY pa."createdAt" ASC
LIMIT 1;

CREATE TEMP TABLE "_acuity_demo_agent_call" AS
SELECT ac."id"
FROM "agent_call" ac
JOIN "_abita_practice" ap ON ap."id" = ac."practiceId"
WHERE ac."locationId" IN (
        SELECT "locationId" FROM "_acuity_demo_location"
    )
   OR ac."officePhone" IN (
        SELECT "phoneNumber" FROM "_acuity_demo_phone_variant"
    );

UPDATE "agent_call" ac
SET
    "practiceId" = dp."id",
    "agentId" = da."id",
    "locationId" = COALESCE(
        CASE
            WHEN ac."locationId" IN (
                SELECT "locationId" FROM "_acuity_demo_location"
            )
            THEN ac."locationId"
        END,
        (
            SELECT "locationId"
            FROM "_acuity_demo_location"
            ORDER BY "locationId" ASC
            LIMIT 1
        ),
        ac."locationId"
    ),
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp,
     "_acuity_demo_agent" da,
     "_acuity_demo_agent_call" dac
WHERE ac."id" = dac."id";

UPDATE "usage_cost_line_item" ucli
SET "practiceId" = dp."id"
FROM "_acuity_demo_practice" dp,
     "_acuity_demo_agent_call" dac
WHERE ucli."agentCallId" = dac."id";

UPDATE "agent_call_evaluation_label" acel
SET
    "practiceId" = dp."id",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp,
     "_acuity_demo_agent_call" dac
WHERE acel."callId" = dac."id";

CREATE TEMP TABLE "_acuity_demo_call_center_seat" AS
SELECT ccas."id"
FROM "call_center_agent_seat" ccas
WHERE ccas."locationId" IN (
    SELECT "locationId" FROM "_acuity_demo_location"
);

CREATE TEMP TABLE "_acuity_demo_call_center_session" AS
SELECT ccs."id"
FROM "call_center_session" ccs
WHERE ccs."agentCallId" IN (
        SELECT "id" FROM "_acuity_demo_agent_call"
    )
   OR ccs."locationId" IN (
        SELECT "locationId" FROM "_acuity_demo_location"
    )
   OR ccs."toPhone" IN (
        SELECT "phoneNumber" FROM "_acuity_demo_phone_variant"
    );

CREATE TEMP TABLE "_acuity_demo_call_center_queue_item" AS
SELECT ccqi."id"
FROM "call_center_queue_item" ccqi
WHERE ccqi."callerSessionId" IN (
        SELECT "id" FROM "_acuity_demo_call_center_session"
    )
   OR ccqi."locationId" IN (
        SELECT "locationId" FROM "_acuity_demo_location"
    )
   OR ccqi."toPhone" IN (
        SELECT "phoneNumber" FROM "_acuity_demo_phone_variant"
    );

CREATE TEMP TABLE "_acuity_demo_call_center_missed" AS
SELECT ccmc."id"
FROM "call_center_missed_call" ccmc
WHERE ccmc."agentCallId" IN (
        SELECT "id" FROM "_acuity_demo_agent_call"
    )
   OR ccmc."sessionId" IN (
        SELECT "id" FROM "_acuity_demo_call_center_session"
    )
   OR ccmc."locationId" IN (
        SELECT "locationId" FROM "_acuity_demo_location"
    );

CREATE TEMP TABLE "_acuity_demo_call_center_voicemail" AS
SELECT ccv."id"
FROM "call_center_voicemail" ccv
WHERE ccv."sessionId" IN (
        SELECT "id" FROM "_acuity_demo_call_center_session"
    )
   OR ccv."missedCallId" IN (
        SELECT "id" FROM "_acuity_demo_call_center_missed"
    )
   OR ccv."locationId" IN (
        SELECT "locationId" FROM "_acuity_demo_location"
    );

UPDATE "call_center_agent_seat" ccas
SET
    "practiceId" = dp."id",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp,
     "_acuity_demo_call_center_seat" dseat
WHERE ccas."id" = dseat."id";

UPDATE "call_center_session" ccs
SET
    "practiceId" = dp."id",
    "locationId" = COALESCE(
        CASE
            WHEN ccs."locationId" IN (
                SELECT "locationId" FROM "_acuity_demo_location"
            )
            THEN ccs."locationId"
        END,
        (
            SELECT "locationId"
            FROM "_acuity_demo_location"
            ORDER BY "locationId" ASC
            LIMIT 1
        ),
        ccs."locationId"
    ),
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp,
     "_acuity_demo_call_center_session" dsession
WHERE ccs."id" = dsession."id";

UPDATE "call_center_queue_item" ccqi
SET
    "practiceId" = dp."id",
    "locationId" = COALESCE(
        CASE
            WHEN ccqi."locationId" IN (
                SELECT "locationId" FROM "_acuity_demo_location"
            )
            THEN ccqi."locationId"
        END,
        (
            SELECT "locationId"
            FROM "_acuity_demo_location"
            ORDER BY "locationId" ASC
            LIMIT 1
        ),
        ccqi."locationId"
    ),
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp,
     "_acuity_demo_call_center_queue_item" dqueue
WHERE ccqi."id" = dqueue."id";

UPDATE "call_center_missed_call" ccmc
SET
    "practiceId" = dp."id",
    "locationId" = COALESCE(
        CASE
            WHEN ccmc."locationId" IN (
                SELECT "locationId" FROM "_acuity_demo_location"
            )
            THEN ccmc."locationId"
        END,
        (
            SELECT "locationId"
            FROM "_acuity_demo_location"
            ORDER BY "locationId" ASC
            LIMIT 1
        ),
        ccmc."locationId"
    ),
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp,
     "_acuity_demo_call_center_missed" dmissed
WHERE ccmc."id" = dmissed."id";

UPDATE "call_center_voicemail" ccv
SET
    "practiceId" = dp."id",
    "locationId" = COALESCE(
        CASE
            WHEN ccv."locationId" IN (
                SELECT "locationId" FROM "_acuity_demo_location"
            )
            THEN ccv."locationId"
        END,
        (
            SELECT "locationId"
            FROM "_acuity_demo_location"
            ORDER BY "locationId" ASC
            LIMIT 1
        ),
        ccv."locationId"
    ),
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp,
     "_acuity_demo_call_center_voicemail" dvoicemail
WHERE ccv."id" = dvoicemail."id";

UPDATE "call_center_note" ccn
SET
    "practiceId" = dp."id",
    "locationId" = COALESCE(
        CASE
            WHEN ccn."locationId" IN (
                SELECT "locationId" FROM "_acuity_demo_location"
            )
            THEN ccn."locationId"
        END,
        (
            SELECT "locationId"
            FROM "_acuity_demo_location"
            ORDER BY "locationId" ASC
            LIMIT 1
        ),
        ccn."locationId"
    ),
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp
WHERE ccn."locationId" IN (
        SELECT "locationId" FROM "_acuity_demo_location"
    )
   OR ccn."sessionId" IN (
        SELECT "id" FROM "_acuity_demo_call_center_session"
    )
   OR ccn."missedCallId" IN (
        SELECT "id" FROM "_acuity_demo_call_center_missed"
    )
   OR ccn."voicemailId" IN (
        SELECT "id" FROM "_acuity_demo_call_center_voicemail"
    )
   OR ccn."stationSeatId" IN (
        SELECT "id" FROM "_acuity_demo_call_center_seat"
    );

UPDATE "sms_conversation" sc
SET
    "practiceId" = dp."id",
    "locationId" = COALESCE(
        CASE
            WHEN sc."locationId" IN (
                SELECT "locationId" FROM "_acuity_demo_location"
            )
            THEN sc."locationId"
        END,
        (
            SELECT "locationId"
            FROM "_acuity_demo_location"
            ORDER BY "locationId" ASC
            LIMIT 1
        ),
        sc."locationId"
    ),
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp
WHERE sc."practiceNumberId" IN (
        SELECT "phoneNumberId" FROM "_acuity_demo_phone_source"
    )
   OR sc."locationId" IN (
        SELECT "locationId" FROM "_acuity_demo_location"
    );

UPDATE "practice_provider" pp
SET
    "primaryLocationId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_abita_practice" ap
WHERE pp."practiceId" = ap."id"
  AND pp."primaryLocationId" IN (
      SELECT "locationId" FROM "_acuity_demo_location"
  );

UPDATE "practice_knowledge_document" pkd
SET
    "locationId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_abita_practice" ap
WHERE pkd."practiceId" = ap."id"
  AND pkd."locationId" IN (
      SELECT "locationId" FROM "_acuity_demo_location"
  );

UPDATE "practice_insurance_rule_set" pirs
SET
    "locationId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_abita_practice" ap
WHERE pirs."practiceId" = ap."id"
  AND pirs."locationId" IN (
      SELECT "locationId" FROM "_acuity_demo_location"
  );

INSERT INTO "user" (
    "id",
    "name",
    "email",
    "emailVerified",
    "createdAt",
    "updatedAt"
)
SELECT
    'user_acuity_demo',
    'Demo Account',
    'demo@acuity.local',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "user" WHERE "email" = 'demo@acuity.local'
);

CREATE TEMP TABLE "_acuity_demo_user" AS
SELECT "id"
FROM "user"
WHERE "email" = 'demo@acuity.local'
ORDER BY "createdAt" ASC
LIMIT 1;

INSERT INTO "practice_membership" (
    "id",
    "practiceId",
    "userId",
    "role",
    "locationScope",
    "isPrimary",
    "createdAt",
    "updatedAt"
)
SELECT
    'practice_membership_acuity_demo_owner',
    dp."id",
    du."id",
    'OWNER',
    'ALL',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp,
     "_acuity_demo_user" du
ON CONFLICT ("practiceId", "userId") DO UPDATE
SET
    "role" = 'OWNER',
    "locationScope" = 'ALL',
    "isPrimary" = true,
    "updatedAt" = EXCLUDED."updatedAt";

UPDATE "practice_membership" pm
SET
    "isPrimary" = false,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_acuity_demo_practice" dp,
     "_acuity_demo_user" du
WHERE pm."userId" = du."id"
  AND pm."practiceId" <> dp."id"
  AND pm."isPrimary" = true;

DELETE FROM "practice_membership_location" pml
USING "practice_membership" pm,
      "practice_location" pl
WHERE pml."membershipId" = pm."id"
  AND pml."locationId" = pl."id"
  AND pm."practiceId" <> pl."practiceId";

UPDATE "practice_location" pl
SET
    "isPrimary" = true,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_abita_practice" ap
WHERE pl."id" = (
    SELECT pl_inner."id"
    FROM "practice_location" pl_inner
    WHERE pl_inner."practiceId" = ap."id"
    ORDER BY pl_inner."createdAt" ASC
    LIMIT 1
)
AND NOT EXISTS (
    SELECT 1
    FROM "practice_location" current_primary
    WHERE current_primary."practiceId" = ap."id"
      AND current_primary."isPrimary" = true
);
