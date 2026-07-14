import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonBody } from "@/lib/api/handler";
import { ringStationForQueuedCall } from "@/lib/call-center";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";

export const dynamic = "force-dynamic";

const queueTakeSchema = z.object({
  browserSessionId: z.string().trim().min(1, "browserSessionId is required"),
  queueItemId: z.string().trim().min(1, "queueItemId is required"),
  seatId: z.string().trim().min(1, "seatId is required"),
});

export const POST = withCallCenterApiHandler(
  async (request: NextRequest) => {
    const { browserSessionId, queueItemId, seatId } = await parseJsonBody(
      request,
      queueTakeSchema,
    );

    const result = await ringStationForQueuedCall({
      browserSessionId,
      queueItemId,
      seatId,
    });

    return NextResponse.json(result);
  },
  {
    errorCode: "TEMPORARY_SERVICE_FAILURE",
    logLabel: "[portal-call-center] Failed to take queued call",
    retryable: true,
  },
);
