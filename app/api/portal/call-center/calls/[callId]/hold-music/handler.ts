import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import { type SetCallHoldMusicInput } from "@/lib/call-center/application/set-call-hold-music";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { callCenter } from "@/lib/call-center/call-center";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";

const bodySchema = z
  .object({
    action: z.enum(["START", "STOP"]),
  })
  .strict();
type Context = { params: Promise<{ callId: string }> };

type Dependencies = {
  getActor: () => Promise<QueueAccessActor>;
  set?: (
    actor: QueueAccessActor,
    input: SetCallHoldMusicInput,
  ) => ReturnType<typeof callCenter.setHoldMusic>;
};

export function createHoldMusicHandler({
  getActor,
  set = callCenter.setHoldMusic,
}: Dependencies) {
  return withCallCenterApiHandler(
    async (request: Request, context: Context) => {
      const callId = (await context.params).callId.trim();
      const key = request.headers.get("Idempotency-Key")?.trim();
      if (!callId || !key || key.length > 200) {
        throw new ApiError("Valid call and idempotency key required", 400);
      }
      const body = await parseJsonBody(request, bodySchema);
      const receipt = await set(await getActor(), {
        action: body.action,
        callId,
        idempotencyKey: key,
      });
      return NextResponse.json(receipt, { status: receipt.replayed ? 200 : 202 });
    },
    {
      errorCode: "PROVIDER_UNAVAILABLE",
      logLabel: "[portal-call-center] hold music failed",
      retryable: true,
    },
  );
}
