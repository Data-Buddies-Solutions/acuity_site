export const CALL_CENTER_SCHEMA_VERSION = 9 as const;

export type CallView = {
  answerReservation?: {
    agentSessionId: string;
    expiresAt: string;
    legId: string;
    status: "ACCEPTED" | "ANSWERED" | "BRIDGED";
  } | null;
  id: string;
  queueId: string | null;
  direction: "INBOUND" | "OUTBOUND";
  status:
    | "ABANDONED"
    | "COMPLETED"
    | "CONNECTED"
    | "FAILED"
    | "QUEUED"
    | "RECEIVED"
    | "RINGING"
    | "VOICEMAIL";
  stateVersion: number;
  fromPhone: string;
  toPhone: string;
  callerName: string | null;
  callOfficeLabel: string | null;
  onHold: boolean;
  transferring: boolean;
  winningLegId: string | null;
  receivedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  legs: CallLegView[];
};

type CallLegView = {
  id: string;
  kind: "AGENT" | "CUSTOMER";
  endpointId: string | null;
  endpointLabel: string | null;
  agentSessionId: string | null;
  status: "ANSWERED" | "BRIDGED" | "CREATED" | "DIALING" | "ENDED" | "FAILED" | "RINGING";
  providerCallControlId: string | null;
  providerCallLegId: string | null;
  providerCallSessionId: string | null;
};

export type AgentSessionView = {
  id: string;
  endpointId: string;
  clientInstanceId: string;
  presence: "AVAILABLE" | "BUSY" | "OFFLINE" | "PAUSED";
  connectionState: "CONNECTING" | "DISCONNECTED" | "FAILED" | "READY";
  microphoneReady: boolean;
  audioReady: boolean;
  leaseExpiresAt: string;
  stateVersion: number;
};

export type CallCenterSnapshot = {
  schemaVersion: typeof CALL_CENTER_SCHEMA_VERSION;
  queueId: string;
  observedAt: string;
  calls: CallView[];
  selectedQueueCallIds: string[];
};

export function selectLiveCallOwnership(call: CallView): {
  endpointLabel: string | null;
  state: "ANSWERED" | "ANSWERING" | "RINGING";
} | null {
  if (call.status === "CONNECTED") {
    const connectedAgentLegs = call.legs.filter(
      (leg) =>
        leg.kind === "AGENT" &&
        (leg.status === "BRIDGED" ||
          (call.direction === "OUTBOUND" && leg.status === "ANSWERED")),
    );
    const winner = call.winningLegId
      ? connectedAgentLegs.find((leg) => leg.id === call.winningLegId)
      : null;
    return winner ? { endpointLabel: winner.endpointLabel, state: "ANSWERED" } : null;
  }

  const answeringLegs = call.legs.filter(
    (leg) => leg.kind === "AGENT" && leg.status === "ANSWERED",
  );
  const answerer = answeringLegs.length === 1 ? answeringLegs[0] : null;
  return answerer?.endpointLabel
    ? { endpointLabel: answerer.endpointLabel, state: "ANSWERING" }
    : { endpointLabel: null, state: "RINGING" };
}

export function selectLiveQueueCalls(state: CallCenterSnapshot) {
  return state.calls.filter((call) => {
    if (call.direction === "INBOUND") {
      if (["RECEIVED", "QUEUED", "RINGING"].includes(call.status)) return true;
      return call.status === "CONNECTED" && selectLiveCallOwnership(call) !== null;
    }

    const ownership = selectLiveCallOwnership(call);
    return (
      state.selectedQueueCallIds.includes(call.id) &&
      call.queueId === state.queueId &&
      call.status === "CONNECTED" &&
      ownership?.state === "ANSWERED" &&
      Boolean(ownership?.endpointLabel)
    );
  });
}
