import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import {
  transferCall,
  type TransferCallInput,
} from "@/lib/call-center/application/transfer-call";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { resolveCallCenterActivationConfig } from "@/lib/call-center/infrastructure/call-center-activation-config";
import { prismaTransferCallStore } from "@/lib/call-center/infrastructure/prisma-transfer-call-store";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";

const bodySchema = z.object({ targetUserId: z.string().trim().min(1).max(200) }).strict();
const paramsSchema = z.object({ callId: z.string().trim().min(1).max(200) });
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

type RouteContext = { params: Promise<{ callId: string }> };
type Dependencies = {
  getActor: () => Promise<QueueAccessActor>;
  isCanonicalActive?: () => boolean;
  scheduleCommand?: (commandId: string) => void;
  transfer?: typeof transferCall;
};

function idempotencyKey(request: Request) {
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new ApiError("A valid Idempotency-Key header is required", 400);
  }
  return key;
}

export function createTransferCallHandler({
  getActor,
  isCanonicalActive = () => resolveCallCenterActivationConfig().enabled,
  scheduleCommand,
  transfer = transferCall,
}: Dependencies) {
  return withCallCenterApiHandler(
    async (request: Request, routeContext: RouteContext) => {
      const actor = await getActor();
      if (!isCanonicalActive()) {
        throw new ApiError("Canonical call center is not active", 409);
      }
      const parameters = paramsSchema.safeParse(await routeContext.params);
      if (!parameters.success) throw new ApiError("A valid call ID is required", 400);
      const body = await parseJsonBody(request, bodySchema);
      const input: TransferCallInput = {
        callId: parameters.data.callId,
        idempotencyKey: idempotencyKey(request),
        targetUserId: body.targetUserId,
      };
      const receipt = await transfer(prismaTransferCallStore, actor, input);
      if (receipt.status === "PENDING") {
        scheduleCommand?.(receipt.providerCommandId);
      }
      return NextResponse.json(receipt, { status: receipt.replayed ? 200 : 202 });
    },
    {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "[portal-call-center] Failed to transfer canonical call",
      retryable: true,
    },
  );
}
