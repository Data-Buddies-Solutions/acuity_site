import { NextRequest, NextResponse } from "next/server";

import { ApiError, withApiHandler } from "@/lib/api/handler";
import { handleTelnyxWebhookEvent } from "@/lib/call-center";
import { handleTelnyxSmsWebhookEvent, isTelnyxSmsEvent } from "@/lib/sms/service";
import { verifyTelnyxWebhookSignature } from "@/lib/telnyx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withApiHandler(
  async (request: NextRequest) => {
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
      throw new ApiError("Invalid JSON", 400);
    }

    const result = isTelnyxSmsEvent(body)
      ? await handleTelnyxSmsWebhookEvent(body)
      : await handleTelnyxWebhookEvent(body);
    return NextResponse.json({ ok: true, ...result });
  },
  {
    errorMessage: "Failed to process webhook",
    logLabel: "[telnyx-webhook] Failed to process event",
  },
);
