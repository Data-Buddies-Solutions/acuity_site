import { NextResponse } from "next/server";

import { parseJsonBody, withApiHandler } from "@/lib/api/handler";
import { ringStationForQueuedCall } from "@/lib/call-center";

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
    const queueItemId = asString(input.queueItemId);
    const seatId = asString(input.seatId);

    if (!browserSessionId || !queueItemId || !seatId) {
      return NextResponse.json(
        { error: "browserSessionId, queueItemId, and seatId are required" },
        { status: 400 },
      );
    }

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
