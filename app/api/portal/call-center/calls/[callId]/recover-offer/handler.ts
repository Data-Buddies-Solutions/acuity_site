import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import {
  recoverFailedBrowserOffer,
  type FailedBrowserOfferRecoveryInput,
} from "@/lib/call-center/application/replace-failed-browser-offer";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { prismaFailedBrowserOfferRecoveryStore } from "@/lib/call-center/infrastructure/prisma-failed-browser-offer-recovery";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";

const bodySchema = z
  .object({
    agentSessionId: z.string().trim().min(1).max(200),
    callLegId: z.string().trim().min(1).max(200),
    clientInstanceId: z.string().trim().min(1).max(200),
    reason: z.enum(["CALL_DOES_NOT_EXIST", "SESSION_NOT_REATTACHED"]),
    recoveryGeneration: z.number().int().nonnegative().max(1_000_000),
  })
  .strict();
const paramsSchema = z.object({ callId: z.string().trim().min(1).max(200) });
type Context = { params: Promise<{ callId: string }> };

export function createRecoverBrowserOfferHandler({
  getActor,
  recover = recoverFailedBrowserOffer,
}: {
  getActor: () => Promise<QueueAccessActor>;
  recover?: (
    store: typeof prismaFailedBrowserOfferRecoveryStore,
    actor: QueueAccessActor,
    input: FailedBrowserOfferRecoveryInput,
  ) => ReturnType<typeof recoverFailedBrowserOffer>;
}) {
  return withCallCenterApiHandler(
    async (request: Request, context: Context) => {
      const parameters = paramsSchema.safeParse(await context.params);
      const key = request.headers.get("Idempotency-Key")?.trim();
      if (!parameters.success || !key || key.length > 200) {
        throw new ApiError("Valid call and idempotency key required", 400);
      }
      const body = await parseJsonBody(request, bodySchema);
      const receipt = await recover(
        prismaFailedBrowserOfferRecoveryStore,
        await getActor(),
        {
          ...body,
          callId: parameters.data.callId,
          idempotencyKey: key,
        },
      );
      return NextResponse.json(receipt, { status: receipt.replayed ? 200 : 202 });
    },
    {
      errorCode: "CALL_NOT_CONNECTED",
      logLabel: "[portal-call-center] browser offer recovery failed",
      retryable: true,
    },
  );
}
