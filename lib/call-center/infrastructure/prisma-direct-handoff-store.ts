import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import {
  directHandoffRequestFingerprint,
  directHandoffToken,
  directHandoffTokenHash,
} from "@/lib/call-center/infrastructure/direct-handoff-token";
import { directHandoffSipUri } from "@/lib/call-center/infrastructure/direct-handoff-uri";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

const SOURCE_SYSTEM = "ABITA";
const LEGACY_HANDOFF_ID_HEADER = "X-Acuity-Handoff-Id";
const LEGACY_HANDOFF_TOKEN_HEADER = "X-Acuity-Handoff-Token";

export type ReserveDirectHandoffInput = {
  callerPhone: string;
  idempotencyKey: string;
  practiceId: string;
  routePhoneNumber: string;
  sourceCallId: string;
};

export type DirectHandoffReservation = {
  expiresAt: Date;
  handoffId: string;
  replayed: boolean;
  sipHeaders: Record<string, string>;
  sipUri: string;
};

export class DirectHandoffReservationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DirectHandoffReservationError";
  }
}

export type DirectHandoffDatabase = {
  $transaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
};

function normalizedInput(input: ReserveDirectHandoffInput) {
  return {
    callerPhone: normalizePhone(input.callerPhone),
    idempotencyKey: input.idempotencyKey.trim(),
    practiceId: input.practiceId.trim(),
    routePhoneNumber: normalizePhone(input.routePhoneNumber),
    sourceCallId: input.sourceCallId.trim(),
  };
}

function response(
  row: { expiresAt: Date; id: string },
  baseSipUri: string,
  secret: string,
  replayed: boolean,
): DirectHandoffReservation {
  const token = directHandoffToken(row.id, secret);
  return {
    expiresAt: row.expiresAt,
    handoffId: row.id,
    replayed,
    sipHeaders: {
      [LEGACY_HANDOFF_ID_HEADER]: row.id,
      [LEGACY_HANDOFF_TOKEN_HEADER]: token,
    },
    sipUri: directHandoffSipUri(baseSipUri, token),
  };
}

export async function reserveDirectHandoff(
  rawInput: ReserveDirectHandoffInput,
  options: {
    baseSipUri: string;
    expiresAt: Date;
    now: Date;
    secret: string;
  },
  database: DirectHandoffDatabase = prisma,
) {
  const input = normalizedInput(rawInput);
  const requestFingerprint = directHandoffRequestFingerprint({
    callerPhone: input.callerPhone,
    routePhoneNumber: input.routePhoneNumber,
    sourceCallId: input.sourceCallId,
  });
  const sourceLockKey = createHash("sha256")
    .update(`${SOURCE_SYSTEM}:${input.sourceCallId}`)
    .digest("hex");

  try {
    const result = await database.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`DIRECT_HANDOFF:${sourceLockKey}`}, 0))::text AS "lock"`,
      );

      const numbers = await tx.callCenterNumber.findMany({
        include: { inboundQueue: true, practicePhoneNumber: true },
        take: 2,
        where: {
          enabled: true,
          inboundEnabled: true,
          practiceId: input.practiceId,
          practicePhoneNumber: {
            phoneNumber: { in: phoneLookupVariants(input.routePhoneNumber) },
          },
        },
      });
      if (numbers.length !== 1) {
        throw new DirectHandoffReservationError(
          numbers.length === 0
            ? "Direct handoff route is not configured"
            : "Direct handoff route is ambiguous",
          numbers.length === 0 ? 404 : 409,
        );
      }

      let number = numbers[0]!;
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "practice" WHERE "id" = ${number.practiceId} FOR SHARE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "practice_phone_number" WHERE "id" = ${number.practicePhoneNumberId} FOR SHARE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "call_center_number" WHERE "id" = ${number.id} FOR SHARE`,
      );
      if (number.inboundQueueId) {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "call_center_queue" WHERE "id" = ${number.inboundQueueId} FOR SHARE`,
        );
      }
      number = await tx.callCenterNumber.findUniqueOrThrow({
        include: { inboundQueue: true, practicePhoneNumber: true },
        where: { id: number.id },
      });
      if (
        !number.enabled ||
        !number.inboundEnabled ||
        !number.inboundQueue?.enabled ||
        number.inboundQueue.practiceId !== number.practiceId ||
        number.practicePhoneNumber.practiceId !== number.practiceId ||
        number.practiceId !== input.practiceId ||
        number.inboundQueueId !== number.inboundQueue.id ||
        !phoneLookupVariants(input.routePhoneNumber).includes(
          number.practicePhoneNumber.phoneNumber,
        )
      ) {
        throw new DirectHandoffReservationError(
          "Direct handoff queue is unavailable",
          409,
        );
      }

      const existing = await tx.callCenterHandoff.findMany({
        take: 2,
        where: {
          sourceSystem: SOURCE_SYSTEM,
          OR: [
            { sourceCallId: input.sourceCallId },
            {
              idempotencyKey: input.idempotencyKey,
              practiceId: number.practiceId,
            },
          ],
        },
      });
      if (
        existing.length > 1 ||
        (existing[0] &&
          (existing[0].requestFingerprint !== requestFingerprint ||
            existing[0].idempotencyKey !== input.idempotencyKey ||
            existing[0].practiceId !== number.practiceId ||
            existing[0].sourceCallId !== input.sourceCallId))
      ) {
        throw new DirectHandoffReservationError("Direct handoff conflicts", 409);
      }
      if (existing[0]) {
        const handoff = existing[0];
        if (handoff.status !== "ISSUED") {
          throw new DirectHandoffReservationError(
            "Direct handoff is no longer transferable",
            409,
          );
        }
        if (handoff.expiresAt <= options.now) {
          await tx.callCenterHandoff.update({
            data: {
              failedAt: options.now,
              failureCode: "INGRESS_TIMEOUT",
              status: "EXPIRED",
            },
            where: { id: handoff.id },
          });
          return { terminalError: true as const };
        }
        return response(handoff, options.baseSipUri, options.secret, true);
      }

      const id = randomUUID();
      const handoff = await tx.callCenterHandoff.create({
        data: {
          callerPhone: input.callerPhone,
          expiresAt: options.expiresAt,
          id,
          idempotencyKey: input.idempotencyKey,
          numberId: number.id,
          practiceId: number.practiceId,
          queueId: number.inboundQueue.id,
          requestFingerprint,
          sourceCallId: input.sourceCallId,
          sourceSystem: SOURCE_SYSTEM,
          tokenHash: directHandoffTokenHash(directHandoffToken(id, options.secret)),
        },
      });
      return response(handoff, options.baseSipUri, options.secret, false);
    });
    if ("terminalError" in result) {
      throw new DirectHandoffReservationError(
        "Direct handoff is no longer transferable",
        409,
      );
    }
    return result;
  } catch (error) {
    if (
      error instanceof DirectHandoffReservationError ||
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }
    throw new DirectHandoffReservationError("Direct handoff conflicts", 409);
  }
}
