"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  CALL_CENTER_SCHEMA_VERSION,
  createRealtimeState,
  markRealtimeReconnecting,
  type CallCenterRealtimeState,
  type CallCenterSnapshot,
} from "@/lib/call-center/realtime-contract";
import { parseRevision } from "@/lib/call-center/realtime";
import { CallCenterRequestError } from "@/lib/call-center/operator-error";

import { callCenterResponse } from "./call-center-errors";

type HookState = {
  error: Error | null;
  loading: boolean;
  scopeKey: string;
  state: CallCenterRealtimeState | null;
};

const initialState: HookState = {
  error: null,
  loading: true,
  scopeKey: "",
  state: null,
};

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

export type UseCanonicalCallCenterOptions = {
  clientInstanceId: string;
  pollIntervalMs?: number;
  queueId: string;
};

export type UseCanonicalCallCenterResult = {
  error: Error | null;
  loading: boolean;
  refetch: () => void;
  state: CallCenterRealtimeState | null;
};

/**
 * Reads disposable durable state. This loop never owns or mutates Telnyx media.
 */
export function useCanonicalCallCenter({
  clientInstanceId,
  pollIntervalMs = 2_000,
  queueId,
}: UseCanonicalCallCenterOptions): UseCanonicalCallCenterResult {
  const [model, setModel] = useState(initialState);
  const readNowRef = useRef<() => void>(() => {});
  const refetch = useCallback(() => readNowRef.current(), []);
  const scopeKey = `${queueId}:${clientInstanceId}`;

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let inFlight = false;
    let readQueued = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (!active) return;
      timer = setTimeout(read, pollIntervalMs);
    };

    const readNow = () => {
      if (!active) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (inFlight) {
        readQueued = true;
        return;
      }
      void read();
    };

    async function read() {
      if (!active || inFlight) return;
      inFlight = true;
      controller = new AbortController();

      try {
        const response = await fetch(
          requestUrl("/api/portal/call-center/snapshot", {
            clientInstanceId,
            queueId,
          }),
          { signal: controller.signal },
        );
        const data: unknown = await callCenterResponse(response);
        if (!isSnapshot(data, queueId)) {
          throw new Error("Call center returned an incompatible snapshot");
        }
        if (!active) return;
        setModel({
          error: null,
          loading: false,
          scopeKey,
          state: createRealtimeState(data),
        });
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        const nextError =
          error instanceof Error ? error : new Error("Failed to load call center");
        const accessDenied =
          error instanceof CallCenterRequestError &&
          ["ACCESS_DENIED", "AUTH_REQUIRED"].includes(error.operatorError.code);
        setModel((current) => ({
          error: nextError,
          loading: false,
          scopeKey,
          state:
            accessDenied || current.scopeKey !== scopeKey || !current.state
              ? null
              : markRealtimeReconnecting(current.state),
        }));
      } finally {
        inFlight = false;
        controller = null;
        if (!active) return;
        if (readQueued) {
          readQueued = false;
          queueMicrotask(readNow);
        } else {
          schedule();
        }
      }
    }

    readNowRef.current = readNow;
    readNow();

    return () => {
      active = false;
      readNowRef.current = () => {};
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [clientInstanceId, pollIntervalMs, queueId, scopeKey]);

  return {
    ...(model.scopeKey === scopeKey ? model : initialState),
    refetch,
  };
}
