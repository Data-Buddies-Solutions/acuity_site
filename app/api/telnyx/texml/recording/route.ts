import { NextRequest, NextResponse } from "next/server";

import { recordTexmlVoicemailCallback } from "@/lib/call-center";
import { verifyTelnyxWebhookSignature } from "@/lib/telnyx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function paramsFromSearchParams(searchParams: URLSearchParams) {
  return Object.fromEntries(searchParams.entries());
}

function hasTelnyxSignature(request: NextRequest) {
  return Boolean(
    request.headers.get("telnyx-signature-ed25519") &&
    request.headers.get("telnyx-timestamp"),
  );
}

export async function POST(request: NextRequest) {
  const body = await request.text();

  if (
    hasTelnyxSignature(request) &&
    !verifyTelnyxWebhookSignature({
      rawBody: body,
      signature: request.headers.get("telnyx-signature-ed25519"),
      timestamp: request.headers.get("telnyx-timestamp"),
    })
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  await recordTexmlVoicemailCallback(paramsFromSearchParams(new URLSearchParams(body)));

  return NextResponse.json({ ok: true });
}
