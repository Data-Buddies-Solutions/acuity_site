import { after, NextRequest, NextResponse } from "next/server";

import { ApiError, withApiHandler } from "@/lib/api/handler";
import { handleTelnyxWebhookEvent } from "@/lib/call-center";
import { createDurableTelnyxWebhookCoordinator } from "@/lib/call-center/application/process-durable-telnyx-webhook";
import { processTelnyxVoiceEvent } from "@/lib/call-center/application/process-telnyx-voice-event";
import { scheduleImmediateCanonicalProjection } from "@/lib/call-center/application/schedule-canonical-telnyx-event";
import { resolveDurableWebhookIngressConfig } from "@/lib/call-center/infrastructure/durable-ingress-config";
import { parseTelnyxVoiceWebhookEnvelope } from "@/lib/call-center/infrastructure/telnyx-voice-envelope";
import { handleTelnyxSmsWebhookEvent, isTelnyxSmsEvent } from "@/lib/sms/service";
import { verifyTelnyxWebhookSignature } from "@/lib/telnyx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const processDurableTelnyxWebhook = createDurableTelnyxWebhookCoordinator({
  processLegacy: processTelnyxVoiceEvent,
  scheduleCanonical: (eventId) => scheduleImmediateCanonicalProjection(eventId, after),
});

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

    let result: Record<string, unknown>;

    if (isTelnyxSmsEvent(body)) {
      result = await handleTelnyxSmsWebhookEvent(body);
    } else if (resolveDurableWebhookIngressConfig().enabled) {
      result = await processDurableTelnyxWebhook(parseTelnyxVoiceWebhookEnvelope(body));
    } else {
      result = await handleTelnyxWebhookEvent(body);
    }

    return NextResponse.json({ ok: true, ...result });
  },
  {
    errorMessage: "Failed to process webhook",
    logLabel: "[telnyx-webhook] Failed to process event",
  },
);
