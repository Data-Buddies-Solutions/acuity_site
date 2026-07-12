"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentSessionView } from "@/lib/call-center/realtime-contract";

export type CanonicalAgentConnectionState = "CLOSED" | "CONNECTING" | "ERROR" | "READY";

export type CanonicalAgentSessionOptions = {
  audioReady: boolean;
  clientInstanceId: string | null;
  connectionState: CanonicalAgentConnectionState;
  endpointId: string | null;
  microphoneReady: boolean;
  presence: AgentSessionView["presence"];
};

type AcquisitionResponse = {
  leaseDurationMs: number;
  session: AgentSessionView;
};

type SessionResponse = { session: AgentSessionView };

type ActiveSession = {
  clientInstanceId: string;
  endpointId: string;
  leaseDurationMs: number;
  session: AgentSessionView;
  stopping: boolean;
};

type Readiness = Pick<
  CanonicalAgentSessionOptions,
  "audioReady" | "connectionState" | "microphoneReady" | "presence"
>;

function message(error: unknown) {
  return error instanceof Error ? error.message : "Call center session failed";
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    (T & { error?: unknown }) | null;

  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string" ? body.error : "Call center session failed",
    );
  }

  if (!body) throw new Error("Call center session returned an invalid response");
  return body;
}

export function useCanonicalAgentSession({
  audioReady,
  clientInstanceId,
  connectionState,
  endpointId,
  microphoneReady,
  presence,
}: CanonicalAgentSessionOptions) {
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<AgentSessionView | null>(null);
  const activeRef = useRef<ActiveSession | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identityRef = useRef({ clientInstanceId, endpointId });
  const lifecycleRef = useRef(0);
  const mountedRef = useRef(true);
  const patchPromiseRef = useRef<Promise<void> | null>(null);
  const patchReadinessRef = useRef<() => void>(() => {});
  const patchRequestedRef = useRef(false);
  const releasePromiseRef = useRef<Promise<void> | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const readinessRef = useRef<Readiness>({
    audioReady,
    connectionState,
    microphoneReady,
    presence,
  });

  const clearHeartbeat = useCallback(() => {
    if (!heartbeatRef.current) return;
    clearTimeout(heartbeatRef.current);
    heartbeatRef.current = null;
  }, []);

  const patchReadiness = useCallback(() => {
    const active = activeRef.current;
    if (!active || active.stopping) return;

    patchRequestedRef.current = true;
    if (patchPromiseRef.current) return;

    clearHeartbeat();
    patchRequestedRef.current = false;
    const request = (async () => {
      const response = await fetch(
        `/api/portal/call-center/agent-sessions/${encodeURIComponent(active.session.id)}`,
        {
          body: JSON.stringify({
            ...readinessRef.current,
            clientInstanceId: active.clientInstanceId,
            endpointId: active.endpointId,
            expectedStateVersion: active.session.stateVersion,
          }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        },
      );
      const next = await responseJson<SessionResponse>(response);
      active.session = next.session;

      if (mountedRef.current && activeRef.current === active && !active.stopping) {
        setSession(next.session);
        setError(null);
      }
    })()
      .catch((requestError) => {
        if (mountedRef.current && activeRef.current === active && !active.stopping) {
          setError(message(requestError));
        }
      })
      .finally(() => {
        if (patchPromiseRef.current !== request) return;
        patchPromiseRef.current = null;

        if (activeRef.current !== active || active.stopping) return;
        if (patchRequestedRef.current) {
          patchReadinessRef.current();
          return;
        }

        heartbeatRef.current = setTimeout(
          () => patchReadinessRef.current(),
          Math.max(1_000, Math.floor(active.leaseDurationMs / 2)),
        );
      });

    patchPromiseRef.current = request;
  }, [clearHeartbeat]);

  useEffect(() => {
    patchReadinessRef.current = patchReadiness;
  }, [patchReadiness]);

  useEffect(() => {
    readinessRef.current = {
      audioReady,
      connectionState,
      microphoneReady,
      presence,
    };
    identityRef.current = { clientInstanceId, endpointId };
  }, [
    audioReady,
    clientInstanceId,
    connectionState,
    endpointId,
    microphoneReady,
    presence,
  ]);

  const release = useCallback(
    async (active: ActiveSession) => {
      active.stopping = true;
      clearHeartbeat();
      patchRequestedRef.current = false;
      await patchPromiseRef.current;

      try {
        await fetch(
          `/api/portal/call-center/agent-sessions/${encodeURIComponent(active.session.id)}`,
          {
            body: JSON.stringify({
              clientInstanceId: active.clientInstanceId,
              endpointId: active.endpointId,
              expectedStateVersion: active.session.stateVersion,
            }),
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            method: "DELETE",
          },
        );
      } catch {
        // The server lease is the final cleanup boundary if the browser disappears.
      }
    },
    [clearHeartbeat],
  );

  const deactivate = useCallback(async () => {
    const active = activeRef.current;
    if (!active) return releasePromiseRef.current ?? undefined;

    activeRef.current = null;
    clearHeartbeat();
    patchRequestedRef.current = false;
    if (mountedRef.current) {
      setSession(null);
    }

    const pending = release(active).finally(() => {
      if (releasePromiseRef.current === pending) releasePromiseRef.current = null;
    });
    releasePromiseRef.current = pending;
    await pending;
  }, [clearHeartbeat, release]);

  const stop = useCallback(async () => {
    lifecycleRef.current += 1;
    await deactivate();
  }, [deactivate]);

  const start = useCallback(async () => {
    const generation = ++lifecycleRef.current;
    const previousStart = startPromiseRef.current;
    const pending = (async () => {
      await previousStart;
      await releasePromiseRef.current;
      if (generation !== lifecycleRef.current) return;

      if (!endpointId || !clientInstanceId) {
        if (mountedRef.current) setError("Choose a call center endpoint first");
        return;
      }

      const current = activeRef.current;
      if (
        current &&
        current.endpointId === endpointId &&
        current.clientInstanceId === clientInstanceId
      ) {
        patchReadiness();
        return;
      }
      if (current) await deactivate();
      if (generation !== lifecycleRef.current) return;

      if (mountedRef.current) setError(null);
      try {
        const response = await fetch("/api/portal/call-center/agent-sessions", {
          body: JSON.stringify({
            clientInstanceId,
            endpointId,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const acquired = await responseJson<AcquisitionResponse>(response);
        const active: ActiveSession = {
          clientInstanceId,
          endpointId,
          leaseDurationMs: acquired.leaseDurationMs,
          session: acquired.session,
          stopping: false,
        };

        if (
          !mountedRef.current ||
          generation !== lifecycleRef.current ||
          identityRef.current.endpointId !== endpointId ||
          identityRef.current.clientInstanceId !== clientInstanceId
        ) {
          await release(active);
          return;
        }

        activeRef.current = active;
        setSession(acquired.session);
        patchReadiness();
      } catch (startError) {
        if (mountedRef.current) setError(message(startError));
      }
    })().finally(() => {
      if (startPromiseRef.current === pending) startPromiseRef.current = null;
    });

    startPromiseRef.current = pending;
    await pending;
  }, [clientInstanceId, deactivate, endpointId, patchReadiness, release]);

  useEffect(() => {
    if (presence === "OFFLINE") {
      void stop();
      return;
    }
    patchReadiness();
  }, [audioReady, connectionState, microphoneReady, patchReadiness, presence, stop]);

  useEffect(() => {
    const active = activeRef.current;
    if (
      active &&
      (active.endpointId !== endpointId || active.clientInstanceId !== clientInstanceId)
    ) {
      void stop();
    }
  }, [clientInstanceId, endpointId, stop]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      lifecycleRef.current += 1;
      const active = activeRef.current;
      activeRef.current = null;
      if (active) void release(active);
    };
  }, [release]);

  return { error, session, start, stop };
}
