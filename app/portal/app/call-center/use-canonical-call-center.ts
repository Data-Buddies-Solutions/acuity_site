"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  applyCursor,
  applyProjectionEvent,
  CALL_CENTER_SCHEMA_VERSION,
  createRealtimeState,
  markRealtimeReconnecting,
  requestSnapshotReset,
  type CallCenterRealtimeState,
  type CallCenterResetReason,
  type CallCenterSnapshot,
  type ProjectionEvent,
} from "@/lib/call-center/realtime-contract";
import { parseRevision } from "@/lib/call-center/realtime";
import { CallCenterRequestError } from "@/lib/call-center/operator-error";

import { callCenterResponse } from "./call-center-errors";

type HookState = {
  error: Error | null;
  loading: boolean;
  refresh: number;
  state: CallCenterRealtimeState | null;
};

type Action =
  | { type: "access-changed" }
  | { type: "connected" }
  | { type: "cursor"; revision: string }
  | { type: "failed"; error: Error }
  | { type: "loading"; preserveSnapshot: boolean }
  | { type: "projection"; event: ProjectionEvent }
  | { type: "reconnecting" }
  | { type: "refetch" }
  | { type: "reset"; reason: CallCenterResetReason }
  | { type: "snapshot"; snapshot: CallCenterSnapshot };

const initialState: HookState = {
  error: null,
  loading: true,
  refresh: 0,
  state: null,
};

function reducer(current: HookState, action: Action): HookState {
  switch (action.type) {
    case "access-changed":
      return { ...current, error: null, loading: true, state: null };
    case "loading":
      return {
        ...current,
        error: null,
        loading: !action.preserveSnapshot || current.state === null,
        state:
          action.preserveSnapshot && current.state
            ? markRealtimeReconnecting(current.state)
            : current.state,
      };
    case "snapshot":
      return {
        ...current,
        error: null,
        loading: false,
        state: createRealtimeState(action.snapshot),
      };
    case "projection":
      return current.state
        ? { ...current, state: applyProjectionEvent(current.state, action.event) }
        : current;
    case "cursor":
      return current.state
        ? { ...current, state: applyCursor(current.state, action.revision) }
        : current;
    case "reconnecting":
      return current.state
        ? { ...current, state: markRealtimeReconnecting(current.state) }
        : current;
    case "connected":
      return current.state
        ? {
            ...current,
            state: { ...current.state, connection: "CONNECTED", resetReason: null },
          }
        : current;
    case "reset":
      return current.state
        ? { ...current, state: requestSnapshotReset(current.state, action.reason) }
        : current;
    case "failed":
      return { ...current, error: action.error, loading: false };
    case "refetch":
      return {
        ...current,
        error: null,
        loading: current.state === null,
        refresh: current.refresh + 1,
      };
  }
}

const resetReasons = new Set<CallCenterResetReason>([
  "ACCESS_CHANGED",
  "AHEAD_OF_STREAM",
  "INVALID_CURSOR",
  "RETENTION_GAP",
  "UNAPPLICABLE_DELTA",
]);
const snapshotRetryDelaysMs = [1_000, 2_000, 5_000] as const;

function messageData(event: Event): unknown {
  if (!("data" in event) || typeof event.data !== "string") {
    throw new Error("Canonical call center event has no data");
  }
  return JSON.parse(event.data);
}

function resetReason(event: Event): CallCenterResetReason {
  const data = messageData(event);
  if (
    typeof data === "object" &&
    data !== null &&
    "reason" in data &&
    typeof data.reason === "string" &&
    resetReasons.has(data.reason as CallCenterResetReason)
  ) {
    return data.reason as CallCenterResetReason;
  }
  return "UNAPPLICABLE_DELTA";
}

