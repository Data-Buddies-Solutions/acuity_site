import { NextResponse } from "next/server";

import { blindTransferActiveCallToSeat } from "@/lib/call-center";
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

  try {
    const result = await blindTransferActiveCallToSeat({
      browserSessionId,
      sourceCallControlId,
      targetSeatId,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TelnyxError) {
      return NextResponse.json(
        { detail: error.detail, error: error.message },
        { status: error.status },
      );
    }

    console.error("[portal-call-center] Failed to transfer call", error);
    return NextResponse.json({ error: "Failed to transfer call" }, { status: 500 });
  }
}
