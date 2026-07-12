import { Prisma } from "@/generated/prisma/client";
import type {
  CallCenterActivationPreflightFacts,
  CallCenterActivationPreflightStore,
} from "@/lib/call-center/application/call-center-activation-preflight";
import { PROVIDER_COMMAND_MAX_ATTEMPTS } from "@/lib/call-center/domain/provider-command";
import { prisma } from "@/lib/prisma";

const PROVIDER_EVENT_MAX_ATTEMPTS = 8;

type PreflightRow = {
  ambiguousCommandCount: bigint | number;
  ambiguousEventCount: bigint | number;
  blockedCommandCount: bigint | number;
  commandDeadLetterCount: bigint | number;
  enabledNumberCount: bigint | number;
  enabledQueueCount: bigint | number;
  eventDeadLetterCount: bigint | number;
  incompleteNumberCount: bigint | number;
  incompleteQueueCount: bigint | number;
  missingMigrationCount: bigint | number;
  readyTestEndpointCount: bigint | number;
  runtimeConfigReadyCount: bigint | number;
  staleSentCommandCount: bigint | number;
  unresolvedOwnershipCount: bigint | number;
};

export type ActivationPreflightQuery = (query: Prisma.Sql) => Promise<PreflightRow[]>;

function count(value: bigint | number | undefined) {
  const resolved = Number(value);
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error("Invalid activation preflight count");
  }
  return resolved;
}

function migrationValues(requiredMigrations: readonly string[]) {
  if (requiredMigrations.length === 0) {
    throw new Error("Activation requires at least one migration");
  }
  return Prisma.join(requiredMigrations.map((migration) => Prisma.sql`(${migration})`));
}

export class PrismaCallCenterActivationPreflightStore implements CallCenterActivationPreflightStore {
  constructor(
    private readonly query: ActivationPreflightQuery = (statement) =>
      prisma.$queryRaw<PreflightRow[]>(statement),
  ) {}

