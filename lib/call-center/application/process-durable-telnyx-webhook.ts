import type { TelnyxVoiceWebhookEnvelope } from "@/lib/call-center/infrastructure/telnyx-voice-envelope";
import { createLogger } from "@/lib/logger";

const logger = createLogger("call-center-durable-webhook");
const SCHEDULE_ERROR = "canonical_projection_schedule_failed";

type InboxResult = Record<string, unknown> & { providerWebhookEventId: string };

type Dependencies = {
  processInbox: (envelope: TelnyxVoiceWebhookEnvelope) => Promise<InboxResult>;
  scheduleCanonical: (eventId: string) => unknown;
};

/**
 * The durable inbox commits before canonical projection is scheduled.
 * Scheduling failures cannot alter provider acknowledgement; recovery owns
 * every committed event that is not processed immediately.
 */
export function createDurableTelnyxWebhookCoordinator({
  processInbox,
  scheduleCanonical,
}: Dependencies) {
  return async function processDurableTelnyxWebhook(
    envelope: TelnyxVoiceWebhookEnvelope,
  ) {
    const { providerWebhookEventId, ...response } = await processInbox(envelope);

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
