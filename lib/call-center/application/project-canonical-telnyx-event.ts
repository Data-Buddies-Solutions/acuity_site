import { recordShadowRoutingDecision } from "@/lib/call-center/application/shadow-routing";
import { dispatchProviderCommand } from "@/lib/call-center/application/provider-command-runtime";
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
import { prismaShadowRoutingStore } from "@/lib/call-center/infrastructure/prisma-shadow-routing-store";
import { resolveCanonicalCommandDispatchConfig } from "@/lib/call-center/infrastructure/command-dispatch-config";
import { createLogger } from "@/lib/logger";

const logger = createLogger("call-center-canonical-projector");

type ProjectionInbox = Pick<
  typeof canonicalProjectionInbox,
  "claim" | "completeIgnored" | "fail"
>;

type Dependencies = {
  clock?: () => Date;
  commandDispatchConfig?: typeof resolveCanonicalCommandDispatchConfig;
  dispatchCommand?: typeof dispatchProviderCommand;
  inbox: ProjectionInbox;
  projector: CanonicalCallProjector;
  recordShadowDecision?: (
    input: { callId: string; practiceId: string },
    now: Date,
  ) => ReturnType<typeof recordShadowRoutingDecision>;
};

const SHADOW_ERROR = "SHADOW_ROUTING_DECISION_FAILED";
const COMMAND_DISPATCH_ERROR = "ACTIVE_ROUTING_COMMAND_DISPATCH_DEFERRED";

async function dispatchCommittedCommands(
  projection: Awaited<ReturnType<CanonicalCallProjector["projectAndComplete"]>>,
  config: typeof resolveCanonicalCommandDispatchConfig,
  dispatch: typeof dispatchProviderCommand,
) {
  if (projection.effectOwner !== "CANONICAL" || projection.commandIds.length === 0) {
    return;
  }

  try {
    if (!config().enabled) return;
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
  commandDispatchConfig = resolveCanonicalCommandDispatchConfig,
  dispatchCommand = dispatchProviderCommand,
  inbox,
  projector,
  recordShadowDecision,
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
      if (
        recordShadowDecision &&
        projection.effectOwner === "LEGACY" &&
        projection.routingMode === "SHADOW"
      ) {
        try {
          await recordShadowDecision(
            { callId: projection.callId, practiceId: projection.practiceId },
            clock(),
          );
        } catch {
          logger.warn("shadow routing decision failed", { errorCode: SHADOW_ERROR });
        }
      }
      await dispatchCommittedCommands(projection, commandDispatchConfig, dispatchCommand);
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
  recordShadowDecision: (input, now) =>
    recordShadowRoutingDecision(prismaShadowRoutingStore, input, now),
});

export type { CanonicalProjectionRecord };
