import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import { dispatchProviderCommandGraph } from "@/lib/call-center/application/dispatch-provider-command";
import { dispatchProviderCommand } from "@/lib/call-center/application/provider-command-runtime";
import {
  listTransferTargets,
  transferAgentCall,
  TransferAgentCallError,
  type TransferAgentCallInput,
} from "@/lib/call-center/application/transfer-agent-call";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { prismaTransferAgentCallStore } from "@/lib/call-center/infrastructure/prisma-transfer-agent-call-store";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";

const bodySchema = z
  .object({
    clientInstanceId: z.string().trim().min(1).max(200),
    expectedStateVersion: z.number().int().nonnegative(),
    targetEndpointId: z.string().trim().min(1).max(200),
  })
  .strict();
type Context = { params: Promise<{ callId: string }> };

type Dependencies = {
  dispatch?: typeof dispatchProviderCommand;
  getActor: () => Promise<QueueAccessActor>;
  list?: typeof listTransferTargets;
  save?: typeof transferAgentCall;
};

function callIdFrom(context: Context) {
  return context.params.then(({ callId }) => {
    const value = callId.trim();
    if (!value) throw new ApiError("Valid call required", 400);
    return value;
  });
}

export function createTransferTargetsHandler({
  getActor,
  list = listTransferTargets,
}: Dependencies) {
  return withCallCenterApiHandler(
    async (request: Request, context: Context) => {
      const clientInstanceId = new URL(request.url).searchParams
        .get("clientInstanceId")
        ?.trim();
      if (!clientInstanceId || clientInstanceId.length > 200) {
        throw new ApiError("Valid phone session required", 400);
      }
      const targets = await list(prismaTransferAgentCallStore, await getActor(), {
        callId: await callIdFrom(context),
        clientInstanceId,
      });
      return NextResponse.json({ targets });
    },
    {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "[portal-call-center] transfer targets failed",
      retryable: true,
    },
  );
}

export function createTransferAgentHandler({
  dispatch = dispatchProviderCommand,
  getActor,
  save = transferAgentCall,
}: Dependencies) {
  return withCallCenterApiHandler(
    async (request: Request, context: Context) => {
      const key = request.headers.get("Idempotency-Key")?.trim();
      if (!key || key.length > 200) {
        throw new ApiError("A valid Idempotency-Key header is required", 400);
      }
      const body = await parseJsonBody(request, bodySchema);
      const input: TransferAgentCallInput = {
        ...body,
        callId: await callIdFrom(context),
        idempotencyKey: key,
      };
      const receipt = await save(prismaTransferAgentCallStore, await getActor(), input);
      const result = await dispatch(receipt.commandId);
      if (result.status === "FAILED" || result.status === "REJECTED") {
        await dispatchProviderCommandGraph({
          commandIds: result.followUpCommandIds,
          dispatch,
        });
        throw new TransferAgentCallError("Transfer could not be started", 409);
      }
      return NextResponse.json(receipt, { status: receipt.replayed ? 200 : 202 });
    },
    {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "[portal-call-center] transfer failed",
      retryable: true,
    },
  );
}
