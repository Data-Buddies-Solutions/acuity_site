import { after, NextRequest, NextResponse } from "next/server";

import { ApiError, withApiHandler } from "@/lib/api/handler";
import {
  processTelnyxVoiceEvent,
  providerEventErrorCode,
} from "@/lib/call-center/application/process-telnyx-voice-event";
import { providerWebhookInbox } from "@/lib/call-center/infrastructure/provider-webhook-inbox";
import { parseTelnyxVoiceWebhookEnvelope } from "@/lib/call-center/infrastructure/telnyx-voice-envelope";
import { createLogger } from "@/lib/logger";
import { handleTelnyxSmsWebhookEvent, isTelnyxSmsEvent } from "@/lib/sms/service";
import { verifyTelnyxWebhookSignature } from "@/lib/telnyx";

const logger = createLogger("telnyx-webhook");

export function createTelnyxWebhookHandler({
  defer = after,
  handleSms = handleTelnyxSmsWebhookEvent,
  isSms = isTelnyxSmsEvent,
  parseVoiceEnvelope = parseTelnyxVoiceWebhookEnvelope,
  processProviderRecord = processTelnyxVoiceEvent.processRecord,
  receiveProviderEvent = providerWebhookInbox.receive,
  verifySignature = verifyTelnyxWebhookSignature,
}: {
  defer?: typeof after;
  handleSms?: typeof handleTelnyxSmsWebhookEvent;
  isSms?: typeof isTelnyxSmsEvent;
  parseVoiceEnvelope?: typeof parseTelnyxVoiceWebhookEnvelope;
  processProviderRecord?: typeof processTelnyxVoiceEvent.processRecord;
  receiveProviderEvent?: typeof providerWebhookInbox.receive;
  verifySignature?: typeof verifyTelnyxWebhookSignature;
} = {}) {
  return withApiHandler(
    async (request: NextRequest) => {
      const rawBody = await request.text();
      const verified = verifySignature({
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

      if (isSms(body)) {
        result = await handleSms(body);
      } else {
        const received = await receiveProviderEvent(parseVoiceEnvelope(body));
        defer(async () => {
          try {
            await processProviderRecord(received);
          } catch (error) {
            logger.error("deferred provider event processing failed", {
              errorCode: providerEventErrorCode(error),
              providerEventId: received.providerEventId,
            });
          }
        });
        result = {
          durable: true,
          processingStatus: received.processingStatus,
        };
      }

      return NextResponse.json({ ok: true, ...result });
    },
    {
      errorMessage: "Failed to process webhook",
      logLabel: "[telnyx-webhook] Failed to process event",
    },
  );
}
