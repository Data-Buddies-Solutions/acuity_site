import { parseRevision } from "./realtime";

export const CALL_CENTER_SCHEMA_VERSION = 1 as const;

export type Revision = string;
export type CallCenterConnection = "CONNECTED" | "RECONNECTING";
export type CallCenterResetReason =
  | "ACCESS_CHANGED"
  | "AHEAD_OF_STREAM"
  | "INVALID_CURSOR"
  | "RETENTION_GAP"
  | "UNAPPLICABLE_DELTA";

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
    | "VOICEMAIL"
    | "WRAP_UP";
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
};

export type AgentSessionView = {
  id: string;
  endpointId: string;
  presence: "AVAILABLE" | "BUSY" | "OFFLINE" | "PAUSED";
  connectionState: "CONNECTING" | "DISCONNECTED" | "FAILED" | "READY";
  microphoneReady: boolean;
  audioReady: boolean;
  leaseExpiresAt: string;
};

export type EndpointView = {
  id: string;
  label: string;
  locationId: string | null;
  enabled: boolean;
};

export type QueueSummary = { id: string; name: string };
export type QueueView = QueueSummary & { maxWaitSec: number; ringTimeoutSec: number };

export type TaskView = {
  id: string;
  callId: string | null;
  kind: "CALLBACK" | "FOLLOW_UP" | "MISSED_CALL" | "VOICEMAIL";
  status: "OPEN" | "RESOLVED";
};

export type OperationView = {
  operationEventRevision: Revision;
  callId: string;
  type: "CLAIM" | "DISPOSITION" | "OUTBOUND" | "TRANSFER";
  providerCommandId: string | null;
  status: "CONFIRMED" | "FAILED" | "PENDING" | "SENT";
  errorCode: string | null;
};

export type CallCenterSnapshot = {
  schemaVersion: typeof CALL_CENTER_SCHEMA_VERSION;
  revision: Revision;
  queue: QueueView;
  availableQueues: QueueSummary[];
  agentSession: AgentSessionView | null;
  endpoints: EndpointView[];
  calls: CallView[];
  tasks: TaskView[];
  operations: OperationView[];
};

export type ProjectionDelta =
  | { kind: "AGENT_SESSION_REMOVE"; sessionId: string }
  | { kind: "AGENT_SESSION_UPSERT"; session: AgentSessionView }
  | { callId: string; kind: "CALL_REMOVE" }
  | { call: CallView; kind: "CALL_UPSERT" }
  | { kind: "OPERATION_UPSERT"; operation: OperationView }
  | { kind: "TASK_REMOVE"; taskId: string }
  | { kind: "TASK_UPSERT"; task: TaskView };

export type ProjectionEvent = {
  schemaVersion: typeof CALL_CENTER_SCHEMA_VERSION;
  revision: Revision;
  aggregateType: "AGENT_SESSION" | "CALL" | "COMMAND" | "CONFIGURATION" | "TASK";
  aggregateId: string;
  stateVersion: number;
  delta: ProjectionDelta;
};

export type CallCenterRealtimeState = CallCenterSnapshot & {
  connection: CallCenterConnection;
  resetReason: CallCenterResetReason | null;
};

export function createRealtimeState(
  snapshot: CallCenterSnapshot,
): CallCenterRealtimeState {
  return { ...snapshot, connection: "CONNECTED", resetReason: null };
}

export function markRealtimeReconnecting(
  state: CallCenterRealtimeState,
): CallCenterRealtimeState {
  return { ...state, connection: "RECONNECTING" };
}

export function requestSnapshotReset(
  state: CallCenterRealtimeState,
  reason: CallCenterResetReason,
): CallCenterRealtimeState {
  return { ...state, connection: "RECONNECTING", resetReason: reason };
}

function upsertById<T extends { id: string }>(items: T[], value: T) {
  const existing = items.findIndex(({ id }) => id === value.id);
  if (existing < 0) return [...items, value];
  return items.map((item, index) => (index === existing ? value : item));
}

export function applyProjectionEvent(
  state: CallCenterRealtimeState,
  event: ProjectionEvent,
): CallCenterRealtimeState {
  const cursor = parseRevision(state.revision);
  const candidate = parseRevision(event.revision);

  if (cursor === null || candidate === null) {
    return requestSnapshotReset(state, "INVALID_CURSOR");
  }

  if (candidate <= cursor) return state;

  const advanced = { ...state, revision: event.revision };
  const delta = event.delta;

  switch (delta.kind) {
    case "CALL_UPSERT": {
      const current = state.calls.find(({ id }) => id === delta.call.id);
      if (current && current.stateVersion >= delta.call.stateVersion) return advanced;
      return { ...advanced, calls: upsertById(state.calls, delta.call) };
    }
    case "CALL_REMOVE":
      return {
        ...advanced,
        calls: state.calls.filter(({ id }) => id !== delta.callId),
      };
    case "AGENT_SESSION_UPSERT":
      return { ...advanced, agentSession: delta.session };
    case "AGENT_SESSION_REMOVE":
      return {
        ...advanced,
        agentSession:
          state.agentSession?.id === delta.sessionId ? null : state.agentSession,
      };
    case "TASK_UPSERT":
      return { ...advanced, tasks: upsertById(state.tasks, delta.task) };
    case "TASK_REMOVE":
      return {
        ...advanced,
        tasks: state.tasks.filter(({ id }) => id !== delta.taskId),
      };
    case "OPERATION_UPSERT": {
      const operations = state.operations.filter(
        ({ operationEventRevision }) =>
          operationEventRevision !== delta.operation.operationEventRevision,
      );
      return { ...advanced, operations: [...operations, delta.operation] };
    }
  }
}

export function selectIncomingCalls(state: CallCenterRealtimeState) {
  return state.calls.filter(
    ({ direction, status }) =>
      direction === "INBOUND" &&
      (status === "RECEIVED" || status === "QUEUED" || status === "RINGING"),
  );
}

export function selectActiveCall(state: CallCenterRealtimeState) {
  return (
    state.calls.find(({ status }) => status === "CONNECTED" || status === "WRAP_UP") ??
    null
  );
}

export function selectOperation(
  state: CallCenterRealtimeState,
  operationEventRevision: Revision,
) {
  return (
    state.operations.find(
      (operation) => operation.operationEventRevision === operationEventRevision,
    ) ?? null
  );
}
