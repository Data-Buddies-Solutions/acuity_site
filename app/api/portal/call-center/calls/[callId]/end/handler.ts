import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody, withApiHandler } from "@/lib/api/handler";
import { endCall, type EndCallInput } from "@/lib/call-center/application/end-call";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { resolveCallCenterActivationConfig } from "@/lib/call-center/infrastructure/call-center-activation-config";
import { prismaEndCallStore } from "@/lib/call-center/infrastructure/prisma-end-call-store";

const bodySchema = z.object({ clientInstanceId: z.string().trim().min(1).max(200) });
const paramsSchema = z.object({ callId: z.string().trim().min(1).max(200) });

type RouteContext = { params: Promise<{ callId: string }> };

export function createEndCallHandler({
  end = endCall,
  getActor,
  isCanonicalActive = () => resolveCallCenterActivationConfig().enabled,
  scheduleCommand,
}: {
  end?: typeof endCall;
  getActor: () => Promise<QueueAccessActor>;
  isCanonicalActive?: () => boolean;
  scheduleCommand?: (commandId: string) => void;
}) {
  return withApiHandler(
    async (request: Request, routeContext: RouteContext) => {
      const actor = await getActor();
      if (!isCanonicalActive()) {
        throw new ApiError("Canonical call center is not active", 409);
      }
      const parameters = paramsSchema.safeParse(await routeContext.params);
      if (!parameters.success) throw new ApiError("A valid call ID is required", 400);
      const key = request.headers.get("Idempotency-Key")?.trim();
      if (!key || key.length > 200) {
        throw new ApiError("A valid Idempotency-Key header is required", 400);
      }
      const body = await parseJsonBody(request, bodySchema);
      const input: EndCallInput = {
        callId: parameters.data.callId,
        clientInstanceId: body.clientInstanceId,
        idempotencyKey: key,
      };
      const receipt = await end(prismaEndCallStore, actor, input);
      const commandIds = JSON.parse(receipt.commandIdsJson) as unknown;
      if (Array.isArray(commandIds)) {
        commandIds.forEach((commandId) => {
          if (typeof commandId === "string") scheduleCommand?.(commandId);
        });
      }
      return NextResponse.json(receipt, { status: receipt.replayed ? 200 : 202 });
    },
    {
      errorMessage: "Failed to end canonical call",
      logLabel: "[portal-call-center] Failed to end canonical call",
    },
  );
}
