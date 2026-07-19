import {
  acquireAgentSession,
  releaseAgentSession,
  type AgentSessionActor,
  type AgentSessionReadinessUpdate,
  updateAgentSessionReadiness,
} from "@/lib/call-center/application/agent-sessions";
import { processTelnyxVoiceEvent } from "@/lib/call-center/application/process-telnyx-voice-event";
import { dispatchProviderCommandGraph } from "@/lib/call-center/application/dispatch-provider-command";
import { dispatchProviderCommand } from "@/lib/call-center/application/provider-command-runtime";
import { processCanonicalTelnyxEvent } from "@/lib/call-center/application/project-canonical-telnyx-event";
import { readCallCenterSnapshot } from "@/lib/call-center/application/realtime-queries";
import {
  startOutboundCall,
  StartOutboundCallError,
  type StartOutboundCallInput,
} from "@/lib/call-center/application/start-outbound-call";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import {
  reserveDirectHandoff,
  type ReserveDirectHandoffInput,
} from "@/lib/call-center/infrastructure/prisma-direct-handoff-store";
import { prismaAgentSessionStore } from "@/lib/call-center/infrastructure/prisma-agent-session-store";
import { prismaStartOutboundCallStore } from "@/lib/call-center/infrastructure/prisma-start-outbound-call-store";
import type { TelnyxVoiceWebhookEnvelope } from "@/lib/call-center/infrastructure/telnyx-voice-envelope";

type EventIntake = {
  duplicate?: boolean;
  providerWebhookEventId: string;
  processingStatus: string;
};

type AgentIdentity = {
  clientInstanceId: string;
  takeover?: boolean;
};

type AgentRelease = AgentIdentity & {
  expectedStateVersion: number;
  sessionId: string;
};

export type AgentUpdate =
  | {
      actor: AgentSessionActor;
      input: AgentIdentity;
      kind: "ACQUIRE";
      now?: Date;
    }
  | {
      actor: AgentSessionActor;
      input: AgentSessionReadinessUpdate;
      kind: "HEARTBEAT";
      now?: Date;
    }
  | {
      actor: AgentSessionActor;
      input: AgentRelease;
      kind: "RELEASE";
      now?: Date;
    };

type OutboundDependencies<Outbound> = {
  create(
    actor: QueueAccessActor,
    input: StartOutboundCallInput,
    now?: Date,
  ): Promise<Outbound>;
  dispatch(commandId: string): ReturnType<typeof dispatchProviderCommand>;
  prepare(
    actor: QueueAccessActor,
    input: StartOutboundCallInput,
    now?: Date,
  ): Promise<string[]>;
};

export async function startCanonicalOutbound<Outbound>(
  dependencies: OutboundDependencies<Outbound>,
  actor: QueueAccessActor,
  input: StartOutboundCallInput,
  now?: Date,
) {
  const commandIds = await dependencies.prepare(actor, input, now);
  const cleanup = await dispatchProviderCommandGraph({
    commandIds,
    dispatch: dependencies.dispatch,
  });
  if (cleanup.failures.length) {
    throw new StartOutboundCallError(
      "Inbound call offers could not be ended before outbound calling",
      503,
    );
  }
  if (cleanup.deferred.length) {
    throw new StartOutboundCallError("Inbound call offer cleanup is still pending", 503);
  }
  return dependencies.create(actor, input, now);
}

type Dependencies<
  Handoff,
  Projection,
  AcquiredAgent,
  UpdatedAgent,
  ReleasedAgent,
  Outbound,
  OperatorState,
> = {
  acquireAgent(
    actor: AgentSessionActor,
    input: AgentIdentity,
    now?: Date,
  ): Promise<AcquiredAgent>;
  applyEvent(eventId: string): Promise<Projection>;
  readState(actor: QueueAccessActor, queueId: string): Promise<OperatorState>;
  receiveEvent(envelope: TelnyxVoiceWebhookEnvelope): Promise<EventIntake>;
  releaseAgent(
    actor: AgentSessionActor,
    input: AgentRelease,
    now?: Date,
  ): Promise<ReleasedAgent>;
  reserveHandoff(
    input: ReserveDirectHandoffInput,
    options: Parameters<typeof reserveDirectHandoff>[1],
  ): Promise<Handoff>;
  startOutbound(
    actor: QueueAccessActor,
    input: StartOutboundCallInput,
    now?: Date,
  ): Promise<Outbound>;
  updateAgentReadiness(
    actor: AgentSessionActor,
    input: AgentSessionReadinessUpdate,
    now?: Date,
  ): Promise<UpdatedAgent>;
};

/**
 * The one server Call Center module. HTTP handlers translate external identity
 * and signed input into these five operations; lifecycle ownership stays here.
 */
export function createCallCenter<
  Handoff,
  Projection,
  AcquiredAgent,
  UpdatedAgent,
  ReleasedAgent,
  Outbound,
  OperatorState,
>(
  dependencies: Dependencies<
    Handoff,
    Projection,
    AcquiredAgent,
    UpdatedAgent,
    ReleasedAgent,
    Outbound,
    OperatorState
  >,
) {
  return {
    acceptHandoff(
      input: ReserveDirectHandoffInput,
      options: Parameters<typeof reserveDirectHandoff>[1],
    ) {
      return dependencies.reserveHandoff(input, options);
    },

    async applyProviderEvent(envelope: TelnyxVoiceWebhookEnvelope) {
      const intake = await dependencies.receiveEvent(envelope);
      const projection = await dependencies.applyEvent(intake.providerWebhookEventId);
      return { ...intake, projection };
    },

    readOperatorState(actor: QueueAccessActor, queueId: string) {
      return dependencies.readState(actor, queueId);
    },

    startOutbound(actor: QueueAccessActor, input: StartOutboundCallInput, now?: Date) {
      return dependencies.startOutbound(actor, input, now);
    },

    updateAgent(update: AgentUpdate) {
      switch (update.kind) {
        case "ACQUIRE":
          return dependencies.acquireAgent(update.actor, update.input, update.now);
        case "HEARTBEAT":
          return dependencies.updateAgentReadiness(
            update.actor,
            update.input,
            update.now,
          );
        case "RELEASE":
          return dependencies.releaseAgent(update.actor, update.input, update.now);
      }
    },
  };
}

export const callCenter = createCallCenter({
  acquireAgent: (actor, input, now) =>
    acquireAgentSession(prismaAgentSessionStore, actor, input, now),
  applyEvent: processCanonicalTelnyxEvent,
  readState: readCallCenterSnapshot,
  receiveEvent: processTelnyxVoiceEvent,
  releaseAgent: (actor, input, now) =>
    releaseAgentSession(prismaAgentSessionStore, actor, input, now),
  reserveHandoff: reserveDirectHandoff,
  startOutbound: (actor, input, now) =>
    startCanonicalOutbound(
      {
        create: (currentActor, currentInput, currentNow) =>
          startOutboundCall(
            prismaStartOutboundCallStore,
            currentActor,
            currentInput,
            currentNow,
          ),
        dispatch: dispatchProviderCommand,
        prepare: (currentActor, currentInput, currentNow) =>
          prismaStartOutboundCallStore.prepareOutboundCleanup(
            currentActor,
            currentInput,
            currentNow,
          ),
      },
      actor,
      input,
      now,
    ),
  updateAgentReadiness: (actor, input, now) =>
    updateAgentSessionReadiness(prismaAgentSessionStore, actor, input, now),
});
