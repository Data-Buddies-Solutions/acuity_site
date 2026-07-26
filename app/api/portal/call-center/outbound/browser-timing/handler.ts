import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";
import { createLogger, type LogContext } from "@/lib/logger";

const logger = createLogger("portal-call-center-outbound");

const bodySchema = z
  .object({
    callId: z.string().trim().min(1).max(200).optional(),
    durationMs: z.number().finite().nonnegative().max(600_000),
    operationKey: z.string().trim().min(1).max(200),
    resultClass: z.enum(["error", "success"]),
  })
  .strict();

type Dependencies = {
  getActor: () => Promise<QueueAccessActor>;
  reportTiming?: (context: LogContext) => void;
  verifyCall?: (actor: QueueAccessActor, callId: string) => Promise<boolean>;
};

export function createOutboundBrowserTimingHandler({
  getActor,
  reportTiming = (context) => logger.info("outbound-initiation-browser", context),
  verifyCall = async () => true,
}: Dependencies) {
  return withCallCenterApiHandler(
    async (request: Request) => {
      const actor = await getActor();
      const body = await parseJsonBody(request, bodySchema);
      if (body.callId && !(await verifyCall(actor, body.callId))) {
        throw new ApiError("Outbound call not found", 404);
      }
      try {
        reportTiming({
          browserDurationMs: body.durationMs,
          callId: body.callId ?? null,
          operationKey: body.operationKey,
          phase: "browser-request",
          practiceId: actor.practiceId,
          resultClass: body.resultClass,
        });
      } catch {
        // Telemetry cannot change the completed browser call action.
      }
      return new NextResponse(null, { status: 204 });
    },
    {
      errorCode: "OUTBOUND_CALL_FAILED",
      logLabel: "[portal-call-center] Failed to retain outbound browser timing",
      retryable: false,
    },
  );
}
