import { NextRequest, NextResponse } from "next/server";

import {
  ingestLiveKitWebhook,
  LiveKitWebhookIngestionError,
} from "@/lib/livekit-webhooks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  try {
    const result = await ingestLiveKitWebhook(
      rawBody,
      request.headers.get("authorization"),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof LiveKitWebhookIngestionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[livekit-webhook] Failed to store event", error);
    return NextResponse.json({ error: "Failed to store webhook" }, { status: 500 });
  }
}
