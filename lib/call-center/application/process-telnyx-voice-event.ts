import { handleTelnyxWebhookEvent } from "@/lib/call-center";
import {
  providerWebhookInbox,
  type ProviderWebhookInbox,
  type ProviderWebhookRecord,
} from "@/lib/call-center/infrastructure/provider-webhook-inbox";
import type { TelnyxVoiceWebhookEnvelope } from "@/lib/call-center/infrastructure/telnyx-voice-envelope";
import {
  resolveTelnyxEventOwner,
  TelnyxEventOwnerError,
  type TelnyxEventOwner,
} from "@/lib/call-center/infrastructure/telnyx-event-owner";
import { createLogger } from "@/lib/logger";

const logger = createLogger("call-center-webhook-processor");
const LEGACY_PROJECTION_ERROR = "legacy_projection_failed";
const OWNER_RESOLUTION_ERROR = "event_owner_resolution_failed";
const INBOX_COMPLETION_ERROR = "provider_webhook_completion_failed";

type LegacyProjectionResult = { ignored?: boolean } & Record<string, unknown>;

type TelnyxVoiceEventProcessorDependencies = {
  clock?: () => Date;
  inbox: ProviderWebhookInbox;
  projectLegacyEvent: (body: unknown) => Promise<LegacyProjectionResult>;
  resolveOwner?: (event: ProviderWebhookRecord) => Promise<TelnyxEventOwner>;
};

export class ProviderWebhookProcessingPendingError extends Error {
  readonly status = 503;

  constructor(reason: "PROCESSING" | "RETRY_SCHEDULED") {
    super(
      reason === "PROCESSING"
        ? "Provider webhook processing is already in progress"
        : "Provider webhook retry is scheduled",
    );
    this.name = "ProviderWebhookProcessingPendingError";
  }
}

/**
 * Compatibility boundary: the durable inbox survives the rewrite. Only this
 * legacy projector dependency is deleted when canonical call projection owns processing.
 * Until then processing is deduplicated and at-least-once: a crash after legacy
 * writes but before inbox completion can replay those existing idempotent writes.
 */
export function createTelnyxVoiceEventProcessor({
  clock = () => new Date(),
  inbox,
  projectLegacyEvent,
  resolveOwner = async () => "LEGACY",
}: TelnyxVoiceEventProcessorDependencies) {
  return async function processTelnyxVoiceEvent(envelope: TelnyxVoiceWebhookEnvelope) {
    const received = await inbox.receive(envelope);
    const claim = await inbox.claim(received);

    if (!claim.event) {
      if (claim.decision === "PROCESSING" || claim.decision === "RETRY_SCHEDULED") {
        throw new ProviderWebhookProcessingPendingError(claim.decision);
      }

      if (claim.decision === "EXHAUSTED") {
        const errorCode = received.errorCode ?? "provider_webhook_attempts_exhausted";
        logger.error("webhook processing exhausted", {
          errorCode,
          eventType: received.eventType,
          providerEventId: received.providerEventId,
        });
        return {
          errorCode,
          exhausted: true as const,
          providerWebhookEventId: received.id,
          processingStatus: received.processingStatus,
        };
      }

      logger.info("duplicate webhook skipped", {
        eventType: received.eventType,
        processingStatus: received.processingStatus,
        providerEventId: received.providerEventId,
      });
      return {
        duplicate: true as const,
        providerWebhookEventId: received.id,
        processingStatus: received.processingStatus,
      };
    }

    const event = claim.event;
    let phase: "COMPLETE" | "OWNER" | "PROJECT" = "OWNER";

    try {
      const owner = await resolveOwner(event);
      let result: LegacyProjectionResult;
      if (owner === "CANONICAL") {
        result = { ignored: true, reason: "canonical_owner" };
      } else {
        phase = "PROJECT";
        result = await projectLegacyEvent(event.payload);
      }
      phase = "COMPLETE";
      const processingStatus = result.ignored ? "IGNORED" : "PROCESSED";
      const completed = await inbox.complete({
        attemptCount: event.attemptCount,
        effectOwner: owner,
        eventId: event.id,
        now: clock(),
        status: processingStatus,
      });

      if (!completed) {
        throw new Error("Provider webhook processing claim was lost");
      }

      return {
        ...result,
        duplicate: false as const,
        providerWebhookEventId: received.id,
        processingStatus,
      };
    } catch (error) {
      const errorCode = processingErrorCode(phase, error);
      await markProjectionFailed(inbox, event, errorCode);
      logger.error("webhook processing failed", {
        errorCode,
        eventType: event.eventType,
        providerEventId: event.providerEventId,
      });
      throw error;
    }
  };
}

function processingErrorCode(phase: "COMPLETE" | "OWNER" | "PROJECT", error: unknown) {
  if (phase === "COMPLETE") return INBOX_COMPLETION_ERROR;
  if (phase === "PROJECT") return LEGACY_PROJECTION_ERROR;
  return error instanceof TelnyxEventOwnerError
    ? error.code.slice(0, 100)
    : OWNER_RESOLUTION_ERROR;
}

async function markProjectionFailed(
  inbox: ProviderWebhookInbox,
  event: ProviderWebhookRecord,
  errorCode: string,
) {
  await inbox.fail({
    attemptCount: event.attemptCount,
    errorCode,
    eventId: event.id,
    nextAttemptAt: inbox.retryAt(event.attemptCount),
  });
}

export const processTelnyxVoiceEvent = createTelnyxVoiceEventProcessor({
  inbox: providerWebhookInbox,
  projectLegacyEvent: handleTelnyxWebhookEvent,
  resolveOwner: resolveTelnyxEventOwner,
});