function requestUrl(path: string, parameters: Record<string, string>) {
  return `${path}?${new URLSearchParams(parameters)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasId(value: unknown): value is Record<string, unknown> & { id: string } {
  return isRecord(value) && typeof value.id === "string";
}

function hasVersion(value: unknown) {
  return hasId(value) && Number.isInteger(value.stateVersion);
}

function isCounts(value: unknown) {
  return (
    isRecord(value) &&
    ["active", "openTasks", "recent", "waiting"].every(
      (key) => Number.isInteger(value[key]) && Number(value[key]) >= 0,
    )
  );
}

function isSnapshot(value: unknown, queueId: string): value is CallCenterSnapshot {
  if (!isRecord(value) || value.schemaVersion !== CALL_CENTER_SCHEMA_VERSION) {
    return false;
  }
  if (typeof value.revision !== "string" || parseRevision(value.revision) === null) {
    return false;
  }
  if (!isRecord(value.queue) || value.queue.id !== queueId) {
    return false;
  }
  return (
    isCounts(value.counts) &&
    Array.isArray(value.availableQueues) &&
    value.availableQueues.every(hasId) &&
    Array.isArray(value.calls) &&
    value.calls.every(hasVersion) &&
    (value.agentProfile === null || hasId(value.agentProfile)) &&
    Array.isArray(value.transferTargets) &&
    value.transferTargets.every(
      (target) =>
        isRecord(target) &&
        typeof target.name === "string" &&
        typeof target.userId === "string",
    ) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(hasId) &&
    (value.agentSession === null || hasVersion(value.agentSession)) &&
    (value.operations === null ||
      (Array.isArray(value.operations) &&
        value.operations.every(
          (operation) =>
            isRecord(operation) && typeof operation.operationEventRevision === "string",
        )))
  );
}

function isProjection(value: unknown): value is ProjectionEvent {
  if (
    !isRecord(value) ||
    value.schemaVersion !== CALL_CENTER_SCHEMA_VERSION ||
    typeof value.revision !== "string" ||
    parseRevision(value.revision) === null ||
    typeof value.aggregateId !== "string" ||
    !["AGENT_SESSION", "CALL", "COMMAND", "CONFIGURATION", "TASK"].includes(
      String(value.aggregateType),
    ) ||
    !Number.isInteger(value.stateVersion) ||
    Number(value.stateVersion) < 0 ||
    !isRecord(value.delta) ||
    (value.counts !== undefined && !isCounts(value.counts))
  ) {
    return false;
  }

  switch (value.delta.kind) {
    case "AGENT_SESSION_REMOVE":
      return typeof value.delta.sessionId === "string";
    case "AGENT_SESSION_UPSERT":
      return hasVersion(value.delta.session);
    case "CALL_REMOVE":
      return typeof value.delta.callId === "string";
    case "CALL_UPSERT":
      return hasVersion(value.delta.call);
    case "OPERATION_UPSERT":
      return (
        isRecord(value.delta.operation) &&
        typeof value.delta.operation.operationEventRevision === "string"
      );
    case "TASK_REMOVE":
      return typeof value.delta.taskId === "string";
    case "TASK_UPSERT":
      return hasId(value.delta.task);
    default:
      return false;
  }
}

export type UseCanonicalCallCenterOptions = {
  clientInstanceId: string;
  queueId: string;
};

export type UseCanonicalCallCenterResult = {
  error: Error | null;
  loading: boolean;
  refetch: () => void;
  state: CallCenterRealtimeState | null;
};

export function useCanonicalCallCenter({
  clientInstanceId,
  queueId,
}: UseCanonicalCallCenterOptions): UseCanonicalCallCenterResult {
  const [model, dispatch] = useReducer(reducer, initialState);
  const loadedIdentityRef = useRef<string | null>(null);
  const plannedRotationRef = useRef(false);
  const retryIdentityRef = useRef<string | null>(null);
  const retryAttemptRef = useRef(0);
  const refetch = useCallback(() => dispatch({ type: "refetch" }), []);

  useEffect(() => {
    const identityKey = JSON.stringify({ clientInstanceId, queueId });
    const controller = new AbortController();
    let active = true;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    if (retryIdentityRef.current !== identityKey) {
      retryIdentityRef.current = identityKey;
      retryAttemptRef.current = 0;
    }

    dispatch({
      type: "loading",
      preserveSnapshot: loadedIdentityRef.current === identityKey,
    });

    const reset = (reason: CallCenterResetReason) => {
      if (!active) return;
      if (reason === "ACCESS_CHANGED") {
        loadedIdentityRef.current = null;
        dispatch({ type: "access-changed" });
      } else {
        dispatch({ type: "reset", reason });
      }
      source?.close();
      source = null;
      dispatch({ type: "refetch" });
    };

    const connect = async () => {
      try {
        const identity = { clientInstanceId, queueId };
        const response = await fetch(
          requestUrl("/api/portal/call-center/snapshot", identity),
          { signal: controller.signal },
        );
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            loadedIdentityRef.current = null;
            dispatch({ type: "access-changed" });
          }
        }
        const data: unknown = await callCenterResponse(response);
        if (!isSnapshot(data, queueId)) {
          throw new Error("Call center returned an incompatible snapshot");
        }
        const snapshot = data;
        if (!active) return;
        loadedIdentityRef.current = identityKey;
        retryAttemptRef.current = 0;
        dispatch({ type: "snapshot", snapshot });

        source = new EventSource(
          requestUrl("/api/portal/call-center/events", {
            after: snapshot.revision,
            clientInstanceId,
            contract: "canonical",
            queueId,
          }),
        );
        source.addEventListener("open", () => {
          if (!active) return;
          plannedRotationRef.current = false;
          dispatch({ type: "connected" });
        });
        source.addEventListener("error", () => {
          if (!active) return;
          if (plannedRotationRef.current) {
            plannedRotationRef.current = false;
            return;
          }
          dispatch({ type: "reconnecting" });
        });
        source.addEventListener("rotate", () => {
          if (active) plannedRotationRef.current = true;
        });
        source.addEventListener("projection", (event) => {
          if (!active) return;
          try {
            const data = messageData(event);
            if (!isProjection(data)) throw new Error("Incompatible projection");
            dispatch({ type: "projection", event: data });
          } catch {
            reset("UNAPPLICABLE_DELTA");
          }
        });
        source.addEventListener("cursor", (event) => {
          if (!active) return;
          try {
            const data = messageData(event);
            if (
              typeof data !== "object" ||
              data === null ||
              !("revision" in data) ||
              typeof data.revision !== "string" ||
              parseRevision(data.revision) === null
            ) {
              throw new Error("Canonical cursor has no revision");
            }
            dispatch({ type: "cursor", revision: data.revision });
          } catch {
            reset("INVALID_CURSOR");
          }
        });
        source.addEventListener("reset", (event) => {
          try {
            reset(resetReason(event));
          } catch {
            reset("UNAPPLICABLE_DELTA");
          }
        });
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        const retryable =
          error instanceof CallCenterRequestError && error.operatorError.retryable;
        dispatch({
          type: "failed",
          error: error instanceof Error ? error : new Error("Failed to load call center"),
        });
        const delay = snapshotRetryDelaysMs[retryAttemptRef.current];
        if (retryable && delay !== undefined) {
          retryAttemptRef.current += 1;
          retryTimer = setTimeout(() => {
            if (active) dispatch({ type: "refetch" });
          }, delay);
        }
      }
    };

    void connect();

    return () => {
      active = false;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [clientInstanceId, model.refresh, queueId]);

  return {
    error: model.error,
    loading: model.loading,
    refetch,
    state: model.state,
  };
}
