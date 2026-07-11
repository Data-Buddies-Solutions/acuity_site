import type { TelnyxVoiceWebhookEnvelope } from "@/lib/call-center/infrastructure/telnyx-voice-envelope";
import { createLogger } from "@/lib/logger";

const logger = createLogger("call-center-durable-webhook");
const SCHEDULE_ERROR = "canonical_projection_schedule_failed";

type LegacyResult = Record<string, unknown> & { providerWebhookEventId: string };

type Dependencies = {
  processLegacy: (envelope: TelnyxVoiceWebhookEnvelope) => Promise<LegacyResult>;
  scheduleCanonical: (eventId: string) => unknown;
};

/**
 * Legacy projection remains the response/effect owner. Canonical work is
 * scheduled only after legacy completion, and scheduling failures cannot alter
 * the provider acknowledgement or replay legacy effects.
 */
export function createDurableTelnyxWebhookCoordinator({
  processLegacy,
  scheduleCanonical,
}: Dependencies) {
  return async function processDurableTelnyxWebhook(
    envelope: TelnyxVoiceWebhookEnvelope,
  ) {
    const { providerWebhookEventId, ...response } = await processLegacy(envelope);

    try {
      scheduleCanonical(providerWebhookEventId);
    } catch {
      logger.warn("canonical projection scheduling failed", {
        errorCode: SCHEDULE_ERROR,
      });
    }

    return response;
  };
}
