import { describe, expect, it } from "bun:test";

import {
  applyCursor,
  applyProjectionEvent,
  createRealtimeState,
  markRealtimeReconnecting,
  requestSnapshotReset,
  selectActiveCall,
  selectIncomingCalls,
  selectOperation,
  type CallCenterSnapshot,
  type AgentSessionView,
  type CallView,
  type ProjectionEvent,
} from "../realtime-contract";

function call(overrides: Partial<CallView> = {}): CallView {
  return {
    answeredAt: null,
    callerName: null,
    direction: "INBOUND",
    endedAt: null,
    fromPhone: "+13055550100",
    id: "call-1",
    legs: [],
    queueId: "queue-1",
    receivedAt: "2026-07-11T12:00:00.000Z",
    stateVersion: 1,
    status: "QUEUED",
    toPhone: "+17865550100",
    winningLegId: null,
    ...overrides,
  };
}

function snapshot(calls: CallView[] = []): CallCenterSnapshot {
  return {
    agentSession: null,
    availableQueues: [{ id: "queue-1", name: "Optical" }],
    calls,
    counts: { active: 0, openTasks: 0, recent: 0, waiting: 0 },
    agentProfile: null,
    transferTargets: [],
    operations: null,
    queue: {
      id: "queue-1",
      maxWaitSec: 30,
      name: "Optical",
      ringTimeoutSec: 20,
      routingMode: "LEGACY",
    },
    revision: "10",
    schemaVersion: 1,
    tasks: [],
  };
}

function agentSession(overrides: Partial<AgentSessionView> = {}): AgentSessionView {
  return {
    audioReady: false,
    clientInstanceId: "client-1",
    connectionState: "FAILED",
    currentCallId: null,
    offeredCallId: null,
    endpointId: "endpoint-1",
    id: "session-1",
    leaseExpiresAt: "2026-07-11T12:01:00.000Z",
    microphoneReady: false,
    presence: "PAUSED",
    stateVersion: 2,
    ...overrides,
  };
}

function event(revision: string, delta: ProjectionEvent["delta"]): ProjectionEvent {
  return {
    aggregateId: "call-1",
    aggregateType: "CALL",
    delta,
    revision,
    schemaVersion: 1,
    stateVersion: 1,
  };
}

describe("call-center realtime reducer", () => {
  it("applies an ordered call projection exactly once", () => {
    const initial = createRealtimeState(snapshot());
    const ringingCall = call({ stateVersion: 2, status: "RINGING" });
    const update = event("12", {
      call: ringingCall,
      kind: "CALL_UPSERT",
    });

    const applied = applyProjectionEvent(initial, update);

    expect(applied.revision).toBe("12");
    expect(applied.calls).toEqual([ringingCall]);
    expect(applyProjectionEvent(applied, update)).toBe(applied);
  });

  it("advances the global cursor without regressing aggregate state", () => {
    const current = call({ stateVersion: 4, status: "CONNECTED" });
    const initial = createRealtimeState(snapshot([current]));
    const stale = event("18", {
      call: call({ stateVersion: 3, status: "RINGING" }),
      kind: "CALL_UPSERT",
    });

    const applied = applyProjectionEvent(initial, stale);

    expect(applied.revision).toBe("18");
    expect(applied.calls).toEqual([current]);
  });

  it("advances across filtered cursor frames without changing projections", () => {
    const initial = createRealtimeState(snapshot([call()]));
    const advanced = applyCursor(initial, "17");

    expect(advanced.revision).toBe("17");
    expect(advanced.calls).toBe(initial.calls);
    expect(applyCursor(advanced, "16")).toBe(advanced);
  });

  it("advances the cursor without applying an older agent-session version", () => {
    const current = agentSession();
    const initial = createRealtimeState({ ...snapshot(), agentSession: current });
    const applied = applyProjectionEvent(initial, {
      aggregateId: current.id,
      aggregateType: "AGENT_SESSION",
      delta: {
        kind: "AGENT_SESSION_UPSERT",
        session: agentSession({
          audioReady: true,
          connectionState: "READY",
          microphoneReady: true,
          presence: "AVAILABLE",
          stateVersion: 1,
        }),
      },
      revision: "19",
      schemaVersion: 1,
      stateVersion: 1,
    });

    expect(applied.revision).toBe("19");
    expect(applied.agentSession).toEqual(current);
  });

  it("preserves the current screen during reconnect and reset", () => {
    const current = call({ status: "CONNECTED" });
    const initial = createRealtimeState(snapshot([current]));

    expect(markRealtimeReconnecting(initial)).toMatchObject({
      calls: [current],
      connection: "RECONNECTING",
    });
    expect(requestSnapshotReset(initial, "ACCESS_CHANGED")).toMatchObject({
      calls: [current],
      connection: "RECONNECTING",
      resetReason: "ACCESS_CHANGED",
    });
  });

  it("selects logical UI solely from canonical projection state", () => {
    const incoming = call({ id: "incoming", status: "RINGING" });
    const active = call({ id: "active", status: "CONNECTED" });
    const state = createRealtimeState(snapshot([incoming, active]));

    expect(selectIncomingCalls(state)).toEqual([incoming]);
    expect(selectActiveCall(state)).toEqual(active);
  });

  it("treats a ringing outbound call as this agent's active media", () => {
    const outbound = call({
      direction: "OUTBOUND",
      id: "outbound",
      status: "RINGING",
    });
    const state = createRealtimeState(snapshot([outbound]));

    expect(selectIncomingCalls(state)).toEqual([]);
    expect(selectActiveCall(state)).toEqual(outbound);
  });

  it("keeps durable operations until a projection confirms or fails them", () => {
    const initial = createRealtimeState(snapshot());
    const operation = {
      callId: "call-1",
      errorCode: null,
      operationEventRevision: "20",
      providerCommandId: "command-1",
      status: "PENDING" as const,
      type: "CLAIM" as const,
    };
    const pending = applyProjectionEvent(
      initial,
      event("20", { kind: "OPERATION_UPSERT", operation }),
    );

    expect(selectOperation(pending, "20")).toEqual(operation);

    const confirmed = { ...operation, status: "CONFIRMED" as const };
    const complete = applyProjectionEvent(
      pending,
      event("21", { kind: "OPERATION_UPSERT", operation: confirmed }),
    );
    expect(selectOperation(complete, "20")).toEqual(confirmed);
  });

  it("replaces operational counts with the authorized batch projection", () => {
    const initial = createRealtimeState(snapshot());
    const counts = { active: 1, openTasks: 2, recent: 3, waiting: 4 };
    const applied = applyProjectionEvent(initial, {
      ...event("22", { callId: "call-1", kind: "CALL_REMOVE" }),
      counts,
    });

    expect(applied.counts).toEqual(counts);
  });

  it("requests a snapshot for malformed revisions without clearing state", () => {
    const current = call();
    const initial = createRealtimeState(snapshot([current]));
    const invalid = applyProjectionEvent(
      initial,
      event("not-a-revision", { callId: current.id, kind: "CALL_REMOVE" }),
    );

    expect(invalid).toMatchObject({
      calls: [current],
      connection: "RECONNECTING",
      resetReason: "INVALID_CURSOR",
      revision: "10",
    });
  });
});
