import {
  acquireAgentSession,
  releaseAgentSession,
  type AgentSessionActor,
  type AgentSessionReadinessUpdate,
  updateAgentSessionReadiness,
} from "@/lib/call-center/application/agent-sessions";
import {
  authorizeAgentSessionCredential,
  type AgentSessionCredential,
  type AgentSessionCredentialActor,
  type AgentSessionCredentialInput,
} from "@/lib/call-center/application/agent-session-credentials";
import { processTelnyxVoiceEvent } from "@/lib/call-center/application/process-telnyx-voice-event";
import { dispatchProviderCommandGraph } from "@/lib/call-center/application/dispatch-provider-command";
import { dispatchProviderCommand } from "@/lib/call-center/application/provider-command-runtime";
import { readCallCenterSnapshot } from "@/lib/call-center/application/realtime-queries";
import {
  setCallHoldMusic,
  type SetCallHoldMusicInput,
  type SetCallHoldMusicReceipt,
} from "@/lib/call-center/application/set-call-hold-music";
import {
  startOutboundCall,
  StartOutboundCallError,
  type StartOutboundCallInput,
} from "@/lib/call-center/application/start-outbound-call";
import {
  listTransferTargets,
  transferAgentCall,
  TransferAgentCallError,
  type TransferAgentCallInput,
  type TransferAgentCallReceipt,
  type TransferTarget,
} from "@/lib/call-center/application/transfer-agent-call";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import {
  DIRECT_HANDOFF_TTL_MS,
  resolveDirectHandoffConfig,
  type AcceptDirectHandoffInput,
  type DirectHandoffConfig,
  type ReserveDirectHandoffInput,
} from "@/lib/call-center/direct-handoff";
import { reserveDirectHandoff } from "@/lib/call-center/infrastructure/prisma-direct-handoff-store";
import { prismaAgentSessionStore } from "@/lib/call-center/infrastructure/prisma-agent-session-store";
import { prismaAgentSessionCredentialStore } from "@/lib/call-center/infrastructure/prisma-agent-session-credential-store";
import { prismaStartOutboundCallStore } from "@/lib/call-center/infrastructure/prisma-start-outbound-call-store";
import { prismaSetCallHoldMusicStore } from "@/lib/call-center/infrastructure/prisma-set-call-hold-music-store";
import { prismaTransferAgentCallStore } from "@/lib/call-center/infrastructure/prisma-transfer-agent-call-store";
import type { TelnyxVoiceWebhookEnvelope } from "@/lib/call-center/infrastructure/telnyx-voice-envelope";

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

type AgentAcquisition = Extract<AgentUpdate, { kind: "ACQUIRE" }>;
type AgentHeartbeat = Extract<AgentUpdate, { kind: "HEARTBEAT" }>;
type AgentReleaseUpdate = Extract<AgentUpdate, { kind: "RELEASE" }>;

