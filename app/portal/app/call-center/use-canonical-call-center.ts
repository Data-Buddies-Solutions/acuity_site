"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  CALL_CENTER_SCHEMA_VERSION,
  type CallCenterSnapshot,
} from "@/lib/call-center/realtime-contract";
import { CallCenterRequestError } from "@/lib/call-center/operator-error";

import { callCenterResponse } from "./call-center-errors";

type HookState = {
  error: Error | null;
  loading: boolean;
  scopeKey: string;
  state: CallCenterSnapshot | null;
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

function isSnapshot(value: unknown, queueId: string): value is CallCenterSnapshot {
  if (!isRecord(value) || value.schemaVersion !== CALL_CENTER_SCHEMA_VERSION) {
    return false;
  }
  if (value.queueId !== queueId) {
    return false;
  }
  return (
    Number.isInteger(value.openTaskCount) &&
    Number(value.openTaskCount) >= 0 &&
    Array.isArray(value.calls) &&
    value.calls.every(hasVersion) &&
    (value.agentProfile === null || hasId(value.agentProfile)) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(hasId)
  );
}

export type UseCanonicalCallCenterOptions = {
  pollIntervalMs?: number;
  queueId: string;
};

export type UseCanonicalCallCenterResult = {
  error: Error | null;
  loading: boolean;
  refetch: () => void;
  state: CallCenterSnapshot | null;
};

/**
 * Reads disposable durable state. This loop never owns or mutates Telnyx media.
 */
export function useCanonicalCallCenter({
  pollIntervalMs = 2_000,
  queueId,
}: UseCanonicalCallCenterOptions): UseCanonicalCallCenterResult {
  const [model, setModel] = useState(initialState);
  const readNowRef = useRef<() => void>(() => {});
  const refetch = useCallback(() => readNowRef.current(), []);
  const scopeKey = queueId;

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
          requestUrl("/api/portal/call-center/snapshot", { queueId }),
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
          state: data,
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
          state: accessDenied || current.scopeKey !== scopeKey ? null : current.state,
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
  }, [pollIntervalMs, queueId, scopeKey]);

  return {
    ...(model.scopeKey === scopeKey ? model : initialState),
    refetch,
  };
}
