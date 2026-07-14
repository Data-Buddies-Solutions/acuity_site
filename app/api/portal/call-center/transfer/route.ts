import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonBody } from "@/lib/api/handler";
import { blindTransferActiveCallToSeat } from "@/lib/call-center";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";

export const dynamic = "force-dynamic";

const transferSchema = z.object({
  browserSessionId: z.string().trim().optional().default(""),
  sourceCallControlId: z.string().trim().min(1, "sourceCallControlId is required"),
  targetSeatId: z.string().trim().min(1, "targetSeatId is required"),
});

export const POST = withCallCenterApiHandler(
  async (request: NextRequest) => {
    const { browserSessionId, sourceCallControlId, targetSeatId } = await parseJsonBody(
      request,
      transferSchema,
    );

    const result = await blindTransferActiveCallToSeat({
      browserSessionId,
      sourceCallControlId,
      targetSeatId,
    });

    return NextResponse.json(result);
  },
  {
    errorCode: "TEMPORARY_SERVICE_FAILURE",
    logLabel: "[portal-call-center] Failed to transfer call",
    retryable: true,
  },
);
