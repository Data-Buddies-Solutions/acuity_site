import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import { callCenter } from "@/lib/call-center/call-center";
import {
  type StartOutboundCallInput,
  type StartOutboundCallResponse,
} from "@/lib/call-center/application/start-outbound-call";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";
import { createLogger, type LogContext } from "@/lib/logger";

const logger = createLogger("portal-call-center-outbound");

const bodySchema = z
  .object({
    clientInstanceId: z.string().trim().min(1).max(200),
    destination: z.string().trim().min(1).max(40),
    // Accept the retired field while already-loaded clients age out.
    expectedSessionStateVersion: z.number().int().nonnegative().optional(),
    numberId: z.string().trim().min(1).max(200),
    queueId: z.string().trim().min(1).max(200),
  })
  .strict();
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

type Dependencies = {
  getActor: () => Promise<QueueAccessActor>;
  now?: () => number;
  reportTiming?: (context: LogContext) => void;
  start?: (
    actor: QueueAccessActor,
    input: StartOutboundCallInput,
    now?: Date,
  ) => Promise<StartOutboundCallResponse>;
};

function idempotencyKey(request: Request) {
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new ApiError("A valid Idempotency-Key header is required", 400);
  }
  return key;
}

export function createStartOutboundCallHandler({
  getActor,
  now = performance.now.bind(performance),
  reportTiming = (context) => logger.info("outbound-initiation-request", context),
  start = callCenter.startOutbound,
}: Dependencies) {
  return withCallCenterApiHandler(
    async (request: Request) => {
      const startedAt = now();
      const emitTiming = (context: LogContext) => {
        try {
          reportTiming(context);
        } catch {
          // Logging cannot change a successful or failed outbound result.
        }
      };
      try {
        const actor = await getActor();
        const body = await parseJsonBody(request, bodySchema);
        const input: StartOutboundCallInput = {
          clientInstanceId: body.clientInstanceId,
          destination: body.destination,
          idempotencyKey: idempotencyKey(request),
          numberId: body.numberId,
          queueId: body.queueId,
        };
        const receipt = await start(actor, input);
        const durationMs = now() - startedAt;
        emitTiming({ durationMs, phase: "request", resultClass: "success" });
        return NextResponse.json(receipt, {
          headers: {
            "Server-Timing": `outbound-initiation;dur=${durationMs.toFixed(1)}`,
          },
          status: receipt.replayed ? 200 : 201,
        });
      } catch (error) {
        emitTiming({
          durationMs: now() - startedAt,
          phase: "request",
          resultClass: "error",
        });
        throw error;
      }
    },
    {
      errorCode: "OUTBOUND_CALL_FAILED",
      logLabel: "[portal-call-center] Failed to start canonical outbound call",
      retryable: true,
    },
  );
}
