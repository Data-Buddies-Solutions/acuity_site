"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Call, INotification, TelnyxRTC } from "@telnyx/webrtc";

import { CallCenterRequestError } from "@/lib/call-center/operator-error";

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
import { callCenterRetryDelay } from "./call-center-retry";

type TelnyxTokenResponse =
  | { callerNumber?: string; login: string; password: string }
  | { callerNumber?: string; token: string };

type DialMediaLeg = {
  callerNumber: string;
  clientState: string;
  destinationNumber: string;
};

type SoftphoneMediaOptions = {
  agentSessionId: string | null;
  autoPrepare?: boolean;
  browserSessionId: string;
  enabled: boolean;
  onDebug?: (event: string, details?: Record<string, unknown>) => void;
  onObservation?: (observation: MediaObservation) => void;
  retryBaseMs?: number;
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

function isRetryableConnectError(error: unknown) {
  return !(error instanceof CallCenterRequestError) || error.operatorError.retryable;
}

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
  enabled,
  onDebug,
  onObservation,
  retryBaseMs = 1_000,
}: SoftphoneMediaOptions) {
  const clientRef = useRef<TelnyxRTC | null>(null);
  const callsRef = useRef(new Map<string, Call>());
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const attachedMediaLegRef = useRef<string | null>(null);
  const pendingAnswerRef = useRef<{
    mediaLegId: string;
    reject(error: Error): void;
    resolve(): void;
    timeout: ReturnType<typeof setTimeout>;
  } | null>(null);
  const remoteAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const debugRef = useRef(onDebug);
  const observationRef = useRef(onObservation);
  const autoPrepareAttemptedRef = useRef(false);
  const [connection, setConnection] = useState<MediaConnectionState>(
    enabled ? "CONNECTING" : "OFFLINE",
  );
  const [error, setError] = useState<string | null>(null);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [observations, setObservations] = useState<readonly MediaObservation[]>([]);
  const [soundReady, setSoundReady] = useState(false);

  useEffect(() => {
    debugRef.current = onDebug;
  }, [onDebug]);

  useEffect(() => {
    observationRef.current = onObservation;
  }, [onObservation]);

  const debug = useCallback((event: string, details: Record<string, unknown> = {}) => {
    debugRef.current?.(event, details);
  }, []);

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
        setMicrophoneError(null);
        return true;
      } catch (permissionError) {
        setMicrophoneReady(false);
        setMicrophoneError(
          "Microphone access is blocked. Allow microphone access in your browser, then retry.",
        );
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
    let connecting = false;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const retireClient = (client: TelnyxRTC | null) => {
      if (!client) return;
      for (const event of TELNYX_CLIENT_EVENTS) client.off(event);
      client.disconnect();
      if (clientRef.current === client) clientRef.current = null;
    };

    const scheduleRetry = () => {
      if (cancelled || retryTimer) return;
      const delay = callCenterRetryDelay(retryAttempt, retryBaseMs);
      retryAttempt += 1;
      debug("telnyx-retry-scheduled", { attempt: retryAttempt, delayMs: delay });
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
    };

    async function connect() {
      if (cancelled || connecting) return;
      connecting = true;
      await Promise.resolve();
      if (cancelled) {
        connecting = false;
        return;
      }
      setConnection("CONNECTING");
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
          retryAttempt = 0;
          if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
          }
          setConnection("READY");
          setError(null);
          debug("telnyx-ready", { connectionId: adapterConnectionId });
        });
        client.on("telnyx.error", (event) => {
          if (cancelled) return;
          const pendingAnswer = pendingAnswerRef.current;
          const answerFailed = Boolean(
            pendingAnswer &&
            (event.callId === pendingAnswer.mediaLegId ||
              (!event.callId && event.error?.name?.startsWith("SDP_"))),
          );
          if (answerFailed) {
            pendingAnswer?.reject(localCallCenterError("CALL_NOT_CONNECTED", false));
            debug("telnyx-answer-error", {
              causeName: event.error?.name ?? "TelnyxError",
            });
            return;
          }
          if (event.error?.name === "HOLD_FAILED") {
            debug("telnyx-hold-error", { causeName: event.error.name });
            return;
          }
          if (event.error?.fatal) {
            setConnection("FAILED");
            setError(mediaFailure());
            retireClient(client);
            scheduleRetry();
          } else {
            setConnection("CONNECTING");
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
          setConnection("FAILED");
          setError(mediaFailure());
          retireClient(client);
          scheduleRetry();
          debug("telnyx-media-error", { causeName: "TelnyxMediaError" });
        });
        client.on("telnyx.rtc.peerConnectionFailureError", (event: unknown) => {
          if (cancelled) return;
          setConnection("FAILED");
          setError(mediaFailure());
          retireClient(client);
          scheduleRetry();
          debug("telnyx-peer-connection-failure", {
            causeName: "TelnyxPeerConnectionFailure",
          });
        });
        client.on("telnyx.socket.close", () => {
          if (cancelled) return;
          setConnection("CONNECTING");
          setError(null);
          debug("telnyx-socket-close");
        });
        client.on("telnyx.notification", (notification: INotification) => {
          if (cancelled || notification.type !== "callUpdate" || !notification.call) {
            return;
          }

          const call = notification.call;
          calls.set(call.id, call);
          const observation = normalizeMediaObservation({
            clientState: call.options?.clientState,
            connectionId: adapterConnectionId,
            direction: call.direction,
            mediaLegId: call.id,
            providerCallControlId: call.telnyxIDs?.telnyxCallControlId,
            providerCallLegId: call.telnyxIDs?.telnyxLegId,
            providerCallSessionId: call.telnyxIDs?.telnyxSessionId,
            remoteAudioReady: Boolean(call.remoteStream),
            state: call.state,
          });
          const pendingAnswer = pendingAnswerRef.current;
          if (pendingAnswer?.mediaLegId === observation.mediaLegId) {
            if (["ACTIVE", "HELD"].includes(observation.state)) {
              pendingAnswer.resolve();
            } else if (["ENDED", "FAILED"].includes(observation.state)) {
              pendingAnswer.reject(localCallCenterError("CALL_NOT_CONNECTED", false));
            }
          }
          const terminal = ["ENDED", "FAILED"].includes(observation.state);
          setObservations((current) =>
            terminal
              ? current.filter(
                  ({ connectionId, mediaLegId }) =>
                    connectionId !== observation.connectionId ||
                    mediaLegId !== observation.mediaLegId,
                )
              : upsertMediaObservation(current, observation),
          );
          observationRef.current?.(observation);

          if (terminal) {
            calls.delete(call.id);
            if (attachedMediaLegRef.current === call.id) detachAudio();
          }
        });

        debug("telnyx-connect-start", { connectionId: adapterConnectionId });
        clientRef.current = client;
        client.connect();
      } catch (connectError) {
        if (cancelled) return;
        const message = operatorErrorCopy(connectError, "connect").message;
        setConnection("FAILED");
        setError(message);
        debug("telnyx-connect-failed", { message });
        if (isRetryableConnectError(connectError)) scheduleRetry();
      } finally {
        connecting = false;
      }
    }

    void connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      debug("softphone-cleanup", { connectionId: adapterConnectionId });
      calls.clear();
      if (pendingAnswerRef.current) {
        clearTimeout(pendingAnswerRef.current.timeout);
        pendingAnswerRef.current.reject(localCallCenterError("NETWORK_LOST"));
      }
      pendingAnswerRef.current = null;
      setObservations((current) =>
        current.filter(({ connectionId: id }) => id !== adapterConnectionId),
      );
      detachAudio();
      retireClient(clientRef.current);
    };
  }, [agentSessionId, browserSessionId, debug, detachAudio, enabled, retryBaseMs]);

  const callFor = useCallback((mediaLegId: string) => {
    const call = callsRef.current.get(mediaLegId);
    if (!call) throw new Error("Media leg is no longer available");
    return call;
  }, []);

  const answer = useCallback(
    async (mediaLegId: string) => {
      const call = callFor(mediaLegId);
      let resolveConfirmation!: () => void;
      let rejectConfirmation!: (error: Error) => void;
      const confirmation = new Promise<void>((resolve, reject) => {
        resolveConfirmation = resolve;
        rejectConfirmation = reject;
      });
      const timeout = setTimeout(
        () => rejectConfirmation(localCallCenterError("CALL_NOT_CONNECTED", false)),
        ANSWER_CONFIRMATION_TIMEOUT_MS,
      );
      pendingAnswerRef.current = {
        mediaLegId,
        reject: rejectConfirmation,
        resolve: resolveConfirmation,
        timeout,
      };
      try {
        void Promise.resolve(call.answer({ video: false })).catch(() => {
          if (pendingAnswerRef.current?.mediaLegId === mediaLegId) {
            rejectConfirmation(localCallCenterError("CALL_NOT_CONNECTED", false));
          }
        });
        await confirmation;
      } catch {
        throw localCallCenterError("CALL_NOT_CONNECTED", false);
      } finally {
        if (pendingAnswerRef.current?.mediaLegId === mediaLegId) {
          clearTimeout(pendingAnswerRef.current.timeout);
          pendingAnswerRef.current = null;
        }
      }
    },
    [callFor],
  );
  const activate = useCallback(
    (mediaLegId: string) => attachAudio(callFor(mediaLegId)),
    [attachAudio, callFor],
  );
  const hangup = useCallback(
    (mediaLegId: string) => callFor(mediaLegId).hangup(),
    [callFor],
  );
  const hold = useCallback(
    async (mediaLegId: string, held: boolean) => {
      const call = callFor(mediaLegId);
      const changed = await (held ? call.hold() : call.unhold());
      if (!changed) throw localCallCenterError("PROVIDER_UNAVAILABLE", true);
      setObservations((current) =>
        current.map((observation) =>
          observation.mediaLegId === mediaLegId
            ? { ...observation, state: held ? "HELD" : "ACTIVE" }
            : observation,
        ),
      );
    },
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
  const dtmf = useCallback(
    (mediaLegId: string, digit: string) => callFor(mediaLegId).dtmf(digit),
    [callFor],
  );
  return {
    activate,
    answer,
    connection: enabled ? connection : "OFFLINE",
    dial,
    dtmf,
    error: enabled ? error : null,
    hangup,
    hold,
    microphoneError,
    microphoneReady,
    mute,
    observations,
    prepare,
    setRemoteAudioElement,
    soundReady,
  };
}

export function useSoftphoneMedia(options: SoftphoneMediaOptions) {
  return useSoftphoneMediaEngine(options);
}
