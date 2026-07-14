import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import { dispositionCall } from "@/lib/call-center/application/disposition-call";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { prismaDispositionCallStore } from "@/lib/call-center/infrastructure/prisma-disposition-call-store";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";

const bodySchema = z
  .object({
    disposition: z.enum([
      "RESOLVED",
      "CALLBACK_NEEDED",
      "FOLLOW_UP_REQUIRED",
      "WRONG_NUMBER",
      "OTHER",
    ]),
    expectedStateVersion: z.number().int().nonnegative(),
    note: z.string().trim().max(2000).nullable().default(null),
    taskIds: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  })
  .strict();
type Context = { params: Promise<{ callId: string }> };

export function createDispositionHandler({
  getActor,
  save = dispositionCall,
}: {
  getActor: () => Promise<QueueAccessActor>;
  save?: typeof dispositionCall;
}) {
  return withCallCenterApiHandler(
    async (request: Request, context: Context) => {
      const callId = (await context.params).callId.trim();
      const key = request.headers.get("Idempotency-Key")?.trim();
      if (!callId || !key || key.length > 200)
        throw new ApiError("Valid call and idempotency key required", 400);
      const body = await parseJsonBody(request, bodySchema);
      const receipt = await save(prismaDispositionCallStore, await getActor(), {
        ...body,
        callId,
        idempotencyKey: key,
      });
      return NextResponse.json(receipt, { status: receipt.replayed ? 200 : 202 });
    },
    {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "[portal-call-center] disposition failed",
      retryable: true,
    },
  );
}
