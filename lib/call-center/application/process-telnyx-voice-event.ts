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
const OWNER_RESOLUTION_ERROR = "event_owner_resolution_failed";
const INBOX_COMPLETION_ERROR = "provider_webhook_completion_failed";
const TERMINAL_DIRECT_HANDOFF_ERRORS = new Set([
  "TELNYX_DIRECT_HANDOFF_CORRELATION_AMBIGUOUS",
  "TELNYX_DIRECT_HANDOFF_IDENTITY_INVALID",
  "TELNYX_DIRECT_HANDOFF_NOT_FOUND",
  "TELNYX_DIRECT_HANDOFF_NOT_TRANSFERABLE",
  "TELNYX_DIRECT_HANDOFF_PROVIDER_IDENTITY_INVALID",
  "TELNYX_DIRECT_HANDOFF_ROUTE_CHANGED",
  "TELNYX_DIRECT_HANDOFF_TOKEN_INVALID",
]);

type TelnyxVoiceEventProcessorDependencies = {
  clock?: () => Date;
  inbox: ProviderWebhookInbox;
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

/** Claims one durable provider event and persists its immutable admission. */
export function createTelnyxVoiceEventProcessor({
  clock = () => new Date(),
  inbox,
  resolveOwner = async () => "CANONICAL",
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
    let phase: "COMPLETE" | "OWNER" = "OWNER";

    try {
      const owner = await resolveOwner(event);
      const result = {
        ignored: true,
        reason: owner === "CANONICAL" ? "canonical_owner" : "out_of_scope",
      };
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
      if (
        phase === "OWNER" &&
        error instanceof TelnyxEventOwnerError &&
        TERMINAL_DIRECT_HANDOFF_ERRORS.has(error.code)
      ) {
        const completed = await inbox.complete({
          attemptCount: event.attemptCount,
          effectOwner: null,
          errorCode: error.code,
          eventId: event.id,
          now: clock(),
          status: "IGNORED",
        });
        if (!completed) {
          await markProjectionFailed(inbox, event, INBOX_COMPLETION_ERROR);
          throw new Error("Provider webhook processing claim was lost");
        }
        return {
          duplicate: false as const,
          ignored: true as const,
          providerWebhookEventId: received.id,
          processingStatus: "IGNORED" as const,
          reason: error.code,
        };
      }
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

function processingErrorCode(phase: "COMPLETE" | "OWNER", error: unknown) {
  if (phase === "COMPLETE") return INBOX_COMPLETION_ERROR;
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
  resolveOwner: resolveTelnyxEventOwner,
});
