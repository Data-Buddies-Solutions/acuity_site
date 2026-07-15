import { dispatchProviderCommand } from "@/lib/call-center/application/provider-command-runtime";
import {
  canonicalProjectionInbox,
  PASSIVE_LEGACY_OUT_OF_SCOPE_CODE,
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
> &
  Partial<Pick<typeof canonicalProjectionInbox, "hasIgnoredLegacySession">>;

type Dependencies = {
  clock?: () => Date;
  dispatchCommand?: typeof dispatchProviderCommand;
  inbox: ProjectionInbox;
  projector: CanonicalCallProjector;
};

const COMMAND_DISPATCH_ERROR = "ACTIVE_ROUTING_COMMAND_DISPATCH_DEFERRED";

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

function isOutOfScopeLegacyEvent(event: CanonicalProjectionRecord, error: unknown) {
  return (
    event.effectOwner === "LEGACY" &&
    error instanceof CanonicalProjectionError &&
    error.code === "CANONICAL_NUMBER_NOT_FOUND"
  );
}

async function dispatchCommittedCommands(
  projection: Awaited<ReturnType<CanonicalCallProjector["projectAndComplete"]>>,
  dispatch: typeof dispatchProviderCommand,
) {
  if (projection.effectOwner !== "CANONICAL" || projection.commandIds.length === 0) {
    return;
  }

  try {
    for (const commandId of projection.commandIds) {
      const result = await dispatch(commandId);
      if (result.status === "DISPATCHED") continue;
      logger.warn("active routing command dispatch deferred", {
        commandId,
        errorCode: COMMAND_DISPATCH_ERROR,
      });
    }
  } catch {
    logger.warn("active routing command dispatch deferred", {
      errorCode: COMMAND_DISPATCH_ERROR,
    });
  }
}

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
  dispatchCommand = dispatchProviderCommand,
  inbox,
  projector,
}: Dependencies) {
  return async function processCanonicalTelnyxEvent(eventId: string) {
    const event = await inbox.claim(eventId);
    if (!event) return { outcome: "SKIPPED" as const };

    try {
      if (
        event.effectOwner === "LEGACY" &&
        event.providerCallSessionId &&
        (await inbox.hasIgnoredLegacySession?.({
          eventId: event.id,
          providerCallSessionId: event.providerCallSessionId,
        }))
      ) {
        await completeIgnored(inbox, event, clock(), PASSIVE_LEGACY_OUT_OF_SCOPE_CODE);
        return { outcome: "IGNORED" as const };
      }

      const fact = parseCanonicalTelnyxCallFact(event.payload, event.receivedAt);
      if (!fact) {
        await completeIgnored(inbox, event, clock());
        return { outcome: "IGNORED" as const };
      }

      const projection = await projector.projectAndComplete(event, fact, clock());
      await dispatchCommittedCommands(projection, dispatchCommand);
      return { outcome: "PROCESSED" as const, projection };
    } catch (error) {
      if (isOutOfScopeLegacyEvent(event, error)) {
        try {
          await completeIgnored(inbox, event, clock(), PASSIVE_LEGACY_OUT_OF_SCOPE_CODE);
          return { outcome: "IGNORED" as const };
        } catch (completionError) {
          error = completionError;
        }
      }
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
