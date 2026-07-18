"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CallCenterRequestError } from "@/lib/call-center/operator-error";
import type { AgentSessionView } from "@/lib/call-center/realtime-contract";

import { callCenterResponse, operatorErrorCopy } from "./call-center-errors";

export type CanonicalAgentConnectionState = "CLOSED" | "CONNECTING" | "ERROR" | "READY";

export type CanonicalAgentSessionOptions = {
  audioReady: boolean;
  clientInstanceId: string | null;
  connectionState: CanonicalAgentConnectionState;
  microphoneReady: boolean;
  presence: AgentSessionView["presence"];
  projectedSession?: AgentSessionView | null;
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

const RECOVERY_RETRY_BASE_MS = 1_000;
const RECOVERY_RETRY_MAX_MS = 30_000;

function recoveryRetryDelay(attempt: number) {
  const ceiling = Math.min(
    RECOVERY_RETRY_BASE_MS * 2 ** Math.min(attempt, 5),
    RECOVERY_RETRY_MAX_MS,
  );
  return Math.floor(ceiling * (0.75 + Math.random() * 0.25));
}

function needsRecovery(
  session: AgentSessionView,
  requestedPresence: Readiness["presence"],
) {
  return (
    requestedPresence !== "OFFLINE" &&
    (session.connectionState === "DISCONNECTED" ||
      session.presence === "OFFLINE" ||
      new Date(session.leaseExpiresAt).getTime() <= Date.now())
  );
}

function isRetryableRecoveryError(error: unknown) {
  return !(error instanceof CallCenterRequestError) || error.operatorError.retryable;
}

export function canonicalHeartbeatPresence(
  session: Pick<AgentSessionView, "currentCallId" | "offeredCallId" | "presence">,
  requested: AgentSessionView["presence"],
) {
  if (session.currentCallId) return session.presence;
  if (session.offeredCallId) {
    return requested === "AVAILABLE" ? "AVAILABLE" : session.presence;
  }
  return requested;
}

function message(error: unknown, action: "connect" | "readiness") {
  return operatorErrorCopy(error, action).message;
}

function isReadyForCalls(session: AgentSessionView) {
  return (
    session.presence === "AVAILABLE" &&
    session.connectionState === "READY" &&
    session.microphoneReady &&
    session.audioReady &&
    session.offeredCallId === null &&
    session.currentCallId === null &&
    new Date(session.leaseExpiresAt).getTime() > Date.now()
  );
}

async function responseJson<T>(response: Response): Promise<T> {
  return callCenterResponse<T>(response);
}

async function acquireSession(clientInstanceId: string): Promise<ActiveSession> {
  const response = await fetch("/api/portal/call-center/agent-sessions", {
    body: JSON.stringify({ clientInstanceId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const acquired = await responseJson<AcquisitionResponse>(response);
  return {
    clientInstanceId,
    endpointId: acquired.session.endpointId,
    leaseDurationMs: acquired.leaseDurationMs,
    session: acquired.session,
    stopping: false,
  };
}

export function useCanonicalAgentSession({
  audioReady,
  clientInstanceId,
  connectionState,
  microphoneReady,
  presence,
  projectedSession = null,
}: CanonicalAgentSessionOptions) {
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<AgentSessionView | null>(null);
  const activeRef = useRef<ActiveSession | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identityRef = useRef({ clientInstanceId });
  const lifecycleRef = useRef(0);
  const mountedRef = useRef(true);
  const patchPromiseRef = useRef<Promise<void> | null>(null);
  const patchReadinessRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const patchRequestedRef = useRef(false);
  const releasePromiseRef = useRef<Promise<void> | null>(null);
  const recoverExpiredSessionRef = useRef<(serverExpired?: boolean) => Promise<void>>(
    () => Promise.resolve(),
  );
  const recoveryPromiseRef = useRef<Promise<void> | null>(null);
  const recoveryRetryAttemptRef = useRef(0);
  const recoveryRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPromiseRef = useRef<Promise<ActiveSession | undefined> | null>(null);
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

  const clearRecoveryTimer = useCallback(() => {
    if (!recoveryRetryRef.current) return;
    clearTimeout(recoveryRetryRef.current);
    recoveryRetryRef.current = null;
  }, []);

  const resetRecoveryRetry = useCallback(() => {
    clearRecoveryTimer();
    recoveryRetryAttemptRef.current = 0;
  }, [clearRecoveryTimer]);

  const drainReadiness = useCallback(async () => {
    clearHeartbeat();
    patchRequestedRef.current = false;
    await patchPromiseRef.current?.catch(() => {});
    clearHeartbeat();
  }, [clearHeartbeat]);

  const patchReadiness = useCallback(() => {
    const active = activeRef.current;
    if (!active || active.stopping) return Promise.resolve();

    patchRequestedRef.current = true;
    if (patchPromiseRef.current) return patchPromiseRef.current;

    clearHeartbeat();
    patchRequestedRef.current = false;
    const requestedStateVersion = active.session.stateVersion;
    let retryDelayMs = Math.max(1_000, Math.floor(active.leaseDurationMs / 2));
    let recoverExpiredSession = false;
    const request = (async () => {
      const response = await fetch(
        `/api/portal/call-center/agent-sessions/${encodeURIComponent(active.session.id)}`,
        {
          body: JSON.stringify({
            ...readinessRef.current,
            clientInstanceId: active.clientInstanceId,
            expectedStateVersion: requestedStateVersion,
            presence: canonicalHeartbeatPresence(
              active.session,
              readinessRef.current.presence,
            ),
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
        if (
          requestError instanceof CallCenterRequestError &&
          requestError.operatorError.code === "SESSION_STALE"
        ) {
          retryDelayMs = 1_000;
        }
        if (
          requestError instanceof CallCenterRequestError &&
          requestError.operatorError.code === "SESSION_EXPIRED" &&
          readinessRef.current.presence !== "OFFLINE"
        ) {
          recoverExpiredSession = true;
          retryDelayMs = 1_000;
        }
        if (
          !recoverExpiredSession &&
          mountedRef.current &&
          activeRef.current === active &&
          !active.stopping &&
          active.session.stateVersion === requestedStateVersion
        ) {
          setError(message(requestError, "readiness"));
        }
        throw requestError;
      })
      .finally(() => {
        if (patchPromiseRef.current !== request) return;
        patchPromiseRef.current = null;

        if (activeRef.current !== active || active.stopping) return;
        if (recoverExpiredSession) {
          void recoverExpiredSessionRef.current(true).catch(() => {});
          return;
        }
        if (patchRequestedRef.current) {
          void patchReadinessRef.current().catch(() => {});
          return;
        }

        heartbeatRef.current = setTimeout(
          () => void patchReadinessRef.current().catch(() => {}),
          retryDelayMs,
        );
      });

    patchPromiseRef.current = request;
    return request;
  }, [clearHeartbeat]);

  const flushReadiness = useCallback(async () => {
    patchReadiness();
    let failure: unknown = null;
    while (patchPromiseRef.current) {
      try {
        await patchPromiseRef.current;
        failure = null;
      } catch (error) {
        failure = error;
      }
    }
    if (failure) throw failure;
  }, [patchReadiness]);

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
    identityRef.current = { clientInstanceId };
  }, [audioReady, clientInstanceId, connectionState, microphoneReady, presence]);

  useEffect(() => {
    const active = activeRef.current;
    if (
      !active ||
      !projectedSession ||
      projectedSession.id !== active.session.id ||
      projectedSession.clientInstanceId !== active.clientInstanceId ||
      projectedSession.endpointId !== active.endpointId ||
      projectedSession.stateVersion <= active.session.stateVersion
    ) {
      return;
    }

    active.session = projectedSession;
    queueMicrotask(() => {
      if (!mountedRef.current || activeRef.current !== active) return;
      setSession(projectedSession);
      setError(null);
    });
    if (needsRecovery(projectedSession, readinessRef.current.presence)) {
      void recoverExpiredSessionRef
        .current(
          projectedSession.connectionState === "DISCONNECTED" ||
            projectedSession.presence === "OFFLINE",
        )
        .catch(() => {});
    }
  }, [projectedSession]);

  const release = useCallback(
    async (active: ActiveSession) => {
      active.stopping = true;
      clearHeartbeat();
      patchRequestedRef.current = false;
      await patchPromiseRef.current?.catch(() => {});

      try {
        await fetch(
          `/api/portal/call-center/agent-sessions/${encodeURIComponent(active.session.id)}`,
          {
            body: JSON.stringify({
              clientInstanceId: active.clientInstanceId,
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
    resetRecoveryRetry();
    patchRequestedRef.current = false;
    if (mountedRef.current) {
      setSession(null);
    }

    const pending = release(active).finally(() => {
      if (releasePromiseRef.current === pending) releasePromiseRef.current = null;
    });
    releasePromiseRef.current = pending;
    await pending;
  }, [clearHeartbeat, release, resetRecoveryRetry]);

  const stop = useCallback(async () => {
    lifecycleRef.current += 1;
    await deactivate();
  }, [deactivate]);

  const startSession = useCallback(
    async (force = false) => {
      const generation = ++lifecycleRef.current;
      const previousStart = startPromiseRef.current;
      const pending = (async () => {
        await previousStart;
        await releasePromiseRef.current;
        if (generation !== lifecycleRef.current) return;

        if (!clientInstanceId) {
          if (mountedRef.current) setError("Call center browser identity is unavailable");
          return;
        }

        const current = activeRef.current;
        if (!force && current && current.clientInstanceId === clientInstanceId) {
          void patchReadiness().catch(() => {});
          return current;
        }
        if (current && current.clientInstanceId !== clientInstanceId) {
          await deactivate();
        }
        if (generation !== lifecycleRef.current) return;

        if (mountedRef.current) setError(null);
        try {
          const active = await acquireSession(clientInstanceId);

          if (
            !mountedRef.current ||
            generation !== lifecycleRef.current ||
            identityRef.current.clientInstanceId !== clientInstanceId
          ) {
            await release(active);
            return;
          }

          if (
            force &&
            current &&
            current.session.id === active.session.id &&
            current.clientInstanceId === active.clientInstanceId &&
            current.endpointId === active.endpointId &&
            current.session.stateVersion > active.session.stateVersion
          ) {
            active.session = current.session;
          }
          activeRef.current = active;
          setSession(active.session);
          if (!force) void patchReadiness().catch(() => {});
          return active;
        } catch (startError) {
          if (mountedRef.current) setError(message(startError, "connect"));
          if (force) throw startError;
        }
      })().finally(() => {
        if (startPromiseRef.current === pending) startPromiseRef.current = null;
      });

      startPromiseRef.current = pending;
      return await pending;
    },
    [clientInstanceId, deactivate, patchReadiness, release],
  );

  const start = useCallback(async () => {
    await startSession();
  }, [startSession]);

  const recoverExpiredSession = useCallback(
    (serverExpired = false) => {
      if (recoveryPromiseRef.current) return recoveryPromiseRef.current;
      const pending = (async () => {
        clearRecoveryTimer();
        await drainReadiness();
        const active = activeRef.current;
        if (!active || active.stopping) {
          recoveryRetryAttemptRef.current = 0;
          return;
        }
        if (
          !serverExpired &&
          new Date(active.session.leaseExpiresAt).getTime() > Date.now()
        ) {
          await patchReadiness();
          recoveryRetryAttemptRef.current = 0;
          return;
        }

        try {
          const recovered = await startSession(true);
          if (!recovered) return;
          await patchPromiseRef.current?.catch(() => {});
          if (activeRef.current !== recovered || recovered.stopping) return;
          await patchReadiness();
          recoveryRetryAttemptRef.current = 0;
        } catch (recoveryError) {
          if (
            mountedRef.current &&
            activeRef.current === active &&
            !active.stopping &&
            isRetryableRecoveryError(recoveryError)
          ) {
            const delay = recoveryRetryDelay(recoveryRetryAttemptRef.current);
            recoveryRetryAttemptRef.current += 1;
            recoveryRetryRef.current = setTimeout(() => {
              recoveryRetryRef.current = null;
              void recoverExpiredSessionRef.current(serverExpired).catch(() => {});
            }, delay);
          } else {
            recoveryRetryAttemptRef.current = 0;
          }
          throw recoveryError;
        }
      })().finally(() => {
        if (recoveryPromiseRef.current === pending) recoveryPromiseRef.current = null;
      });
      recoveryPromiseRef.current = pending;
      return pending;
    },
    [clearRecoveryTimer, drainReadiness, patchReadiness, startSession],
  );

  useEffect(() => {
    recoverExpiredSessionRef.current = recoverExpiredSession;
  }, [recoverExpiredSession]);

  const refresh = useCallback(async () => {
    const generation = lifecycleRef.current;
    resetRecoveryRetry();
    await drainReadiness();

    if (
      !mountedRef.current ||
      generation !== lifecycleRef.current ||
      !activeRef.current ||
      activeRef.current.stopping
    ) {
      throw new Error("Call center session is unavailable");
    }

    const refreshed = await startSession(true);
    if (!refreshed) throw new Error("Call center session is unavailable");
    try {
      await flushReadiness();
    } catch (refreshError) {
      void patchReadiness().catch(() => {});
      throw refreshError;
    }

    if (activeRef.current !== refreshed || !isReadyForCalls(refreshed.session)) {
      throw new Error("Call center session did not become ready");
    }
    if (mountedRef.current) setError(null);
    return refreshed.session;
  }, [drainReadiness, flushReadiness, patchReadiness, resetRecoveryRetry, startSession]);

  useEffect(() => {
    if (presence === "OFFLINE") {
      const timeout = setTimeout(() => void stop(), 0);
      return () => clearTimeout(timeout);
    }
    void patchReadiness().catch(() => {});
  }, [audioReady, connectionState, microphoneReady, patchReadiness, presence, stop]);

  useEffect(() => {
    const active = activeRef.current;
    if (active && active.clientInstanceId !== clientInstanceId) {
      const timeout = setTimeout(() => void stop(), 0);
      return () => clearTimeout(timeout);
    }
  }, [clientInstanceId, stop]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      lifecycleRef.current += 1;
      resetRecoveryRetry();
      const active = activeRef.current;
      activeRef.current = null;
      if (active) void release(active);
    };
  }, [release, resetRecoveryRetry]);

  const effectiveSession =
    projectedSession &&
    session &&
    projectedSession.id === session.id &&
    projectedSession.clientInstanceId === session.clientInstanceId &&
    projectedSession.endpointId === session.endpointId &&
    projectedSession.stateVersion > session.stateVersion
      ? projectedSession
      : session;

  return {
    error,
    refresh,
    session: effectiveSession,
    start,
    stop,
  };
}
