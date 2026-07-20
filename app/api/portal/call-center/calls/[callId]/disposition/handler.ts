import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import {
  CALL_DISPOSITIONS,
  operatorFollowUp,
} from "@/lib/call-center/operator-follow-up";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";

const bodySchema = z
  .object({
    disposition: z.enum(CALL_DISPOSITIONS),
    expectedStateVersion: z.number().int().nonnegative(),
    note: z.string().trim().max(2000).nullable().default(null),
    taskIds: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  })
  .strict();
type Context = { params: Promise<{ callId: string }> };

export function createDispositionHandler({
  getActor,
  save = operatorFollowUp.disposition,
}: {
  getActor: () => Promise<QueueAccessActor>;
  save?: typeof operatorFollowUp.disposition;
}) {
  return withCallCenterApiHandler(
    async (request: Request, context: Context) => {
      const callId = (await context.params).callId.trim();
      const key = request.headers.get("Idempotency-Key")?.trim();
      if (!callId || !key || key.length > 200)
        throw new ApiError("Valid call and idempotency key required", 400);
      const body = await parseJsonBody(request, bodySchema);
      const receipt = await save(await getActor(), {
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
