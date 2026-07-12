import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody, withApiHandler } from "@/lib/api/handler";
import {
  startOutboundCall,
  type StartOutboundCallInput,
} from "@/lib/call-center/application/start-outbound-call";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { prismaStartOutboundCallStore } from "@/lib/call-center/infrastructure/prisma-start-outbound-call-store";

const bodySchema = z
  .object({
    clientInstanceId: z.string().trim().min(1).max(200),
    destination: z.string().trim().min(1).max(40),
    endpointId: z.string().trim().min(1).max(200),
    expectedSessionStateVersion: z.number().int().nonnegative(),
    numberId: z.string().trim().min(1).max(200),
    queueId: z.string().trim().min(1).max(200),
  })
  .strict();
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

type Dependencies = {
  getActor: () => Promise<QueueAccessActor>;
  start?: typeof startOutboundCall;
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
  start = startOutboundCall,
}: Dependencies) {
  return withApiHandler(
    async (request: Request) => {
      const actor = await getActor();
      const body = await parseJsonBody(request, bodySchema);
      const input: StartOutboundCallInput = {
        ...body,
        idempotencyKey: idempotencyKey(request),
      };
      const receipt = await start(prismaStartOutboundCallStore, actor, input);
      return NextResponse.json(receipt, { status: receipt.replayed ? 200 : 201 });
    },
    {
      errorMessage: "Failed to start canonical outbound call",
      logLabel: "[portal-call-center] Failed to start canonical outbound call",
    },
  );
}
