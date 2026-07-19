import { Prisma } from "@/generated/prisma/client";

type Transaction = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * Serializes the short database transactions that can mutate multiple calls,
 * endpoints, or commands for one practice. Provider I/O runs after this lock is
 * released.
 */
export async function lockCallCenterPractice(
  transaction: Transaction,
  practiceId: string,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`CALL_CENTER:${practiceId}`}, 0))::text AS "lock"`,
  );
}
