export const INBOUND_OFFER_WINDOW_SECONDS = 20;

export type ActiveAgentLegStatus =
  "CREATED" | "DIALING" | "RINGING" | "ANSWERED" | "BRIDGED" | "ENDED" | "FAILED";

export type ActiveAgentLeg = {
  readonly id: string;
  readonly status: ActiveAgentLegStatus;
};

export type ActiveInboundLifecycleInput = {
  readonly agentLegs: readonly ActiveAgentLeg[];
  readonly callId: string;
  readonly customerLegId: string;
  readonly deadlineAt: Date | null;
  readonly now: Date;
  /** The bridge event currently being processed under the call lock. */
  readonly processedBridgeLegId: string | null;
  readonly queue: {
    readonly id: string;
    readonly voicemailEnabled: boolean;
  };
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
  StopPlaybackIntent | HangupLegIntent | VoicemailIntent | MissedCallIntent;

export type ActiveInboundLifecycleDecision = {
  readonly deadlineAt: Date;
  readonly disposition: "WAITING_FOR_AGENT" | "CONNECTED" | "VOICEMAIL" | "ABANDONED";
  readonly intents: readonly ActiveInboundLifecycleIntent[];
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

function liveAgentLegs(agentLegs: readonly ActiveAgentLeg[]) {
  return agentLegs.filter((leg) => LIVE_AGENT_LEG_STATUSES.has(leg.status));
}

function winnerFor(input: ActiveInboundLifecycleInput) {
  if (input.winningLegId) return input.winningLegId;
  if (!input.processedBridgeLegId) return null;
  const processed = input.agentLegs.find((leg) => leg.id === input.processedBridgeLegId);
  return processed?.status === "BRIDGED" ? processed.id : null;
}

function stopPlayback(input: ActiveInboundLifecycleInput): StopPlaybackIntent {
  return {
    description: "Stop caller ringback",
    idempotencyKey: `active:${input.callId}:stop-ringback`,
    legId: input.customerLegId,
    type: "STOP_PLAYBACK",
  };
}

function hangupAgentLeg(
  input: ActiveInboundLifecycleInput,
  legId: string,
  key: string,
): HangupLegIntent {
  return {
    description: "Hang up non-winning live agent leg",
    idempotencyKey: `active:${input.callId}:${key}:hangup:${legId}`,
    legId,
    type: "HANGUP_LEG",
  };
}

/**
 * The complete inbound policy: one fixed offer window, one provider-confirmed
 * winner, then voicemail or abandonment.
 */
export function decideActiveInboundLifecycle(
  input: ActiveInboundLifecycleInput,
): ActiveInboundLifecycleDecision {
  const deadlineAt =
    input.deadlineAt ?? addSeconds(input.now, INBOUND_OFFER_WINDOW_SECONDS);
  const liveLegs = liveAgentLegs(input.agentLegs);
  const winningLegId = winnerFor(input);

  if (winningLegId) {
    return {
      deadlineAt,
      disposition: "CONNECTED",
      intents: [
        stopPlayback(input),
        ...liveLegs
          .filter(({ id }) => id !== winningLegId)
          .map((leg) => hangupAgentLeg(input, leg.id, `winner:${winningLegId}`)),
      ],
      status: "CONNECTED",
      winningLegId,
    };
  }

  if (deadlineAt > input.now && liveLegs.length > 0) {
    return {
      deadlineAt,
      disposition: "WAITING_FOR_AGENT",
      intents: [],
      status: "RINGING",
      winningLegId: null,
    };
  }

  const expiredLegIntents = liveLegs.map((leg) =>
    hangupAgentLeg(input, leg.id, `queue:${input.queue.id}`),
  );
  if (input.queue.voicemailEnabled) {
    return {
      deadlineAt,
      disposition: "VOICEMAIL",
      intents: [
        stopPlayback(input),
        ...expiredLegIntents,
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
      status: "VOICEMAIL",
      winningLegId: null,
    };
  }

  return {
    deadlineAt,
    disposition: "ABANDONED",
    intents: [
      stopPlayback(input),
      ...expiredLegIntents,
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
    status: "ABANDONED",
    winningLegId: null,
  };
}
