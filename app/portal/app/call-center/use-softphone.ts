"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Call, INotification, TelnyxRTC } from "@telnyx/webrtc";

import {
  normalizeMediaObservation,
  upsertMediaObservation,
  type MediaConnectionState,
  type MediaObservation,
} from "./softphone-media-adapter";
import {
  callCenterResponse,
  localCallCenterError,
  operatorErrorCopy,
} from "./call-center-errors";

type TelnyxTokenResponse =
  | { callerNumber?: string; login: string; password: string }
  | { callerNumber?: string; token: string };

export type DialMediaLeg = {
  callerNumber: string;
  clientState: string;
  destinationNumber: string;
};

export type SoftphoneLifecycleEvent = {
  answerOperationId?: string;
  answerOutcome?: "FAILED" | "SUCCEEDED";
  category:
    | "ANSWER_FAILED"
    | "ANSWER_SUCCEEDED"
    | "REATTACH_CORRELATION_FAILED"
    | "REATTACH_FAILED"
    | "REATTACH_SUCCEEDED"
    | "SDK_READY"
    | "SIGNALING_INTERRUPTED";
  connectionGeneration: number;
  connectionId: string;
  connectionState: MediaConnectionState;
  datacenter: string | null;
  errorCode?: string;
  errorFatal?: boolean;
  errorName?: string;
  providerCallControlId: string | null;
  providerCallLegId: string | null;
  providerCallSessionId: string | null;
  recoveredCallId: string | null;
  region: string | null;
  sdkCallId: string | null;
  sdkCallState: string | null;
};

type SoftphoneMediaOptions = {
  agentSessionId: string | null;
  autoPrepare?: boolean;
  browserSessionId: string;
  canContinueAnswer?: (mediaLegId: string) => boolean;
  enabled: boolean;
  onDebug?: (event: string, details?: Record<string, unknown>) => void;
  onLifecycle?: (event: SoftphoneLifecycleEvent) => void;
  onObservation?: (observation: MediaObservation) => void;
  onRecoveryNeeded?: (request: {
    mediaLegId: string;
    reason: "CALL_DOES_NOT_EXIST" | "SESSION_NOT_REATTACHED";
    recoveryGeneration: number;
  }) => void;
};

const TELNYX_CLIENT_EVENTS = [
  "telnyx.error",
  "telnyx.notification",
  "telnyx.ready",
  "telnyx.rtc.mediaError",
  "telnyx.rtc.peerConnectionFailureError",
  "telnyx.socket.close",
  "telnyx.warning",
] as const;
const ANSWER_CONFIRMATION_TIMEOUT_MS = 20_000;

type PendingAnswer = {
  invokedMediaLegIds: Set<string>;
  mediaLegId: string;
  operationId: string;
  outcomeRecorded: boolean;
  reject(error: Error): void;
  resolve(): void;
  timeout: ReturnType<typeof setTimeout>;
};

async function readTokenResponse(response: Response): Promise<TelnyxTokenResponse> {
  const body = await callCenterResponse<TelnyxTokenResponse>(response);

  const credentials = body as Record<string, unknown>;
  if (typeof credentials.token === "string" && credentials.token.trim()) {
    return { token: credentials.token };
  }
  if (
    typeof credentials.login === "string" &&
    credentials.login.trim() &&
    typeof credentials.password === "string" &&
    credentials.password
  ) {
    return { login: credentials.login, password: credentials.password };
  }

  throw localCallCenterError("CALLING_NOT_CONFIGURED", false);
}

