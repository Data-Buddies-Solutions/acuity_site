import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonBody } from "@/lib/api/handler";
import { takePendingBlindTransfer } from "@/lib/call-center";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";

export const dynamic = "force-dynamic";

const transferTakeSchema = z.object({
  browserSessionId: z.string().trim().min(1, "browserSessionId is required"),
  queueItemId: z.string().trim().min(1, "queueItemId is required"),
  seatId: z.string().trim().min(1, "seatId is required"),
});

export const POST = withCallCenterApiHandler(
  async (request: NextRequest) => {
    const { browserSessionId, queueItemId, seatId } = await parseJsonBody(
      request,
      transferTakeSchema,
    );

    const result = await takePendingBlindTransfer({
      browserSessionId,
      queueItemId,
      seatId,
    });

    return NextResponse.json(result);
  },
  {
    errorCode: "TEMPORARY_SERVICE_FAILURE",
    logLabel: "[portal-call-center] Failed to take transfer",
    retryable: true,
  },
);
