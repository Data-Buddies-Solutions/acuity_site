import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import { callCenter } from "@/lib/call-center/call-center";
import {
  resolveDirectHandoffConfig,
  type AcceptDirectHandoffInput,
  type DirectHandoffConfig,
} from "@/lib/call-center/direct-handoff";
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

type Reservation = Awaited<ReturnType<typeof callCenter.acceptHandoff>>;

type Dependencies = {
  config?: () => DirectHandoffConfig;
  reserve?: (input: AcceptDirectHandoffInput) => Promise<Reservation>;
};

function authorized(header: string | null, secret: string) {
  const actual = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createDirectHandoffHandler({
  config = resolveDirectHandoffConfig,
  reserve = callCenter.acceptHandoff,
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
    const reservation = await reserve({ ...body, idempotencyKey });

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
