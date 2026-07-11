import {
  canonicalProjectionInbox,
  type CanonicalProjectionRecord,
} from "@/lib/call-center/infrastructure/canonical-provider-webhook-inbox";
import {
  CanonicalProjectionError,
  prismaCanonicalCallProjector,
  type CanonicalCallProjector,
} from "@/lib/call-center/infrastructure/prisma-canonical-call-projector";
import {
  CanonicalTelnyxFactError,
  parseCanonicalTelnyxCallFact,
} from "@/lib/call-center/infrastructure/telnyx-canonical-call-fact";
import { createLogger } from "@/lib/logger";

const logger = createLogger("call-center-canonical-projector");

type ProjectionInbox = Pick<
  typeof canonicalProjectionInbox,
  "claim" | "completeIgnored" | "fail"
>;

type Dependencies = {
  clock?: () => Date;
  inbox: ProjectionInbox;
  projector: CanonicalCallProjector;
};

function categoricalErrorCode(error: unknown) {
  if (
    error instanceof CanonicalProjectionError ||
    error instanceof CanonicalTelnyxFactError
  ) {
    return error.code;
  }
  return "CANONICAL_PROJECTION_FAILED";
}

export function createCanonicalTelnyxEventProcessor({
  clock = () => new Date(),
  inbox,
  projector,
}: Dependencies) {
  return async function processCanonicalTelnyxEvent(eventId: string) {
    const event = await inbox.claim(eventId);
    if (!event) return { outcome: "SKIPPED" as const };

    try {
      const fact = parseCanonicalTelnyxCallFact(event.payload, event.receivedAt);
      if (!fact) {
        const completed = await inbox.completeIgnored({
          attemptCount: event.canonicalProjectionAttemptCount,
          eventId: event.id,
          now: clock(),
        });
        if (!completed) throw new CanonicalProjectionError("CANONICAL_CLAIM_LOST");
        return { outcome: "IGNORED" as const };
      }

      const projection = await projector.projectAndComplete(event, fact, clock());
      return { outcome: "PROCESSED" as const, projection };
    } catch (error) {
      const errorCode = categoricalErrorCode(error);
      await inbox.fail(event, errorCode);
      logger.warn("canonical webhook projection failed", {
        errorCode,
        eventType: event.eventType,
        providerEventId: event.providerEventId,
      });
      return { errorCode, outcome: "FAILED" as const };
    }
  };
}

export const processCanonicalTelnyxEvent = createCanonicalTelnyxEventProcessor({
  inbox: canonicalProjectionInbox,
  projector: prismaCanonicalCallProjector,
});

export type { CanonicalProjectionRecord };