function connectionId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `media-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function mediaErrorMessage(event: unknown) {
  if (event && typeof event === "object") {
    const value = event as {
      error?: { message?: unknown } | unknown;
      message?: unknown;
      payload?: { message?: unknown };
    };

    if (typeof value.message === "string") return value.message;
    if (typeof value.payload?.message === "string") return value.payload.message;
    if (value.error instanceof Error) return value.error.message;
    if (
      value.error &&
      typeof value.error === "object" &&
      "message" in value.error &&
      typeof value.error.message === "string"
    ) {
      return value.error.message;
    }
  }

  return "Browser microphone or WebRTC media failed";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function telnyxErrorDetails(value: unknown) {
  const outer = record(value);
  const inner = record(outer?.error) ?? outer;
  const code = inner?.code;
  const name = inner?.name;
  const message = inner?.message;
  return {
    callId: typeof outer?.callId === "string" ? outer.callId : null,
    code: typeof code === "number" || typeof code === "string" ? String(code) : null,
    fatal: typeof inner?.fatal === "boolean" ? inner.fatal : null,
    message: typeof message === "string" ? message : null,
    name: typeof name === "string" ? name : null,
  };
}

function isCallDoesNotExist(value: unknown) {
  const details = telnyxErrorDetails(value);
  return (
    details.code === "-32002" ||
    /CALL[\s_]DOES[\s_]NOT[\s_]EXIST/i.test(
      [details.name, details.message].filter(Boolean).join(" "),
    )
  );
}

function isSessionNotReattached(value: unknown) {
  const details = telnyxErrorDetails(value);
  return (
    details.code === "48501" ||
    details.name === "SESSION_NOT_REATTACHED" ||
    details.message === "SESSION_NOT_REATTACHED"
  );
}

function sharesProviderIdentity(
  observation: MediaObservation,
  providerIds: {
    providerCallControlId: string | null;
    providerCallLegId: string | null;
    providerCallSessionId: string | null;
  },
) {
  return observation.correlationProviderIds.some((identity) =>
    Boolean(
      (providerIds.providerCallControlId &&
        identity.providerCallControlId === providerIds.providerCallControlId) ||
      (providerIds.providerCallLegId &&
        identity.providerCallLegId === providerIds.providerCallLegId) ||
      (providerIds.providerCallSessionId &&
        identity.providerCallSessionId === providerIds.providerCallSessionId),
    ),
  );
}

function mediaFailure() {
  const code =
    typeof navigator !== "undefined" && !navigator.onLine
      ? "NETWORK_LOST"
      : "PROVIDER_UNAVAILABLE";
  return operatorErrorCopy(localCallCenterError(code), "connect").message;
}

function playRemoteStream(audio: HTMLAudioElement, stream: MediaStream) {
  audio.autoplay = true;
  audio.setAttribute("playsinline", "true");
  audio.srcObject = stream;
  void audio.play().catch(() => {});
}

function useSoftphoneMediaEngine({
  agentSessionId,
  autoPrepare = false,
  browserSessionId,
  canContinueAnswer,
  enabled,
  onDebug,
  onLifecycle,
  onObservation,
  onRecoveryNeeded,
}: SoftphoneMediaOptions) {
  const clientRef = useRef<TelnyxRTC | null>(null);
  const callsRef = useRef(new Map<string, Call>());
  const observationsRef = useRef<readonly MediaObservation[]>([]);
  const recoveryGenerationRef = useRef(0);
  const connectionRef = useRef<MediaConnectionState>(enabled ? "CONNECTING" : "OFFLINE");
  const providerEnvironmentRef = useRef({ datacenter: null, region: null } as {
    datacenter: string | null;
    region: string | null;
  });
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const attachedMediaLegRef = useRef<string | null>(null);
  const pendingAnswerRef = useRef<PendingAnswer | null>(null);
  const remoteAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const debugRef = useRef(onDebug);
  const canContinueAnswerRef = useRef(canContinueAnswer);
  const lifecycleRef = useRef(onLifecycle);
  const observationRef = useRef(onObservation);
  const recoveryNeededRef = useRef(onRecoveryNeeded);
  const requestedRecoveryRef = useRef(new Set<string>());
  const autoPrepareAttemptedRef = useRef(false);
  const [connection, setConnection] = useState<MediaConnectionState>(
    enabled ? "CONNECTING" : "OFFLINE",
  );
  const [error, setError] = useState<string | null>(null);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [observations, setObservations] = useState<readonly MediaObservation[]>([]);
  const [soundReady, setSoundReady] = useState(false);

  useEffect(() => {
    debugRef.current = onDebug;
  }, [onDebug]);

  useEffect(() => {
    canContinueAnswerRef.current = canContinueAnswer;
  }, [canContinueAnswer]);

  useEffect(() => {
    lifecycleRef.current = onLifecycle;
  }, [onLifecycle]);

  useEffect(() => {
    observationRef.current = onObservation;
  }, [onObservation]);

  useEffect(() => {
    recoveryNeededRef.current = onRecoveryNeeded;
  }, [onRecoveryNeeded]);

  const debug = useCallback((event: string, details: Record<string, unknown> = {}) => {
    debugRef.current?.(event, details);
  }, []);

  const emitLifecycle = useCallback(
    (
      event: Omit<SoftphoneLifecycleEvent, "connectionState" | "datacenter" | "region">,
    ) => {
      lifecycleRef.current?.({
        ...event,
        connectionState: connectionRef.current,
        datacenter: providerEnvironmentRef.current.datacenter,
        region: providerEnvironmentRef.current.region,
      });
    },
    [],
  );

  const updateConnection = useCallback((next: MediaConnectionState) => {
    connectionRef.current = next;
    setConnection(next);
  }, []);

  const commitObservations = useCallback((next: readonly MediaObservation[]) => {
    observationsRef.current = next;
    setObservations(next);
  }, []);

  const invalidateMediaLeg = useCallback(
    (mediaLegId: string, reason: "CALL_DOES_NOT_EXIST" | "SESSION_NOT_REATTACHED") => {
      const observation = observationsRef.current.find(
        (candidate) => candidate.mediaLegId === mediaLegId,
      );
      if (!observation || observation.availability === "FAILED") return;

      callsRef.current.delete(mediaLegId);
      commitObservations(
        observationsRef.current.map((candidate) =>
          candidate.mediaLegId === mediaLegId
            ? { ...candidate, availability: "FAILED" }
            : candidate,
        ),
      );
      const recoveryKey = `${mediaLegId}:${observation.recoveryGeneration}`;
      if (!requestedRecoveryRef.current.has(recoveryKey)) {
        requestedRecoveryRef.current.add(recoveryKey);
        recoveryNeededRef.current?.({
          mediaLegId,
          reason,
          recoveryGeneration: observation.recoveryGeneration,
        });
      }
      debug("telnyx-call-invalidated", {
        mediaLegId,
        reason,
        recoveryGeneration: observation.recoveryGeneration,
      });
      emitLifecycle({
        category: "REATTACH_FAILED",
        connectionGeneration: observation.recoveryGeneration,
        connectionId: observation.connectionId,
        errorCode: reason === "SESSION_NOT_REATTACHED" ? "48501" : "-32002",
        errorFatal: true,
        errorName: reason,
        providerCallControlId: observation.providerCallControlId,
        providerCallLegId: observation.providerCallLegId,
        providerCallSessionId: observation.providerCallSessionId,
        recoveredCallId: observation.recoveredMediaLegId,
        sdkCallId: observation.mediaLegId,
        sdkCallState: observation.state.toLowerCase(),
      });
    },
    [commitObservations, debug, emitLifecycle],
  );

  const emitAnswerOutcome = useCallback(
    (
      pending: PendingAnswer,
      observation: MediaObservation,
      outcome: "FAILED" | "SUCCEEDED",
      error: { code?: string | null; fatal?: boolean | null; name?: string | null } = {},
    ) => {
      if (pending.outcomeRecorded) return;
      pending.outcomeRecorded = true;
      emitLifecycle({
        answerOperationId: pending.operationId,
        answerOutcome: outcome,
        category: outcome === "SUCCEEDED" ? "ANSWER_SUCCEEDED" : "ANSWER_FAILED",
        connectionGeneration: observation.recoveryGeneration,
        connectionId: observation.connectionId,
        ...(error.code ? { errorCode: error.code } : {}),
        ...(typeof error.fatal === "boolean" ? { errorFatal: error.fatal } : {}),
        ...(error.name ? { errorName: error.name } : {}),
        providerCallControlId: observation.providerCallControlId,
        providerCallLegId: observation.providerCallLegId,
        providerCallSessionId: observation.providerCallSessionId,
        recoveredCallId: observation.recoveredMediaLegId,
        sdkCallId: observation.mediaLegId,
        sdkCallState: observation.state.toLowerCase(),
      });
    },
    [emitLifecycle],
  );

  const detachAudio = useCallback(() => {
    if (fallbackAudioRef.current) {
      fallbackAudioRef.current.srcObject = null;
      fallbackAudioRef.current.remove();
      fallbackAudioRef.current = null;
    }
    if (remoteAudioElementRef.current) {
      remoteAudioElementRef.current.srcObject = null;
    }
    attachedMediaLegRef.current = null;
    debug("audio-detached");
  }, [debug]);

  const attachAudio = useCallback(
    (call: Call) => {
      const stream = call.remoteStream;
      if (!stream) {
        debug("audio-attach-skipped", { mediaLegId: call.id });
        return;
      }

      const currentAudio = remoteAudioElementRef.current ?? fallbackAudioRef.current;
      if (attachedMediaLegRef.current === call.id && currentAudio?.srcObject === stream) {
        return;
      }

      detachAudio();
      const audio = remoteAudioElementRef.current ?? document.createElement("audio");
      playRemoteStream(audio, stream);
      if (!remoteAudioElementRef.current) {
        document.body.appendChild(audio);
        fallbackAudioRef.current = audio;
      }
      attachedMediaLegRef.current = call.id;
      debug("audio-attached", { mediaLegId: call.id });
    },
    [debug, detachAudio],
  );

  const prepare = useCallback(async () => {
    const AudioCtxCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    const soundPromise = (async () => {
      if (soundReady) return true;
      if (!AudioCtxCtor) return false;

      const ctx = new AudioCtxCtor();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.03, now + 0.01);
      gain.gain.linearRampToValueAtTime(0, now + 0.06);
      oscillator.frequency.value = 880;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.07);

      try {
        await ctx.resume();
        setSoundReady(true);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => void ctx.close().catch(() => {}), 120);
      }
    })();

    const microphonePromise = (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMicrophoneReady(false);
        return false;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        stream.getTracks().forEach((track) => track.stop());
        setMicrophoneReady(true);
        return true;
      } catch (permissionError) {
        setMicrophoneReady(false);
        debug("microphone-permission-failed", {
          causeName: permissionError instanceof Error ? permissionError.name : "unknown",
        });
        return false;
      }
    })();

    const [audioReady, microphoneAllowed] = await Promise.all([
      soundPromise,
      microphonePromise,
    ]);
    return audioReady && microphoneAllowed;
  }, [debug, soundReady]);

  const setRemoteAudioElement = useCallback((element: HTMLAudioElement | null) => {
    remoteAudioElementRef.current = element;
    if (clientRef.current && element) clientRef.current.remoteElement = element;
  }, []);

  useEffect(() => {
    if (!autoPrepare) {
      autoPrepareAttemptedRef.current = false;
      return;
    }
    if (autoPrepareAttemptedRef.current) return;

    autoPrepareAttemptedRef.current = true;
    void prepare();
  }, [autoPrepare, prepare]);

  useEffect(() => {
    if (!navigator.permissions?.query) return;

    let cancelled = false;
    let permission: PermissionStatus | null = null;
    const syncPermission = () => {
      if (permission?.state !== "granted") setMicrophoneReady(false);
    };

    void navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((status) => {
        if (cancelled) return;
        permission = status;
        syncPermission();
        permission.addEventListener("change", syncPermission);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      permission?.removeEventListener("change", syncPermission);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const adapterConnectionId = connectionId();
    const calls = callsRef.current;
    let cancelled = false;

    async function connect() {
      await Promise.resolve();
      if (cancelled) return;
      updateConnection("CONNECTING");
      try {
        debug("token-request-start");
        if (!agentSessionId || !browserSessionId) {
          throw new Error("Canonical agent session is unavailable");
        }
        const response = await fetch(
          `/api/portal/call-center/agent-sessions/${encodeURIComponent(agentSessionId)}/token`,
          {
            body: JSON.stringify({ clientInstanceId: browserSessionId }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          },
        );
        const data = await readTokenResponse(response);
        debug("token-request-finished", { ok: response.ok, status: response.status });
        if (cancelled) return;

        const { TelnyxRTC } = await import("@telnyx/webrtc");
        if (cancelled) return;

        const auth = data as TelnyxTokenResponse;
        const client =
          "login" in auth && auth.login && auth.password
            ? new TelnyxRTC({ login: auth.login, password: auth.password })
            : new TelnyxRTC({ login_token: (auth as { token: string }).token });
        if (remoteAudioElementRef.current) {
          client.remoteElement = remoteAudioElementRef.current;
        }

        client.on("telnyx.ready", () => {
          if (cancelled) return;
          providerEnvironmentRef.current = {
            datacenter: client.dc ?? null,
            region: client.region ?? null,
          };
          updateConnection("READY");
          setError(null);
          debug("telnyx-ready", { connectionId: adapterConnectionId });
          emitLifecycle({
            category: "SDK_READY",
            connectionGeneration: recoveryGenerationRef.current,
            connectionId: adapterConnectionId,
            providerCallControlId: null,
            providerCallLegId: null,
            providerCallSessionId: null,
            recoveredCallId: null,
            sdkCallId: null,
            sdkCallState: null,
          });
        });
        client.on("telnyx.error", (event) => {
          if (cancelled) return;
          const details = telnyxErrorDetails(event);
          if (isSessionNotReattached(event) && details.callId) {
            invalidateMediaLeg(details.callId, "SESSION_NOT_REATTACHED");
          }
          const pendingAnswer = pendingAnswerRef.current;
          const answerFailed = Boolean(
            pendingAnswer &&
            (event.callId === pendingAnswer.mediaLegId ||
              (!event.callId && event.error?.name?.startsWith("SDP_"))),
          );
          if (answerFailed) {
            const observation = observationsRef.current.find(
              ({ mediaLegId }) => mediaLegId === pendingAnswer?.mediaLegId,
            );
            if (pendingAnswer && observation) {
              emitAnswerOutcome(pendingAnswer, observation, "FAILED", details);
            }
            pendingAnswer?.reject(localCallCenterError("CALL_NOT_CONNECTED", false));
            debug("telnyx-answer-error", {
              causeName: event.error?.name ?? "TelnyxError",
            });
            return;
          }
          if (event.error?.fatal) {
            updateConnection("FAILED");
            setError(mediaFailure());
          } else {
            updateConnection("CONNECTING");
            setError(null);
          }
          debug("telnyx-error", {
            causeName: event.error?.name ?? "TelnyxError",
            fatal: Boolean(event.error?.fatal),
          });
        });
        client.on("telnyx.warning", (event: unknown) => {
          if (!cancelled) debug("telnyx-warning", { message: mediaErrorMessage(event) });
        });
        client.on("telnyx.rtc.mediaError", (event: unknown) => {
          if (cancelled) return;
          updateConnection("FAILED");
          setError(mediaFailure());
          debug("telnyx-media-error", { causeName: "TelnyxMediaError" });
        });
        client.on("telnyx.rtc.peerConnectionFailureError", (event: unknown) => {
          if (cancelled) return;
          updateConnection("FAILED");
          setError(mediaFailure());
          debug("telnyx-peer-connection-failure", {
            causeName: "TelnyxPeerConnectionFailure",
          });
        });
        client.on("telnyx.socket.close", () => {
          if (cancelled) return;
          recoveryGenerationRef.current += 1;
          const recovering = observationsRef.current.map((observation) => ({
            ...observation,
            availability: "RECOVERING" as const,
            recoveryGeneration: recoveryGenerationRef.current,
          }));
          commitObservations(recovering);
          updateConnection("CONNECTING");
          setError(null);
          debug("telnyx-socket-close");
          for (const observation of recovering) {
            emitLifecycle({
              category: "SIGNALING_INTERRUPTED",
              connectionGeneration: observation.recoveryGeneration,
              connectionId: observation.connectionId,
              providerCallControlId: observation.providerCallControlId,
              providerCallLegId: observation.providerCallLegId,
              providerCallSessionId: observation.providerCallSessionId,
              recoveredCallId: observation.recoveredMediaLegId,
              sdkCallId: observation.mediaLegId,
              sdkCallState: observation.state.toLowerCase(),
            });
          }
        });
        client.on("telnyx.notification", (notification: INotification) => {
          if (cancelled || notification.type !== "callUpdate" || !notification.call) {
            return;
          }

          const call = notification.call;
          const providerIds = {
            providerCallControlId: call.telnyxIDs?.telnyxCallControlId ?? null,
            providerCallLegId: call.telnyxIDs?.telnyxLegId ?? null,
            providerCallSessionId: call.telnyxIDs?.telnyxSessionId ?? null,
          };
          const explicitRecoveredMediaLegId = call.recoveredCallId?.trim() || null;
          const currentObservation = observationsRef.current.find(
            (observation) => observation.mediaLegId === call.id,
          );
          const providerPredecessors =
            explicitRecoveredMediaLegId || currentObservation
              ? []
              : observationsRef.current.filter(
                  (observation) =>
                    observation.mediaLegId !== call.id &&
                    observation.availability !== "READY" &&
                    sharesProviderIdentity(observation, providerIds),
                );
          const recoveredMediaLegId =
            explicitRecoveredMediaLegId ??
            currentObservation?.recoveredMediaLegId ??
            (providerPredecessors.length === 1
              ? (providerPredecessors[0]?.mediaLegId ?? null)
              : null);
          const predecessor = recoveredMediaLegId
            ? observationsRef.current.filter(
                (observation) => observation.mediaLegId === recoveredMediaLegId,
              )
            : [];
          const knownReplacement = recoveredMediaLegId
            ? observationsRef.current.some(
                (observation) =>
                  observation.mediaLegId === call.id &&
                  observation.recoveredMediaLegId === recoveredMediaLegId,
              )
            : false;
          if (
            providerPredecessors.length > 1 ||
            (recoveredMediaLegId && predecessor.length !== 1 && !knownReplacement)
          ) {
            debug("telnyx-recovery-correlation-failed", {
              mediaLegId: call.id,
              recoveredMediaLegId,
            });
            emitLifecycle({
              category: "REATTACH_CORRELATION_FAILED",
              connectionGeneration: recoveryGenerationRef.current,
              connectionId: adapterConnectionId,
              providerCallControlId: call.telnyxIDs?.telnyxCallControlId ?? null,
              providerCallLegId: call.telnyxIDs?.telnyxLegId ?? null,
              providerCallSessionId: call.telnyxIDs?.telnyxSessionId ?? null,
              recoveredCallId: recoveredMediaLegId,
              sdkCallId: call.id,
              sdkCallState: call.state,
            });
            return;
          }
          const observation = normalizeMediaObservation({
            availability: "READY",
            connectionId: adapterConnectionId,
            direction: call.direction,
            mediaLegId: call.id,
            providerCallControlId: call.telnyxIDs?.telnyxCallControlId,
            providerCallLegId: call.telnyxIDs?.telnyxLegId,
            providerCallSessionId: call.telnyxIDs?.telnyxSessionId,
            recoveredMediaLegId,
            recoveryGeneration: recoveryGenerationRef.current,
            remoteAudioReady: Boolean(call.remoteStream),
            state: call.state,
          });
          const priorObservation =
            predecessor[0] ??
            observationsRef.current.find(
              (candidate) =>
                candidate.mediaLegId === call.id &&
                candidate.recoveredMediaLegId === recoveredMediaLegId,
            );
          const correlatedObservation = priorObservation
            ? {
                ...observation,
                correlationProviderIds: [
                  ...observation.correlationProviderIds,
                  ...priorObservation.correlationProviderIds,
                ].filter(
                  (identity, index, identities) =>
                    index ===
                    identities.findIndex(
                      (candidate) =>
                        candidate.providerCallControlId ===
                          identity.providerCallControlId &&
                        candidate.providerCallLegId === identity.providerCallLegId &&
                        candidate.providerCallSessionId ===
                          identity.providerCallSessionId,
                    ),
                ),
              }
            : observation;
          calls.set(call.id, call);
          if (recoveredMediaLegId) calls.delete(recoveredMediaLegId);
          const pendingAnswer = pendingAnswerRef.current;
          if (recoveredMediaLegId && pendingAnswer?.mediaLegId === recoveredMediaLegId) {
            const activeElsewhere = observationsRef.current.some(
              (candidate) =>
                candidate.mediaLegId !== recoveredMediaLegId &&
                ["ACTIVE", "HELD"].includes(candidate.state),
            );
            const canContinue =
              !activeElsewhere &&
              (canContinueAnswerRef.current?.(recoveredMediaLegId) ?? true);
            if (!canContinue) {
              emitAnswerOutcome(pendingAnswer, correlatedObservation, "FAILED", {
                name: "ANSWER_INTENT_NO_LONGER_VALID",
              });
              pendingAnswer.reject(localCallCenterError("CALL_NOT_CONNECTED", false));
            } else if (!pendingAnswer.invokedMediaLegIds.has(call.id)) {
              pendingAnswer.mediaLegId = call.id;
              pendingAnswer.invokedMediaLegIds.add(call.id);
              void Promise.resolve(call.answer({ video: false })).catch((error) => {
                const details = telnyxErrorDetails(error);
                if (isCallDoesNotExist(error)) {
                  invalidateMediaLeg(call.id, "CALL_DOES_NOT_EXIST");
                }
                emitAnswerOutcome(
                  pendingAnswer,
                  correlatedObservation,
                  "FAILED",
                  details,
                );
                if (pendingAnswerRef.current?.mediaLegId === call.id) {
                  pendingAnswer.reject(localCallCenterError("CALL_NOT_CONNECTED", false));
                }
              });
            }
          }
          if (pendingAnswer?.mediaLegId === correlatedObservation.mediaLegId) {
            if (["ACTIVE", "HELD"].includes(correlatedObservation.state)) {
              emitAnswerOutcome(pendingAnswer, correlatedObservation, "SUCCEEDED");
              pendingAnswer.resolve();
            } else if (["ENDED", "FAILED"].includes(correlatedObservation.state)) {
              emitAnswerOutcome(pendingAnswer, correlatedObservation, "FAILED", {
                name: "CALL_ENDED",
              });
              pendingAnswer.reject(localCallCenterError("CALL_NOT_CONNECTED", false));
            }
          }
          const terminal = ["ENDED", "FAILED"].includes(correlatedObservation.state);
          const withoutPredecessor = observationsRef.current.filter(
            ({ connectionId, mediaLegId }) =>
              (connectionId !== correlatedObservation.connectionId ||
                mediaLegId !== correlatedObservation.mediaLegId) &&
              mediaLegId !== recoveredMediaLegId,
          );
          commitObservations(
            terminal
              ? withoutPredecessor
              : upsertMediaObservation(withoutPredecessor, correlatedObservation),
          );
          observationRef.current?.(correlatedObservation);
          if (recoveredMediaLegId && predecessor[0]) {
            emitLifecycle({
              category: "REATTACH_SUCCEEDED",
              connectionGeneration: correlatedObservation.recoveryGeneration,
              connectionId: correlatedObservation.connectionId,
              providerCallControlId: correlatedObservation.providerCallControlId,
              providerCallLegId: correlatedObservation.providerCallLegId,
              providerCallSessionId: correlatedObservation.providerCallSessionId,
              recoveredCallId: recoveredMediaLegId,
              sdkCallId: correlatedObservation.mediaLegId,
              sdkCallState: correlatedObservation.state.toLowerCase(),
            });
          }

          if (terminal) {
            calls.delete(call.id);
            if (attachedMediaLegRef.current === call.id) detachAudio();
          }
        });

        debug("telnyx-connect-start", { connectionId: adapterConnectionId });
        client.connect();
        clientRef.current = client;
      } catch (connectError) {
        if (cancelled) return;
        const message = operatorErrorCopy(connectError, "connect").message;
        updateConnection("FAILED");
        setError(message);
        debug("telnyx-connect-failed", { message });
      }
    }

    void connect();

    return () => {
      cancelled = true;
      debug("softphone-cleanup", { connectionId: adapterConnectionId });
      calls.clear();
      if (pendingAnswerRef.current) {
        clearTimeout(pendingAnswerRef.current.timeout);
        pendingAnswerRef.current.reject(localCallCenterError("NETWORK_LOST"));
      }
      pendingAnswerRef.current = null;
      commitObservations(
        observationsRef.current.filter(
          ({ connectionId: id }) => id !== adapterConnectionId,
        ),
      );
      detachAudio();
      const client = clientRef.current;
      for (const event of TELNYX_CLIENT_EVENTS) client?.off(event);
      client?.disconnect();
      clientRef.current = null;
    };
  }, [
    agentSessionId,
    browserSessionId,
    commitObservations,
    debug,
    detachAudio,
    enabled,
    emitAnswerOutcome,
    emitLifecycle,
    invalidateMediaLeg,
    updateConnection,
  ]);

  const callFor = useCallback((mediaLegId: string) => {
    const observation = observationsRef.current.find(
      (candidate) => candidate.mediaLegId === mediaLegId,
    );
    if (observation?.availability !== "READY") {
      throw new Error("Media leg is recovering");
    }
    const call = callsRef.current.get(mediaLegId);
    if (!call) throw new Error("Media leg is no longer available");
    return call;
  }, []);

  const answer = useCallback(
    async (mediaLegId: string) => {
      const call = callFor(mediaLegId);
      const operationId = crypto.randomUUID();
      let resolveConfirmation!: () => void;
      let rejectConfirmation!: (error: Error) => void;
      const confirmation = new Promise<void>((resolve, reject) => {
        resolveConfirmation = resolve;
        rejectConfirmation = reject;
      });
      const pending = {
        invokedMediaLegIds: new Set([mediaLegId]),
        mediaLegId,
        operationId,
        outcomeRecorded: false,
        reject: rejectConfirmation,
        resolve: resolveConfirmation,
        timeout: undefined as unknown as ReturnType<typeof setTimeout>,
      } satisfies PendingAnswer;
      pending.timeout = setTimeout(() => {
        const observation = observationsRef.current.find(
          (candidate) => candidate.mediaLegId === pending.mediaLegId,
        );
        if (observation) {
          emitAnswerOutcome(pending, observation, "FAILED", {
            name: "ANSWER_CONFIRMATION_TIMEOUT",
          });
        }
        rejectConfirmation(localCallCenterError("CALL_NOT_CONNECTED", false));
      }, ANSWER_CONFIRMATION_TIMEOUT_MS);
      pendingAnswerRef.current = pending;
      try {
        void Promise.resolve(call.answer({ video: false })).catch((error) => {
          const observation = observationsRef.current.find(
            (candidate) => candidate.mediaLegId === mediaLegId,
          );
          if (observation) {
            emitAnswerOutcome(pending, observation, "FAILED", telnyxErrorDetails(error));
          }
          if (isCallDoesNotExist(error)) {
            invalidateMediaLeg(mediaLegId, "CALL_DOES_NOT_EXIST");
          }
          if (pendingAnswerRef.current?.mediaLegId === mediaLegId) {
            rejectConfirmation(localCallCenterError("CALL_NOT_CONNECTED", false));
          }
        });
        await confirmation;
      } catch {
        throw localCallCenterError("CALL_NOT_CONNECTED", false);
      } finally {
        if (pendingAnswerRef.current?.operationId === operationId) {
          clearTimeout(pendingAnswerRef.current.timeout);
          pendingAnswerRef.current = null;
        }
      }
    },
    [callFor, emitAnswerOutcome, invalidateMediaLeg],
  );
  const activate = useCallback(
    (mediaLegId: string) => attachAudio(callFor(mediaLegId)),
    [attachAudio, callFor],
  );
  const hangup = useCallback(
    (mediaLegId: string) => callFor(mediaLegId).hangup(),
    [callFor],
  );
  const mute = useCallback(
    (mediaLegId: string, muted: boolean) => {
      const call = callFor(mediaLegId);
      if (muted) call.muteAudio();
      else call.unmuteAudio();
    },
    [callFor],
  );
  const dial = useCallback((input: DialMediaLeg) => {
    const client = clientRef.current;
    if (!client) throw new Error("Softphone is not connected");
    const call = client.newCall(input);
    callsRef.current.set(call.id, call);
    return call.id;
  }, []);
  return {
    activate,
    answer,
    connection: enabled ? connection : "OFFLINE",
    dial,
    error: enabled ? error : null,
    hangup,
    microphoneReady,
    mute,
    observations,
    setRemoteAudioElement,
    soundReady,
  };
}

export function useSoftphoneMedia(options: SoftphoneMediaOptions) {
  return useSoftphoneMediaEngine(options);
}
