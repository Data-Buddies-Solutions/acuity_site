export type ActiveAgentLegStatus =
  "CREATED" | "DIALING" | "RINGING" | "ANSWERED" | "BRIDGED" | "ENDED" | "FAILED";

export type ActiveAgentLeg = {
  readonly id: string;
  /** Present only for an in-progress attended transfer target. */
  readonly replacesLegId?: string | null;
  readonly status: ActiveAgentLegStatus;
};

export type ActiveQueuePolicy = {
  readonly id: string;
  readonly maxWaitSec: number;
  readonly overflowQueueId: string | null;
  readonly ringTimeoutSec: number;
  readonly voicemailEnabled: boolean;
};

export type ActiveInboundLifecycleInput = {
  readonly agentLegs: readonly ActiveAgentLeg[];
  readonly callId: string;
  readonly customerLegId: string;
  readonly deadlineAt: Date | null;
  readonly eligibleAgentCount: number;
  readonly now: Date;
  /** The bridge event currently being processed under the call lock. */
  readonly processedBridgeLegId: string | null;
  readonly queue: ActiveQueuePolicy;
  readonly queueDeadlineAt: Date | null;
  readonly visitedQueueIds: readonly string[];
  /** The persisted winner is authoritative once present. */
  readonly winningLegId: string | null;
};

type StopPlaybackIntent = {
  readonly description: "Stop caller ringback";
  readonly idempotencyKey: string;
  readonly legId: string;
  readonly type: "STOP_PLAYBACK";
};

type HangupLegIntent = {
  readonly description: "Hang up abandoned caller" | "Hang up non-winning live agent leg";
  readonly idempotencyKey: string;
  readonly legId: string;
  readonly type: "HANGUP_LEG";
};

type OverflowQueueIntent = {
  readonly description: "Route call to configured overflow queue";
  readonly fromQueueId: string;
  readonly idempotencyKey: string;
  readonly queueId: string;
  readonly type: "ROUTE_OVERFLOW_QUEUE";
};

type VoicemailIntent = {
  readonly description: "Start queue voicemail";
  readonly idempotencyKey: string;
  readonly queueId: string;
  readonly type: "START_VOICEMAIL";
};

type MissedCallIntent = {
  readonly description: "Create missed-call task";
  readonly idempotencyKey: string;
  readonly kind: "MISSED_CALL";
  readonly type: "CREATE_TASK";
};

export type ActiveInboundLifecycleIntent =
  | StopPlaybackIntent
  | HangupLegIntent
  | OverflowQueueIntent
  | VoicemailIntent
  | MissedCallIntent;

export type ActiveInboundLifecycleDecision = {
  readonly deadlineAt: Date;
  readonly disposition:
    "WAITING_FOR_AGENT" | "CONNECTED" | "OVERFLOW" | "VOICEMAIL" | "ABANDONED";
  readonly intents: readonly ActiveInboundLifecycleIntent[];
  /** Replacement targets that must stay live while the source remains winner. */
  readonly pendingReplacementLegIds: readonly string[];
  readonly queueDeadlineAt: Date;
  readonly status: "QUEUED" | "RINGING" | "CONNECTED" | "VOICEMAIL" | "ABANDONED";
  readonly winningLegId: string | null;
};

const LIVE_AGENT_LEG_STATUSES = new Set<ActiveAgentLegStatus>([
  "CREATED",
  "DIALING",
  "RINGING",
  "ANSWERED",
  "BRIDGED",
]);

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1_000);
}

function earlier(left: Date, right: Date) {
  return left.getTime() <= right.getTime() ? left : right;
}

function liveAgentLegs(agentLegs: readonly ActiveAgentLeg[]) {
  return agentLegs.filter((leg) => LIVE_AGENT_LEG_STATUSES.has(leg.status));
}

function winnerFor(input: ActiveInboundLifecycleInput) {
  if (input.winningLegId) return input.winningLegId;
  if (!input.processedBridgeLegId) return null;

  const processedLeg = input.agentLegs.find(
    (leg) => leg.id === input.processedBridgeLegId,
  );
  return processedLeg?.status === "BRIDGED" ? processedLeg.id : null;
}

function stopPlaybackIntent(input: ActiveInboundLifecycleInput): StopPlaybackIntent {
  return {
    description: "Stop caller ringback",
    idempotencyKey: `active:${input.callId}:stop-ringback`,
    legId: input.customerLegId,
    type: "STOP_PLAYBACK",
  };
}

function connectedIntents(
  input: ActiveInboundLifecycleInput,
  winningLegId: string,
  liveLegs: readonly ActiveAgentLeg[],
  retainedLegIds: ReadonlySet<string>,
) {
  const intents: ActiveInboundLifecycleIntent[] = [stopPlaybackIntent(input)];
  for (const leg of liveLegs) {
    if (leg.id === winningLegId || retainedLegIds.has(leg.id)) continue;
    intents.push({
      description: "Hang up non-winning live agent leg",
      idempotencyKey: `active:${input.callId}:winner:${winningLegId}:hangup:${leg.id}`,
      legId: leg.id,
      type: "HANGUP_LEG",
    });
  }
  return intents;
}

