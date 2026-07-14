import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import { claimCall, type ClaimCallInput } from "@/lib/call-center/application/claim-call";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { resolveCallCenterActivationConfig } from "@/lib/call-center/infrastructure/call-center-activation-config";
import { prismaClaimCallStore } from "@/lib/call-center/infrastructure/prisma-claim-call-store";
import {
  CallCenterOperatorError,
  withCallCenterApiHandler,
} from "@/lib/call-center/operator-error-response";

const bodySchema = z
  .object({
    clientInstanceId: z.string().trim().min(1).max(200),
    expectedSessionStateVersion: z.number().int().nonnegative(),
  })
  .strict();
const paramsSchema = z.object({ callId: z.string().trim().min(1).max(200) });
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

type RouteContext = { params: Promise<{ callId: string }> };
type Dependencies = {
  claim?: typeof claimCall;
  getActor: () => Promise<QueueAccessActor>;
  isCanonicalActive?: () => boolean;
  scheduleCommand?: (commandId: string) => void;
};

function idempotencyKey(request: Request) {
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new ApiError("A valid Idempotency-Key header is required", 400);
  }
  return key;
}

export function createClaimCallHandler({
  claim = claimCall,
  getActor,
  isCanonicalActive = () => resolveCallCenterActivationConfig().enabled,
  scheduleCommand,
}: Dependencies) {
  return withCallCenterApiHandler(
    async (request: Request, routeContext: RouteContext) => {
      const actor = await getActor();
      if (!isCanonicalActive()) {
        throw new ApiError("Canonical call center is not active", 409);
      }
      const parameters = paramsSchema.safeParse(await routeContext.params);
      if (!parameters.success) throw new ApiError("A valid call ID is required", 400);
      const { callId } = parameters.data;
      const body = await parseJsonBody(request, bodySchema);
      const input: ClaimCallInput = {
        ...body,
        callId,
        idempotencyKey: idempotencyKey(request),
      };
      const receipt = await claim(prismaClaimCallStore, actor, input);
      if (receipt.status === "ALREADY_CLAIMED") {
        throw new CallCenterOperatorError("CALL_ALREADY_CLAIMED", 409);
      }
      if (receipt.status === "PENDING") {
        scheduleCommand?.(receipt.providerCommandId);
      }

      return NextResponse.json(receipt, { status: receipt.replayed ? 200 : 202 });
    },
    {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "[portal-call-center] Failed to claim canonical call",
      retryable: true,
    },
  );
}
