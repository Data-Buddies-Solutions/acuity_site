import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonBody, withApiHandler } from "@/lib/api/handler";
import { takePendingBlindTransfer } from "@/lib/call-center";

export const dynamic = "force-dynamic";

const transferTakeSchema = z.object({
  browserSessionId: z.string().trim().min(1, "browserSessionId is required"),
  queueItemId: z.string().trim().min(1, "queueItemId is required"),
  seatId: z.string().trim().min(1, "seatId is required"),
});

export const POST = withApiHandler(
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
    errorMessage: "Failed to take transfer",
    logLabel: "[portal-call-center] Failed to take transfer",
  },
);
