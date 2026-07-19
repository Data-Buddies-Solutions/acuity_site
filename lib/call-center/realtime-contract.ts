export const CALL_CENTER_SCHEMA_VERSION = 2 as const;

export type CallCenterConnection = "CONNECTED" | "RECONNECTING";

export type CallView = {
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
  winningLegId: string | null;
  receivedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  legs: CallLegView[];
};

export type CallLegView = {
  id: string;
  kind: "AGENT" | "CUSTOMER";
  endpointId: string | null;
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

export type AgentProfileView = {
  id: string;
  label: string;
  locationId: string | null;
  enabled: boolean;
};

export type QueueSummary = { id: string; name: string };
export type QueueView = QueueSummary;

export type TaskView = {
  id: string;
  callId: string | null;
  kind: "CALLBACK" | "FOLLOW_UP" | "MISSED_CALL" | "NOTE" | "VOICEMAIL";
  status: "OPEN" | "RESOLVED";
  callerPhone: string | null;
  createdAt: string;
};

export type OperationalCounts = {
  active: number;
  openTasks: number;
  recent: number;
  waiting: number;
};

export type CallCenterSnapshot = {
  schemaVersion: typeof CALL_CENTER_SCHEMA_VERSION;
  queue: QueueView;
  availableQueues: QueueSummary[];
  agentSession: AgentSessionView | null;
  agentProfile: AgentProfileView | null;
  calls: CallView[];
  counts: OperationalCounts;
  tasks: TaskView[];
};

export type CallCenterRealtimeState = CallCenterSnapshot & {
  connection: CallCenterConnection;
};

export function createRealtimeState(
  snapshot: CallCenterSnapshot,
): CallCenterRealtimeState {
  return { ...snapshot, connection: "CONNECTED" };
}

export function markRealtimeReconnecting(
  state: CallCenterRealtimeState,
): CallCenterRealtimeState {
  return { ...state, connection: "RECONNECTING" };
}

export function selectIncomingCalls(state: CallCenterRealtimeState) {
  return state.calls.filter(
    ({ direction, status }) =>
      direction === "INBOUND" &&
      (status === "RECEIVED" || status === "QUEUED" || status === "RINGING"),
  );
}
