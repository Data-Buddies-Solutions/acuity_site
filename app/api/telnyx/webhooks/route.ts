import { NextRequest, NextResponse } from "next/server";

import { handleTelnyxWebhookEvent } from "@/lib/call-center";
import { verifyTelnyxWebhookSignature } from "@/lib/telnyx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const verified = verifyTelnyxWebhookSignature({
    rawBody,
    signature: request.headers.get("telnyx-signature-ed25519"),
    timestamp: request.headers.get("telnyx-timestamp"),
  });

  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: unknown;

  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await handleTelnyxWebhookEvent(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[telnyx-webhook] Failed to process event", error);
    return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 });
  }
}
