import { NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonBody, withApiHandler } from "@/lib/api/handler";
import { ringStationForQueuedCall } from "@/lib/call-center";

export const dynamic = "force-dynamic";

const queueTakeSchema = z.object({
  browserSessionId: z.string().trim().min(1, "browserSessionId is required"),
  queueItemId: z.string().trim().min(1, "queueItemId is required"),
  seatId: z.string().trim().min(1, "seatId is required"),
});

export const POST = withApiHandler(
  async (request: Request) => {
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
    errorMessage: "Failed to take queued call",
    logLabel: "[portal-call-center] Failed to take queued call",
  },
);
