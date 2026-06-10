import { NextResponse } from "next/server";

import { takePendingBlindTransfer } from "@/lib/call-center";
import { TelnyxError } from "@/lib/telnyx";

export const dynamic = "force-dynamic";

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

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

  try {
    const result = await takePendingBlindTransfer({
      browserSessionId,
      queueItemId,
      seatId,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TelnyxError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[portal-call-center] Failed to take transfer", error);
    return NextResponse.json({ error: "Failed to take transfer" }, { status: 500 });
  }
}
