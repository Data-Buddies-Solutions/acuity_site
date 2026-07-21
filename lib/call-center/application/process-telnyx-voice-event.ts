import { dispatchProviderCommandGraph } from "@/lib/call-center/application/dispatch-provider-command";
import { dispatchProviderCommand } from "@/lib/call-center/application/provider-command-runtime";
import {
  CanonicalProjectionError,
  prismaCanonicalCallProjector,
  type CanonicalCallProjector,
} from "@/lib/call-center/infrastructure/prisma-canonical-call-projector";
import {
  PROVIDER_WEBHOOK_MAX_ATTEMPTS,
  providerWebhookInbox,
  type ProviderWebhookInbox,
  type ProviderWebhookRecord,
} from "@/lib/call-center/infrastructure/provider-webhook-inbox";
import {
  admitTelnyxEvent,
  TelnyxEventAdmissionError,
} from "@/lib/call-center/infrastructure/prisma-telnyx-event-admission";
import {
  CanonicalTelnyxFactError,
  parseCanonicalTelnyxCallFact,
} from "@/lib/call-center/infrastructure/telnyx-canonical-call-fact";
import type { TelnyxVoiceWebhookEnvelope } from "@/lib/call-center/infrastructure/telnyx-voice-envelope";
import { createLogger } from "@/lib/logger";

const logger = createLogger("call-center-provider-event");
const MAX_ERROR_CODE_LENGTH = 100;
const TERMINAL_ADMISSION_ERRORS = new Set([
  "TELNYX_DIRECT_HANDOFF_CORRELATION_AMBIGUOUS",
  "TELNYX_DIRECT_HANDOFF_IDENTITY_INVALID",
  "TELNYX_DIRECT_HANDOFF_NOT_FOUND",
  "TELNYX_DIRECT_HANDOFF_NOT_TRANSFERABLE",
  "TELNYX_DIRECT_HANDOFF_PROVIDER_IDENTITY_INVALID",
  "TELNYX_DIRECT_HANDOFF_ROUTE_CHANGED",
  "TELNYX_DIRECT_HANDOFF_TOKEN_INVALID",
  "TELNYX_EVENT_OUT_OF_SCOPE",
]);

type ProviderEventInbox = Pick<
  ProviderWebhookInbox,
  "claim" | "completeIgnored" | "fail" | "receive" | "retryAt"
>;

type Dependencies = {
  admit(event: ProviderWebhookRecord): Promise<unknown>;
  clock?: () => Date;
  dispatchCommand?: typeof dispatchProviderCommand;
  inbox: ProviderEventInbox;
  projector: CanonicalCallProjector;
};