type OutboundDependencies<Outbound extends { commandId: string }> = {
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

export async function startCanonicalOutbound<Outbound extends { commandId: string }>(
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
  const outbound = await dependencies.create(actor, input, now);
  const start = await dispatchProviderCommandGraph({
    commandIds: [outbound.commandId],
    dispatch: dependencies.dispatch,
  });
  if (start.failures.length) {
    throw new StartOutboundCallError(
      "Outbound call was rejected by phone service",
      502,
      false,
    );
  }
  if (start.deferred.length) {
    throw new StartOutboundCallError("Outbound call could not be started", 503);
  }
  return outbound;
}

export async function startCanonicalTransfer(
  dependencies: {
    dispatch(commandId: string): ReturnType<typeof dispatchProviderCommand>;
    save(
      actor: QueueAccessActor,
      input: TransferAgentCallInput,
      now?: Date,
    ): Promise<TransferAgentCallReceipt>;
  },
  actor: QueueAccessActor,
  input: TransferAgentCallInput,
  now?: Date,
) {
  const receipt = await dependencies.save(actor, input, now);
  const result = await dependencies.dispatch(receipt.commandId);
  if (result.status === "FAILED" || result.status === "REJECTED") {
    await dispatchProviderCommandGraph({
      commandIds: result.followUpCommandIds,
      dispatch: dependencies.dispatch,
    });
    throw new TransferAgentCallError("Transfer could not be started", 409);
  }
  return receipt;
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
  applyProviderEvent(envelope: TelnyxVoiceWebhookEnvelope): Promise<Projection>;
  clock(): Date;
  handoffConfig(): DirectHandoffConfig;
  authorizeAgentCredential(
    actor: AgentSessionCredentialActor,
    input: AgentSessionCredentialInput,
    now?: Date,
  ): Promise<AgentSessionCredential>;
  readState(actor: QueueAccessActor, queueId: string): Promise<OperatorState>;
  listTransferTargets(
    actor: QueueAccessActor,
    input: Pick<TransferAgentCallInput, "callId" | "clientInstanceId">,
    now?: Date,
  ): Promise<TransferTarget[]>;
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
  setHoldMusic(
    actor: QueueAccessActor,
    input: SetCallHoldMusicInput,
    now?: Date,
  ): Promise<SetCallHoldMusicReceipt>;
  transferAgent(
    actor: QueueAccessActor,
    input: TransferAgentCallInput,
    now?: Date,
  ): Promise<TransferAgentCallReceipt>;
  updateAgentReadiness(
    actor: AgentSessionActor,
    input: AgentSessionReadinessUpdate,
    now?: Date,
  ): Promise<UpdatedAgent>;
};

/**
 * The one server Call Center module. HTTP handlers translate external identity
 * and signed input into logical operations; lifecycle ownership stays here.
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
  function updateAgent(update: AgentAcquisition): Promise<AcquiredAgent>;
  function updateAgent(update: AgentHeartbeat): Promise<UpdatedAgent>;
  function updateAgent(update: AgentReleaseUpdate): Promise<ReleasedAgent>;
  function updateAgent(
    update: AgentUpdate,
  ): Promise<AcquiredAgent | UpdatedAgent | ReleasedAgent>;
  function updateAgent(
    update: AgentUpdate,
  ): Promise<AcquiredAgent | UpdatedAgent | ReleasedAgent> {
    switch (update.kind) {
      case "ACQUIRE":
        return dependencies.acquireAgent(update.actor, update.input, update.now);
      case "HEARTBEAT":
        return dependencies.updateAgentReadiness(update.actor, update.input, update.now);
      case "RELEASE":
        return dependencies.releaseAgent(update.actor, update.input, update.now);
    }
  }

  return {
    acceptHandoff(input: AcceptDirectHandoffInput) {
      const config = dependencies.handoffConfig();
      const now = dependencies.clock();
      return dependencies.reserveHandoff(
        { ...input, practiceId: config.practiceId },
        {
          baseSipUri: config.sipUri,
          expiresAt: new Date(now.getTime() + DIRECT_HANDOFF_TTL_MS),
          now,
          secret: config.secret,
        },
      );
    },

    applyProviderEvent(envelope: TelnyxVoiceWebhookEnvelope) {
      return dependencies.applyProviderEvent(envelope);
    },

    authorizeAgentCredential(
      actor: AgentSessionCredentialActor,
      input: AgentSessionCredentialInput,
      now?: Date,
    ) {
      return dependencies.authorizeAgentCredential(actor, input, now);
    },

    readOperatorState(actor: QueueAccessActor, queueId: string) {
      return dependencies.readState(actor, queueId);
    },

    listTransferTargets(
      actor: QueueAccessActor,
      input: Pick<TransferAgentCallInput, "callId" | "clientInstanceId">,
      now?: Date,
    ) {
      return dependencies.listTransferTargets(actor, input, now);
    },

    setHoldMusic(actor: QueueAccessActor, input: SetCallHoldMusicInput, now?: Date) {
      return dependencies.setHoldMusic(actor, input, now);
    },

    startOutbound(actor: QueueAccessActor, input: StartOutboundCallInput, now?: Date) {
      return dependencies.startOutbound(actor, input, now);
    },

    transferAgent(actor: QueueAccessActor, input: TransferAgentCallInput, now?: Date) {
      return dependencies.transferAgent(actor, input, now);
    },

    updateAgent,
  };
}

export const callCenter = createCallCenter({
  acquireAgent: (actor, input, now) =>
    acquireAgentSession(prismaAgentSessionStore, actor, input, now),
  applyProviderEvent: processTelnyxVoiceEvent,
  authorizeAgentCredential: (actor, input, now) =>
    authorizeAgentSessionCredential(prismaAgentSessionCredentialStore, actor, input, now),
  clock: () => new Date(),
  handoffConfig: resolveDirectHandoffConfig,
  listTransferTargets: (actor, input, now) =>
    listTransferTargets(prismaTransferAgentCallStore, actor, input, now),
  readState: readCallCenterSnapshot,
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
  setHoldMusic: (actor, input, now) =>
    setCallHoldMusic(
      prismaSetCallHoldMusicStore,
      dispatchProviderCommand,
      actor,
      input,
      now,
    ),
  transferAgent: (actor, input, now) =>
    startCanonicalTransfer(
      {
        dispatch: dispatchProviderCommand,
        save: (currentActor, currentInput, currentNow) =>
          transferAgentCall(
            prismaTransferAgentCallStore,
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