  async inspect(input: {
    confirmationCutoff: Date;
    heartbeatCutoff: Date;
    now: Date;
    requiredMigrations: readonly string[];
    runtimeConfigReady: boolean;
    testEndpointId: string;
  }): Promise<CallCenterActivationPreflightFacts> {
    const rows = await this.query(Prisma.sql`
      WITH RECURSIVE required_migration(name) AS (
        VALUES ${migrationValues(input.requiredMigrations)}
      ), enabled_number AS (
        SELECT
          number."id",
          CASE
            WHEN LENGTH(REGEXP_REPLACE(phone."phoneNumber", '[^0-9]', '', 'g')) = 10
              THEN '1' || REGEXP_REPLACE(phone."phoneNumber", '[^0-9]', '', 'g')
            ELSE REGEXP_REPLACE(phone."phoneNumber", '[^0-9]', '', 'g')
          END AS "normalizedDigits"
        FROM "call_center_number" AS number
        JOIN "practice_phone_number" AS phone
          ON phone."id" = number."practicePhoneNumberId"
        WHERE number."enabled" = true
      ), overflow_path("rootId", "currentId", "nextId", path, cycle) AS (
        SELECT queue."id", queue."id", queue."overflowQueueId", ARRAY[queue."id"], false
        FROM "call_center_queue" AS queue
        WHERE queue."enabled" = true
        UNION ALL
        SELECT
          path."rootId",
          next_queue."id",
          next_queue."overflowQueueId",
          path.path || next_queue."id",
          next_queue."id" = ANY(path.path)
        FROM overflow_path AS path
        JOIN "call_center_queue" AS next_queue ON next_queue."id" = path."nextId"
        WHERE path."nextId" IS NOT NULL AND path.cycle = false
      )
      SELECT
        ${input.runtimeConfigReady ? 1 : 0} AS "runtimeConfigReadyCount",
        (
          SELECT COUNT(*)
          FROM required_migration AS required
          WHERE NOT EXISTS (
            SELECT 1
            FROM "_prisma_migrations" AS migration
            WHERE migration.migration_name = required.name
              AND migration.finished_at IS NOT NULL
              AND migration.rolled_back_at IS NULL
          )
        ) AS "missingMigrationCount",
        (
          SELECT COUNT(*) FROM "call_center_queue" AS queue
          WHERE queue."enabled" = true
        ) AS "enabledQueueCount",
        (
          SELECT COUNT(*)
          FROM "call_center_queue" AS queue
          WHERE queue."enabled" = true
            AND (
              queue."ringTimeoutSec" < 1
              OR queue."ringTimeoutSec" > 300
              OR queue."maxWaitSec" < queue."ringTimeoutSec"
              OR queue."maxWaitSec" > 1800
              OR queue."wrapUpSec" < 0
              OR queue."wrapUpSec" > 1800
              OR NOT EXISTS (
                SELECT 1
                FROM "practice_call_center_settings" AS settings
                WHERE settings."practiceId" = queue."practiceId"
                  AND settings."enabled" = true
                  AND NULLIF(BTRIM(settings."telnyxConnectionId"), '') IS NOT NULL
              )
              OR EXISTS (
                SELECT 1
                FROM "call_center_queue_location" AS queue_location
                JOIN "practice_location" AS location
                  ON location."id" = queue_location."locationId"
                WHERE queue_location."queueId" = queue."id"
                  AND location."practiceId" <> queue."practiceId"
              )
              OR (
                queue."overflowQueueId" IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1
                  FROM "call_center_queue" AS overflow
                  WHERE overflow."id" = queue."overflowQueueId"
                    AND overflow."practiceId" = queue."practiceId"
                    AND overflow."enabled" = true
                )
              )
              OR EXISTS (
                SELECT 1 FROM overflow_path AS path
                WHERE path."rootId" = queue."id" AND path.cycle = true
              )
              OR (queue."voicemailEnabled" = true AND BTRIM(queue."voicemailGreeting") = '')
              OR NOT EXISTS (
                SELECT 1
                FROM "call_center_number" AS route_number
                JOIN "practice_phone_number" AS route_phone
                  ON route_phone."id" = route_number."practicePhoneNumberId"
                 AND route_phone."practiceId" = queue."practiceId"
                JOIN "call_center_queue_location" AS route_phone_location
                  ON route_phone_location."queueId" = queue."id"
                 AND route_phone_location."locationId" = route_phone."locationId"
                JOIN "call_center_queue_member" AS route_member
                  ON route_member."queueId" = queue."id"
                 AND route_member."enabled" = true
                 AND route_member."role" = CAST('AGENT' AS "CallCenterQueueMemberRole")
                JOIN "practice_membership" AS route_membership
                  ON route_membership."practiceId" = queue."practiceId"
                 AND route_membership."userId" = route_member."userId"
                JOIN "call_center_endpoint" AS route_endpoint
                  ON route_endpoint."practiceId" = queue."practiceId"
                 AND route_endpoint."enabled" = true
                 AND NULLIF(BTRIM(route_endpoint."providerCredentialId"), '') IS NOT NULL
                 AND NULLIF(BTRIM(route_endpoint."sipUsername"), '') IS NOT NULL
                JOIN "call_center_queue_location" AS route_endpoint_location
                  ON route_endpoint_location."queueId" = queue."id"
                 AND route_endpoint_location."locationId" = route_endpoint."locationId"
                WHERE route_number."inboundQueueId" = queue."id"
                  AND route_number."practiceId" = queue."practiceId"
                  AND route_number."enabled" = true
                  AND route_number."inboundEnabled" = true
                  AND (
                    route_membership."locationScope" = CAST('ALL' AS "PracticeMembershipLocationScope")
                    OR (
                      EXISTS (
                        SELECT 1
                        FROM "practice_membership_location" AS route_phone_access
                        WHERE route_phone_access."membershipId" = route_membership."id"
                          AND route_phone_access."locationId" = route_phone."locationId"
                      )
                      AND EXISTS (
                        SELECT 1
                        FROM "practice_membership_location" AS route_endpoint_access
                        WHERE route_endpoint_access."membershipId" = route_membership."id"
                          AND route_endpoint_access."locationId" = route_endpoint."locationId"
                      )
                    )
                  )
              )
            )
        ) AS "incompleteQueueCount",
        (
          SELECT COUNT(*) FROM "call_center_number" AS number
          WHERE number."enabled" = true
        ) AS "enabledNumberCount",
        (
          SELECT COUNT(*)
          FROM "call_center_number" AS number
          JOIN "practice_phone_number" AS phone
            ON phone."id" = number."practicePhoneNumberId"
          LEFT JOIN "call_center_queue" AS queue
            ON queue."id" = number."inboundQueueId"
          WHERE number."enabled" = true
            AND (
              NULLIF(BTRIM(phone."phoneNumber"), '') IS NULL
              OR phone."practiceId" <> number."practiceId"
              OR phone."phoneNumber" !~ '^\\+[1-9][0-9]{7,14}$'
              OR phone."phoneNumber" <> '+' || CASE
                WHEN LENGTH(REGEXP_REPLACE(phone."phoneNumber", '[^0-9]', '', 'g')) = 10
                  THEN '1' || REGEXP_REPLACE(phone."phoneNumber", '[^0-9]', '', 'g')
                ELSE REGEXP_REPLACE(phone."phoneNumber", '[^0-9]', '', 'g')
              END
              OR LENGTH(REGEXP_REPLACE(phone."phoneNumber", '[^0-9]', '', 'g')) NOT BETWEEN 8 AND 15
              OR EXISTS (
                SELECT 1
                FROM enabled_number AS current_number
                JOIN enabled_number AS other
                  ON other."normalizedDigits" = current_number."normalizedDigits"
                 AND other."id" <> current_number."id"
                WHERE current_number."id" = number."id"
              )
              OR (number."inboundEnabled" = false AND number."outboundEnabled" = false)
              OR (
                number."inboundEnabled" = true
                AND (
                  queue."id" IS NULL
                  OR queue."enabled" = false
                  OR queue."practiceId" <> number."practiceId"
                )
              )
            )
        ) AS "incompleteNumberCount",
        (
          SELECT COUNT(*) FROM "provider_webhook_event" AS event
          WHERE event."effectOwner" IS NULL
        ) AS "unresolvedOwnershipCount",
        (
          SELECT COUNT(*) FROM "call_center_command" AS command
          WHERE command."status" = CAST('SENT' AS "CallCenterCommandStatus")
            AND command."updatedAt" <= ${input.confirmationCutoff}
        ) AS "staleSentCommandCount",
        (
          SELECT COUNT(*)
          FROM "call_center_command" AS command
          JOIN "call_center_command" AS dependency
            ON dependency."id" = command."dependsOnCommandId"
          WHERE (
              command."status" IN (
                CAST('PENDING' AS "CallCenterCommandStatus"),
                CAST('SENDING' AS "CallCenterCommandStatus"),
                CAST('SENT' AS "CallCenterCommandStatus")
              )
              OR (
                command."status" = CAST('FAILED' AS "CallCenterCommandStatus")
                AND command."nextAttemptAt" IS NOT NULL
              )
            )
            AND dependency."status" = CAST('FAILED' AS "CallCenterCommandStatus")
            AND dependency."nextAttemptAt" IS NULL
        ) AS "blockedCommandCount",
        (
          SELECT COUNT(*) FROM "call_center_command" AS command
          WHERE command."status" = CAST('FAILED' AS "CallCenterCommandStatus")
            AND (
              command."attemptCount" >= ${PROVIDER_COMMAND_MAX_ATTEMPTS}
              OR command."errorCode" = 'SENDING_OUTCOME_AMBIGUOUS'
              OR (
                command."nextAttemptAt" IS NULL
                AND command."errorCode" NOT IN (
                  'COMMAND_DEPENDENCY_FAILED',
                  'COMMAND_LEG_TERMINAL'
                )
              )
            )
        ) AS "commandDeadLetterCount",
        (
          SELECT COUNT(*) FROM "provider_webhook_event" AS event
          WHERE (
            event."processingStatus" = CAST('FAILED' AS "ProviderWebhookProcessingStatus")
            AND event."attemptCount" >= ${PROVIDER_EVENT_MAX_ATTEMPTS}
          ) OR (
            event."canonicalProjectionStatus" = CAST('FAILED' AS "ProviderWebhookProcessingStatus")
            AND event."canonicalProjectionAttemptCount" >= ${PROVIDER_EVENT_MAX_ATTEMPTS}
          )
        ) AS "eventDeadLetterCount",
        (
          SELECT COUNT(*)
          FROM "call_center_command" AS command
          JOIN "call_center_call" AS call ON call."id" = command."callId"
          LEFT JOIN "call_center_call_leg" AS leg ON leg."id" = command."legId"
          LEFT JOIN "call_center_command" AS dependency
            ON dependency."id" = command."dependsOnCommandId"
          WHERE call."effectOwner" <> CAST('CANONICAL' AS "CallCenterEffectOwner")
            OR leg."id" IS NULL
            OR leg."callId" <> command."callId"
            OR (
              dependency."id" IS NOT NULL
              AND (
                dependency."callId" <> command."callId"
                OR dependency."practiceId" <> command."practiceId"
              )
            )
            OR (
              command."type" <> CAST('DIAL_AGENT' AS "CallCenterCommandType")
              AND leg."providerCallControlId" IS NULL
            )
            OR (
              command."type" = CAST('DIAL_AGENT' AS "CallCenterCommandType")
              AND command."status" = CAST('CONFIRMED' AS "CallCenterCommandStatus")
              AND leg."providerCallControlId" IS NULL
              AND leg."providerCallLegId" IS NULL
            )
        ) AS "ambiguousCommandCount",
        (
          SELECT COUNT(*)
          FROM "provider_webhook_event" AS event
          WHERE event."effectOwner" = CAST('CANONICAL' AS "CallCenterEffectOwner")
            AND (
              event."canonicalProjectionStatus" <> CAST('PROCESSED' AS "ProviderWebhookProcessingStatus")
              OR
              event."providerCallSessionId" IS NULL
              OR (
                SELECT COUNT(DISTINCT correlation."callId")
                FROM (
                  SELECT call."id" AS "callId"
                  FROM "call_center_call" AS call
                  WHERE call."providerCallSessionId" = event."providerCallSessionId"
                  UNION
                  SELECT leg."callId"
                  FROM "call_center_call_leg" AS leg
                  WHERE leg."providerCallSessionId" = event."providerCallSessionId"
                ) AS correlation
              ) <> 1
            )
        ) AS "ambiguousEventCount",
        (
          SELECT COUNT(DISTINCT endpoint."id")
          FROM "call_center_endpoint" AS endpoint
          JOIN "call_center_agent_session" AS session
            ON session."endpointId" = endpoint."id"
           AND session."practiceId" = endpoint."practiceId"
          WHERE endpoint."id" = ${input.testEndpointId}
            AND endpoint."enabled" = true
            AND NULLIF(BTRIM(endpoint."providerCredentialId"), '') IS NOT NULL
            AND NULLIF(BTRIM(endpoint."sipUsername"), '') IS NOT NULL
            AND session."presence" = CAST('AVAILABLE' AS "CallCenterAgentPresence")
            AND session."currentCallId" IS NULL
            AND session."connectionState" = CAST('READY' AS "CallCenterAgentConnectionState")
            AND session."microphoneReady" = true
            AND session."audioReady" = true
            AND session."lastHeartbeatAt" >= ${input.heartbeatCutoff}
            AND session."leaseExpiresAt" > ${input.now}
            AND EXISTS (
              SELECT 1
              FROM "call_center_queue_member" AS member
              JOIN "call_center_queue" AS queue
                ON queue."id" = member."queueId"
               AND queue."practiceId" = endpoint."practiceId"
               AND queue."enabled" = true
              JOIN "call_center_number" AS number
                ON number."inboundQueueId" = queue."id"
               AND number."practiceId" = queue."practiceId"
               AND number."enabled" = true
               AND number."inboundEnabled" = true
              JOIN "practice_phone_number" AS phone
                ON phone."id" = number."practicePhoneNumberId"
              JOIN "practice_membership" AS membership
                ON membership."practiceId" = queue."practiceId"
               AND membership."userId" = session."userId"
              WHERE member."userId" = session."userId"
                AND member."enabled" = true
                AND member."role" = CAST('AGENT' AS "CallCenterQueueMemberRole")
                AND (
                  NOT EXISTS (
                    SELECT 1 FROM "call_center_queue_location" AS location
                    WHERE location."queueId" = queue."id"
                  )
                  OR (
                    EXISTS (
                      SELECT 1 FROM "call_center_queue_location" AS location
                      WHERE location."queueId" = queue."id"
                        AND location."locationId" = endpoint."locationId"
                    )
                    AND EXISTS (
                      SELECT 1 FROM "call_center_queue_location" AS location
                      WHERE location."queueId" = queue."id"
                        AND location."locationId" = phone."locationId"
                    )
                  )
                )
                AND (
                  membership."locationScope" = CAST('ALL' AS "PracticeMembershipLocationScope")
                  OR (
                    EXISTS (
                      SELECT 1 FROM "practice_membership_location" AS access
                      WHERE access."membershipId" = membership."id"
                        AND access."locationId" = endpoint."locationId"
                    )
                    AND EXISTS (
                      SELECT 1 FROM "practice_membership_location" AS access
                      WHERE access."membershipId" = membership."id"
                        AND access."locationId" = phone."locationId"
                    )
                  )
                )
            )
        ) AS "readyTestEndpointCount"
    `);
    const row = rows[0];
    if (!row) throw new Error("Activation preflight returned no row");

    return {
      ambiguousCommandCount: count(row.ambiguousCommandCount),
      ambiguousEventCount: count(row.ambiguousEventCount),
      blockedCommandCount: count(row.blockedCommandCount),
      commandDeadLetterCount: count(row.commandDeadLetterCount),
      enabledNumberCount: count(row.enabledNumberCount),
      enabledQueueCount: count(row.enabledQueueCount),
      eventDeadLetterCount: count(row.eventDeadLetterCount),
      incompleteNumberCount: count(row.incompleteNumberCount),
      incompleteQueueCount: count(row.incompleteQueueCount),
      missingMigrationCount: count(row.missingMigrationCount),
      readyTestEndpointCount: count(row.readyTestEndpointCount),
      runtimeConfigReadyCount: count(row.runtimeConfigReadyCount),
      staleSentCommandCount: count(row.staleSentCommandCount),
      unresolvedOwnershipCount: count(row.unresolvedOwnershipCount),
    };
  }
}

export const prismaCallCenterActivationPreflightStore =
  new PrismaCallCenterActivationPreflightStore();