function expiredLegIntents(
  input: ActiveInboundLifecycleInput,
  liveLegs: readonly ActiveAgentLeg[],
) {
  return liveLegs.map((leg): HangupLegIntent => ({
    description: "Hang up non-winning live agent leg",
    idempotencyKey: `active:${input.callId}:queue:${input.queue.id}:hangup:${leg.id}`,
    legId: leg.id,
    type: "HANGUP_LEG",
  }));
}

/**
 * Decides the next ACTIVE inbound state without reading or writing external state.
 * The caller must provide one lock-consistent snapshot for callback and deadline work.
 */
export function decideActiveInboundLifecycle(
  input: ActiveInboundLifecycleInput,
): ActiveInboundLifecycleDecision {
  const queueDeadlineAt =
    input.queueDeadlineAt ?? addSeconds(input.now, input.queue.maxWaitSec);
  const deadlineAt =
    input.deadlineAt ??
    earlier(addSeconds(input.now, input.queue.ringTimeoutSec), queueDeadlineAt);
  const liveLegs = liveAgentLegs(input.agentLegs);
  const winningLegId = winnerFor(input);

  if (winningLegId) {
    const pendingReplacementLegIds = liveLegs
      .filter(
        (leg) =>
          leg.id !== winningLegId &&
          leg.replacesLegId === winningLegId &&
          deadlineAt.getTime() > input.now.getTime(),
      )
      .map(({ id }) => id);
    return {
      deadlineAt,
      disposition: "CONNECTED",
      intents: connectedIntents(
        input,
        winningLegId,
        liveLegs,
        new Set(pendingReplacementLegIds),
      ),
      pendingReplacementLegIds,
      queueDeadlineAt,
      status: "CONNECTED",
      winningLegId,
    };
  }

  if (
    deadlineAt.getTime() > input.now.getTime() &&
    (input.eligibleAgentCount > 0 || liveLegs.length > 0)
  ) {
    return {
      deadlineAt,
      disposition: "WAITING_FOR_AGENT",
      intents: [],
      pendingReplacementLegIds: [],
      queueDeadlineAt,
      status: liveLegs.length > 0 ? "RINGING" : "QUEUED",
      winningLegId: null,
    };
  }

  const overflowQueueId = input.queue.overflowQueueId;
  const hangupIntents = expiredLegIntents(input, liveLegs);
  const overflowIsAcyclic =
    overflowQueueId !== null &&
    overflowQueueId !== input.queue.id &&
    !input.visitedQueueIds.includes(overflowQueueId) &&
    queueDeadlineAt.getTime() > input.now.getTime();
  if (overflowQueueId && overflowIsAcyclic) {
    return {
      deadlineAt,
      disposition: "OVERFLOW",
      intents: [
        ...hangupIntents,
        {
          description: "Route call to configured overflow queue",
          fromQueueId: input.queue.id,
          idempotencyKey: `active:${input.callId}:overflow:${input.queue.id}:${overflowQueueId}`,
          queueId: overflowQueueId,
          type: "ROUTE_OVERFLOW_QUEUE",
        },
      ],
      pendingReplacementLegIds: [],
      queueDeadlineAt,
      status: "QUEUED",
      winningLegId: null,
    };
  }

  if (input.queue.voicemailEnabled) {
    return {
      deadlineAt,
      disposition: "VOICEMAIL",
      intents: [
        stopPlaybackIntent(input),
        ...hangupIntents,
        {
          description: "Start queue voicemail",
          idempotencyKey: `active:${input.callId}:voicemail:${input.queue.id}`,
          queueId: input.queue.id,
          type: "START_VOICEMAIL",
        },
        {
          description: "Create missed-call task",
          idempotencyKey: `voicemail:${input.callId}`,
          kind: "MISSED_CALL",
          type: "CREATE_TASK",
        },
      ],
      pendingReplacementLegIds: [],
      queueDeadlineAt,
      status: "VOICEMAIL",
      winningLegId: null,
    };
  }

  return {
    deadlineAt,
    disposition: "ABANDONED",
    intents: [
      stopPlaybackIntent(input),
      ...hangupIntents,
      {
        description: "Hang up abandoned caller",
        idempotencyKey: `active:${input.callId}:hangup-customer`,
        legId: input.customerLegId,
        type: "HANGUP_LEG",
      },
      {
        description: "Create missed-call task",
        idempotencyKey: `active:${input.callId}:task:missed-call`,
        kind: "MISSED_CALL",
        type: "CREATE_TASK",
      },
    ],
    pendingReplacementLegIds: [],
    queueDeadlineAt,
    status: "ABANDONED",
    winningLegId: null,
  };
}

export function decideActiveInboundCallback(input: ActiveInboundLifecycleInput) {
  return decideActiveInboundLifecycle(input);
}

export function decideActiveInboundDeadline(input: ActiveInboundLifecycleInput) {
  return decideActiveInboundLifecycle(input);
}
