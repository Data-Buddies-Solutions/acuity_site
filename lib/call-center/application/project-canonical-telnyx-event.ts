import { dispatchProviderCommand } from "@/lib/call-center/application/provider-command-runtime";
import { dispatchProviderCommandGraph } from "@/lib/call-center/application/dispatch-provider-command";
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
  dispatchCommand?: typeof dispatchProviderCommand;
  inbox: ProjectionInbox;
  projector: CanonicalCallProjector;
};

async function completeIgnored(
  inbox: ProjectionInbox,
  event: CanonicalProjectionRecord,
  now: Date,
  reasonCode?: string,
) {
  const completed = await inbox.completeIgnored({
    attemptCount: event.canonicalProjectionAttemptCount,
    eventId: event.id,
    now,
    reasonCode,
  });
  if (!completed) throw new CanonicalProjectionError("CANONICAL_CLAIM_LOST");
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

export function canonicalProjectionErrorCode(error: unknown) {
  if (
    error instanceof CanonicalProjectionError ||
    error instanceof CanonicalTelnyxFactError
  ) {
    return error.code;
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
  return "CANONICAL_PROJECTION_FAILED";
}

export function createCanonicalTelnyxEventProcessor({
  clock = () => new Date(),
  dispatchCommand = dispatchProviderCommand,
  inbox,
  projector,
}: Dependencies) {
  return async function processCanonicalTelnyxEvent(eventId: string) {
    const event = await inbox.claim(eventId);
    if (!event) return { outcome: "SKIPPED" as const };

    try {
      const fact = parseCanonicalTelnyxCallFact(event.payload, event.receivedAt);
      if (!fact) {
        await completeIgnored(inbox, event, clock());
        return { outcome: "IGNORED" as const };
      }

      const projection = await projector.projectAndComplete(event, fact, clock());
      await dispatchCommittedCommands(projection, dispatchCommand);
      return { outcome: "PROCESSED" as const, projection };
    } catch (error) {
      const errorCode = canonicalProjectionErrorCode(error);
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