class ProviderWebhookProcessingPendingError extends Error {
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

async function dispatchCommittedCommands(
  projection: Awaited<ReturnType<CanonicalCallProjector["projectAndComplete"]>>,
  dispatch: typeof dispatchProviderCommand,
) {
  if (projection.commandIds.length === 0) return;

  const result = await dispatchProviderCommandGraph({
    commandIds: projection.commandIds,
    dispatch,
  });
  for (const failure of result.failures) {
    logger.error("provider command failed", failure);
  }
  for (const commandId of result.deferred) {
    logger.warn("provider command not dispatched", { commandId });
  }
}

export function providerEventErrorCode(error: unknown) {
  if (
    error instanceof CanonicalProjectionError ||
    error instanceof CanonicalTelnyxFactError ||
    error instanceof TelnyxEventAdmissionError
  ) {
    return error.code.slice(0, MAX_ERROR_CODE_LENGTH);
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^P\d{4}$/.test(error.code)
  ) {
    return `CANONICAL_PRISMA_${error.code}`;
  }
  return "PROVIDER_EVENT_FAILED";
}

export function createTelnyxVoiceEventProcessor({
  admit,
  clock = () => new Date(),
  dispatchCommand = dispatchProviderCommand,
  inbox,
  projector,
}: Dependencies) {
  async function processRecord(received: ProviderWebhookRecord) {
    const claim = await inbox.claim(received);

    if (!claim.event) {
      if (claim.decision === "PROCESSING" || claim.decision === "RETRY_SCHEDULED") {
        throw new ProviderWebhookProcessingPendingError(claim.decision);
      }
      if (claim.decision === "EXHAUSTED") {
        const errorCode = received.errorCode ?? "PROVIDER_EVENT_RETRIES_EXHAUSTED";
        logger.error("provider event attempts exhausted", {
          errorCode,
          eventType: received.eventType,
          providerEventId: received.providerEventId,
        });
        return {
          duplicate: false as const,
          errorCode,
          outcome: "FAILED" as const,
          providerWebhookEventId: received.id,
        };
      }
      return {
        duplicate: true as const,
        outcome: received.processingStatus as "IGNORED" | "PROCESSED",
        providerWebhookEventId: received.id,
      };
    }

    const event = claim.event;
    try {
      await admit(event);
      const fact = parseCanonicalTelnyxCallFact(event.payload, event.receivedAt);
      if (!fact) {
        const completed = await inbox.completeIgnored({
          attemptCount: event.attemptCount,
          eventId: event.id,
          now: clock(),
        });
        if (!completed) throw new CanonicalProjectionError("PROVIDER_EVENT_CLAIM_LOST");
        return {
          duplicate: false as const,
          outcome: "IGNORED" as const,
          providerWebhookEventId: event.id,
        };
      }

      const projectionStartedAt = performance.now();
      const projection = await projector.projectAndComplete(event, fact, clock());
      logger.info("provider event projected", {
        attemptCount: event.attemptCount,
        eventType: event.eventType,
        projectionDurationMs: performance.now() - projectionStartedAt,
        providerEventId: event.providerEventId,
      });
      await dispatchCommittedCommands(projection, dispatchCommand);
      return {
        duplicate: false as const,
        outcome: "PROCESSED" as const,
        projection,
        providerWebhookEventId: event.id,
      };
    } catch (error) {
      const errorCode = providerEventErrorCode(error);
      if (
        error instanceof TelnyxEventAdmissionError &&
        TERMINAL_ADMISSION_ERRORS.has(error.code)
      ) {
        const completed = await inbox.completeIgnored({
          attemptCount: event.attemptCount,
          errorCode,
          eventId: event.id,
          now: clock(),
        });
        if (!completed) throw new CanonicalProjectionError("PROVIDER_EVENT_CLAIM_LOST");
        return {
          duplicate: false as const,
          errorCode,
          outcome: "IGNORED" as const,
          providerWebhookEventId: event.id,
        };
      }

      const failed = await inbox.fail({
        attemptCount: event.attemptCount,
        errorCode,
        eventId: event.id,
        nextAttemptAt: inbox.retryAt(event.attemptCount),
      });
      if (!failed) throw new CanonicalProjectionError("PROVIDER_EVENT_CLAIM_LOST");
      logger.warn("provider event failed", {
        attemptCount: event.attemptCount,
        errorCode,
        eventType: event.eventType,
        providerEventId: event.providerEventId,
      });
      if (event.attemptCount >= PROVIDER_WEBHOOK_MAX_ATTEMPTS) {
        logger.error("provider event attempts exhausted", {
          attemptCount: event.attemptCount,
          errorCode,
          eventType: event.eventType,
          providerEventId: event.providerEventId,
        });
      }
      return {
        duplicate: false as const,
        errorCode,
        outcome: "FAILED" as const,
        providerWebhookEventId: event.id,
      };
    }
  }

  async function processTelnyxVoiceEvent(envelope: TelnyxVoiceWebhookEnvelope) {
    return processRecord(await inbox.receive(envelope));
  }

  return Object.assign(processTelnyxVoiceEvent, {
    processRecord,
  });
}

export const processTelnyxVoiceEvent = createTelnyxVoiceEventProcessor({
  admit: admitTelnyxEvent,
  inbox: providerWebhookInbox,
  projector: prismaCanonicalCallProjector,
});
