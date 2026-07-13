import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const BATCH_SIZE = 100;
const INGRESS_GRACE_MS = 5 * 60_000;

export type DirectHandoffRecoveryDatabase = {
  $executeRaw(query: Prisma.Sql): Promise<number>;
};

export async function expireIssuedDirectHandoffs(
  now: Date,
  database: DirectHandoffRecoveryDatabase = prisma,
) {
  const cutoff = new Date(now.getTime() - INGRESS_GRACE_MS);
  return database.$executeRaw(Prisma.sql`
    WITH expired AS (
      SELECT "id"
      FROM "call_center_handoff"
      WHERE "status" = CAST('ISSUED' AS "CallCenterHandoffStatus")
        AND "expiresAt" <= ${cutoff}
      ORDER BY "expiresAt", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    )
    UPDATE "call_center_handoff" AS handoff
    SET
      "status" = CAST('EXPIRED' AS "CallCenterHandoffStatus"),
      "failedAt" = ${now},
      "failureCode" = 'INGRESS_TIMEOUT',
      "updatedAt" = ${now}
    FROM expired
    WHERE handoff."id" = expired."id"
  `);
}
