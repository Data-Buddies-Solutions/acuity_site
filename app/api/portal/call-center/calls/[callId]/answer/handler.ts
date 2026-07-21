import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import type { InboundAnswerClaimInput } from "@/lib/call-center/application/claim-inbound-answer";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { callCenter } from "@/lib/call-center/call-center";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";

const bodySchema = z
  .object({
    legId: z.string().trim().min(1).max(200),
    sessionId: z.string().trim().min(1).max(200),
  })
  .strict();
type Context = { params: Promise<{ callId: string }> };
const releaseBodySchema = bodySchema.extend({
  failureCode: z.enum(["BROWSER_ANSWER_FAILED", "BROWSER_DISCONNECTED"]),
});

type Claim = (
  actor: QueueAccessActor,
  input: InboundAnswerClaimInput,
) => ReturnType<typeof callCenter.claimInboundAnswer>;

export function createInboundAnswerHandler({
  claim = callCenter.claimInboundAnswer,
  getActor,
}: {
  claim?: Claim;
  getActor: () => Promise<QueueAccessActor>;
}) {
  return withCallCenterApiHandler(
    async (request: Request, context: Context) => {
      const callId = (await context.params).callId.trim();
      const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
      if (!callId || !idempotencyKey || idempotencyKey.length > 200) {
        throw new ApiError("Valid call and idempotency key required", 400);
      }
      const body = await parseJsonBody(request, bodySchema);
      const result = await claim(await getActor(), {
        callId,
        idempotencyKey,
        legId: body.legId,
        sessionId: body.sessionId,
      });
      if (result.status === "REJECTED") {
        return NextResponse.json(result, { status: 409 });
      }
      return NextResponse.json(result, { status: result.replayed ? 200 : 202 });
    },
    {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "[portal-call-center] inbound Answer claim failed",
      retryable: true,
    },
  );
}

export function createInboundAnswerReleaseHandler({
  getActor,
  release = callCenter.releaseInboundAnswer,
}: {
  getActor: () => Promise<QueueAccessActor>;
  release?: typeof callCenter.releaseInboundAnswer;
}) {
  return withCallCenterApiHandler(
    async (request: Request, context: Context) => {
      const callId = (await context.params).callId.trim();
      const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
      if (!callId || !idempotencyKey || idempotencyKey.length > 200) {
        throw new ApiError("Valid call and idempotency key required", 400);
      }
      const body = await parseJsonBody(request, releaseBodySchema);
      return NextResponse.json(
        await release(await getActor(), {
          callId,
          failureCode: body.failureCode,
          idempotencyKey,
          legId: body.legId,
          sessionId: body.sessionId,
        }),
      );
    },
    {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "[portal-call-center] inbound Answer release failed",
      retryable: true,
    },
  );
}
