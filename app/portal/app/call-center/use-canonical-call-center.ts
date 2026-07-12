"use client";

import { useCallback, useEffect, useReducer } from "react";

import {
  applyCursor,
  applyProjectionEvent,
  createRealtimeState,
  markRealtimeReconnecting,
  requestSnapshotReset,
  type CallCenterRealtimeState,
  type CallCenterResetReason,
  type CallCenterSnapshot,
  type ProjectionEvent,
} from "@/lib/call-center/realtime-contract";

type HookState = {
  error: Error | null;
  loading: boolean;
  refresh: number;
  state: CallCenterRealtimeState | null;
};

type Action =
  | { type: "connected" }
  | { type: "cursor"; revision: string }
  | { type: "failed"; error: Error }
  | { type: "loading" }
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
    case "loading":
      return { ...current, error: null, loading: true };
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
        loading: true,
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
  const refetch = useCallback(() => dispatch({ type: "refetch" }), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let source: EventSource | null = null;

    dispatch({ type: "loading" });

    const reset = (reason: CallCenterResetReason) => {
      if (!active) return;
      dispatch({ type: "reset", reason });
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
          throw new Error(`Failed to load call center (${response.status})`);
        }

        const snapshot = (await response.json()) as CallCenterSnapshot;
        if (!active) return;
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
          if (active) dispatch({ type: "connected" });
        });
        source.addEventListener("error", () => {
          if (active) dispatch({ type: "reconnecting" });
        });
        source.addEventListener("projection", (event) => {
          if (!active) return;
          try {
            dispatch({
              type: "projection",
              event: messageData(event) as ProjectionEvent,
            });
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
              typeof data.revision !== "string"
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
        dispatch({
          type: "failed",
          error: error instanceof Error ? error : new Error("Failed to load call center"),
        });
      }
    };

    void connect();

    return () => {
      active = false;
      controller.abort();
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
