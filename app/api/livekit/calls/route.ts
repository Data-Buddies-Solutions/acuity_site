import { NextRequest, NextResponse } from "next/server";

import {
  CallIngestionError,
  ingestLiveKitCallPayload,
} from "@/lib/call-ingestion";
import type { LiveKitWebhookPayload } from "@/lib/call-types";

export const dynamic = "force-dynamic";

function getWebhookSecret() {
  return process.env.LIVEKIT_FORWARD_SYNC_SECRET || process.env.WEBHOOK_SECRET;
}

function isAuthorized(request: NextRequest) {
  const secret = getWebhookSecret();

  if (!secret && process.env.NODE_ENV === "production") {
    return false;
  }

  if (!secret) {
    return true;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("callId" in body)) {
    return NextResponse.json({ error: "Missing callId" }, { status: 400 });
  }

  try {
    const result = await ingestLiveKitCallPayload(body as LiveKitWebhookPayload);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CallIngestionError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    console.error("[livekit-call-ingestion] Failed to store call", error);
    return NextResponse.json(
      { error: "Failed to store call" },
      { status: 500 },
    );
  }
}
