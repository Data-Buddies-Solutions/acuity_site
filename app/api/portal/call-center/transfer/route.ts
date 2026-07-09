import { NextResponse } from "next/server";

import { parseJsonBody, withApiHandler } from "@/lib/api/handler";
import { blindTransferActiveCallToSeat } from "@/lib/call-center";

export const dynamic = "force-dynamic";

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export const POST = withApiHandler(
  async (request: Request) => {
    const body = await parseJsonBody(request);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const input = body as Record<string, unknown>;
    const browserSessionId = asString(input.browserSessionId);
    const sourceCallControlId = asString(input.sourceCallControlId);
    const targetSeatId = asString(input.targetSeatId);

    if (!sourceCallControlId || !targetSeatId) {
      return NextResponse.json(
        {
          error: "sourceCallControlId and targetSeatId are required",
        },
        { status: 400 },
      );
    }

    const result = await blindTransferActiveCallToSeat({
      browserSessionId,
      sourceCallControlId,
      targetSeatId,
    });

    return NextResponse.json(result);
  },
  {
    errorMessage: "Failed to transfer call",
    logLabel: "[portal-call-center] Failed to transfer call",
  },
);
