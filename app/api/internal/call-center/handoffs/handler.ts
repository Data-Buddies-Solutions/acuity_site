import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import {
  DIRECT_HANDOFF_TTL_MS,
  resolveDirectHandoffConfig,
  type DirectHandoffConfig,
} from "@/lib/call-center/infrastructure/direct-handoff-config";
import {
  reserveDirectHandoff,
  type ReserveDirectHandoffInput,
} from "@/lib/call-center/infrastructure/prisma-direct-handoff-store";
import { normalizePhone } from "@/lib/phone";

const bodySchema = z.strictObject({
  callerPhone: z
    .string()
    .trim()
    .min(8)
    .max(32)
    .refine((value) => /^\+[1-9][0-9]{7,14}$/.test(normalizePhone(value)), {
      message: "callerPhone must be a valid E.164 number",
    }),
  routePhoneNumber: z
    .string()
    .trim()
    .min(8)
    .max(32)
    .refine((value) => /^\+[1-9][0-9]{7,14}$/.test(normalizePhone(value)), {
      message: "routePhoneNumber must be a valid E.164 number",
    }),
  sourceCallId: z.string().trim().min(1).max(200),
});

type Reservation = Awaited<ReturnType<typeof reserveDirectHandoff>>;

type Dependencies = {
  clock?: () => Date;
  config?: () => DirectHandoffConfig;
  reserve?: (
    input: ReserveDirectHandoffInput,
    options: { baseSipUri: string; expiresAt: Date; now: Date; secret: string },
  ) => Promise<Reservation>;
};

function authorized(header: string | null, secret: string) {
  const actual = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createDirectHandoffHandler({
  clock = () => new Date(),
  config = resolveDirectHandoffConfig,
  reserve = reserveDirectHandoff,
}: Dependencies = {}) {
  return async function handleDirectHandoff(request: Request) {
    const resolved = config();
    if (!authorized(request.headers.get("authorization"), resolved.secret)) {
      throw new ApiError("Unauthorized", 401);
    }

    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new ApiError("A valid Idempotency-Key is required", 422);
    }

    const body = await parseJsonBody(request, bodySchema);
    const now = clock();
    const reservation = await reserve(
      { ...body, idempotencyKey, practiceId: resolved.practiceId },
      {
        baseSipUri: resolved.sipUri,
        expiresAt: new Date(now.getTime() + DIRECT_HANDOFF_TTL_MS),
        now,
        secret: resolved.secret,
      },
    );

    return NextResponse.json(
      {
        expiresAt: reservation.expiresAt.toISOString(),
        handoffId: reservation.handoffId,
        sipHeaders: reservation.sipHeaders,
        sipUri: reservation.sipUri,
        type: "DIRECT",
      },
      { status: reservation.replayed ? 200 : 201 },
    );
  };
}
