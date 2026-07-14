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

export type LegacySoftphoneCall = {
  direction: string | null;
  id: string;
  options: {
    callerNumber?: string;
    clientState?: string;
    remoteCallerNumber?: string;
  };
  providerCallControlId: string | null;
  providerCallLegId: string | null;
  providerCallSessionId: string | null;
  remoteAudioReady: boolean;
  state: string | null;
};

type DialMediaLeg = {
  callerNumber: string;
  clientState: string;
  destinationNumber: string;
};

type SoftphoneMediaOptions = {
  agentSessionId?: string | null;
  autoPrepare?: boolean;
  browserSessionId: string;
  credentialMode?: "CANONICAL" | "LEGACY";
  enabled: boolean;
  onDebug?: (event: string, details?: Record<string, unknown>) => void;
  onObservation?: (observation: MediaObservation) => void;
  stationSeatId?: string | null;
};

type LegacyObserver = (call: LegacySoftphoneCall) => void;
const TELNYX_CLIENT_EVENTS = [
  "telnyx.error",
  "telnyx.notification",
  "telnyx.ready",
  "telnyx.rtc.mediaError",
  "telnyx.rtc.peerConnectionFailureError",
  "telnyx.socket.close",
  "telnyx.warning",
] as const;

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

function legacyCallSnapshot(call: Call): LegacySoftphoneCall {
  return {
    direction: call.direction ?? null,
    id: call.id,
    options: {
      callerNumber: call.options?.callerNumber,
      clientState: call.options?.clientState,
      remoteCallerNumber: call.options?.remoteCallerNumber,
    },
    providerCallControlId: call.telnyxIDs?.telnyxCallControlId || null,
    providerCallLegId: call.telnyxIDs?.telnyxLegId || null,
    providerCallSessionId: call.telnyxIDs?.telnyxSessionId || null,
    remoteAudioReady: Boolean(call.remoteStream),
    state: call.state ?? null,
  };
}

function useSoftphoneMediaEngine({
  agentSessionId,
  autoPrepare = false,
  browserSessionId,
  credentialMode = "LEGACY",
  enabled,
  onDebug,
  onObservation,
  stationSeatId,
}: SoftphoneMediaOptions) {
  const clientRef = useRef<TelnyxRTC | null>(null);
  const callsRef = useRef(new Map<string, Call>());
  const legacyObserversRef = useRef(new Set<LegacyObserver>());
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const attachedMediaLegRef = useRef<string | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const debugRef = useRef(onDebug);
  const observationRef = useRef(onObservation);
  const autoPrepareAttemptedRef = useRef(false);
  const [connection, setConnection] = useState<MediaConnectionState>(
    enabled ? "CONNECTING" : "OFFLINE",
  );
  const [error, setError] = useState<string | null>(null);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [observations, setObservations] = useState<readonly MediaObservation[]>([]);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupPending, setSetupPending] = useState(false);
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
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
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

      const currentAudio = remoteAudioRef.current ?? fallbackAudioRef.current;
      if (attachedMediaLegRef.current === call.id && currentAudio?.srcObject === stream) {
        return;
      }

      detachAudio();
      const audio = remoteAudioRef.current ?? document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      audio.srcObject = stream;
      if (!remoteAudioRef.current) {
        document.body.appendChild(audio);
        fallbackAudioRef.current = audio;
      }
      attachedMediaLegRef.current = call.id;
      void audio.play().catch(() => {});
      debug("audio-attached", { mediaLegId: call.id });
    },
    [debug, detachAudio],
  );

  const prepare = useCallback(async () => {
    setSetupError(null);
    setSetupPending(true);

    try {
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
          setSetupError("This browser does not support microphone access.");
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
          setSetupError(
            operatorErrorCopy(localCallCenterError("MICROPHONE_REQUIRED"), "readiness")
              .message,
          );
          debug("microphone-permission-failed", {
            causeName:
              permissionError instanceof Error ? permissionError.name : "unknown",
          });
          return false;
        }
      })();

      const [audioReady, microphoneAllowed] = await Promise.all([
        soundPromise,
        microphonePromise,
      ]);

      if (!microphoneAllowed) return false;
      if (!audioReady) {
        setSetupError("Browser sound is blocked. Select Ready and allow audio playback.");
        return false;
      }

      setSetupError(null);
      return true;
    } finally {
      setSetupPending(false);
    }
  }, [debug, soundReady]);

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
    if (!enabled) {
      setConnection("OFFLINE");
      setError(null);
      return;
    }

    const adapterConnectionId = connectionId();
    const calls = callsRef.current;
    let cancelled = false;
    setConnection("CONNECTING");

    async function connect() {
      try {
        debug("token-request-start");
        let response: Response;
        if (credentialMode === "CANONICAL") {
          if (!agentSessionId || !browserSessionId) {
            throw new Error("Canonical agent session is unavailable");
          }
          response = await fetch(
            `/api/portal/call-center/agent-sessions/${encodeURIComponent(agentSessionId)}/token`,
            {
              body: JSON.stringify({
                clientInstanceId: browserSessionId,
              }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            },
          );
        } else {
          const params = new URLSearchParams();
          if (stationSeatId) params.set("seatId", stationSeatId);
          if (browserSessionId) params.set("browserSessionId", browserSessionId);
          const query = params.toString();
          response = await fetch(
            `/api/portal/call-center/telnyx-token${query ? `?${query}` : ""}`,
          );
        }
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
        if (remoteAudioRef.current) client.remoteElement = remoteAudioRef.current;

        client.on("telnyx.ready", () => {
          if (cancelled) return;
          setConnection("READY");
          setError(null);
          debug("telnyx-ready", { connectionId: adapterConnectionId });
        });
        client.on("telnyx.error", (event) => {
          if (cancelled) return;
          if (event.error?.fatal) {
            setConnection("FAILED");
            setError(mediaFailure());
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
          debug("telnyx-media-error", { causeName: "TelnyxMediaError" });
        });
        client.on("telnyx.rtc.peerConnectionFailureError", (event: unknown) => {
          if (cancelled) return;
          setConnection("FAILED");
          setError(mediaFailure());
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
            connectionId: adapterConnectionId,
            direction: call.direction,
            mediaLegId: call.id,
            providerCallControlId: call.telnyxIDs?.telnyxCallControlId,
            providerCallLegId: call.telnyxIDs?.telnyxLegId,
            providerCallSessionId: call.telnyxIDs?.telnyxSessionId,
            remoteAudioReady: Boolean(call.remoteStream),
            state: call.state,
          });
          setObservations((current) => upsertMediaObservation(current, observation));
          observationRef.current?.(observation);

          if (["destroy", "hangup", "purge"].includes(call.state || "")) {
            calls.delete(call.id);
            if (attachedMediaLegRef.current === call.id) detachAudio();
          }

          const legacySnapshot = legacyCallSnapshot(call);
          for (const observer of legacyObserversRef.current) observer(legacySnapshot);
        });

        debug("telnyx-connect-start", { connectionId: adapterConnectionId });
        client.connect();
        clientRef.current = client;
      } catch (connectError) {
        if (cancelled) return;
        const message = operatorErrorCopy(connectError, "connect").message;
        setConnection("FAILED");
        setError(message);
        debug("telnyx-connect-failed", { message });
      }
    }

    void connect();

    return () => {
      cancelled = true;
      debug("softphone-cleanup", { connectionId: adapterConnectionId });
      calls.clear();
      setObservations((current) =>
        current.filter(({ connectionId: id }) => id !== adapterConnectionId),
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
    credentialMode,
    debug,
    detachAudio,
    enabled,
    stationSeatId,
  ]);

  const callFor = useCallback((mediaLegId: string) => {
    const call = callsRef.current.get(mediaLegId);
    if (!call) throw new Error("Media leg is no longer available");
    return call;
  }, []);

  const answer = useCallback(
    (mediaLegId: string) => callFor(mediaLegId).answer({ video: false }),
    [callFor],
  );
  const activate = useCallback(
    (mediaLegId: string) => attachAudio(callFor(mediaLegId)),
    [attachAudio, callFor],
  );
  const deactivate = useCallback(
    (mediaLegId: string) => {
      if (attachedMediaLegRef.current !== mediaLegId) return false;
      detachAudio();
      return true;
    },
    [detachAudio],
  );
  const decline = useCallback(
    (mediaLegId: string) => callFor(mediaLegId).hangup(),
    [callFor],
  );
  const hangup = decline;
  const hold = useCallback(
    (mediaLegId: string, held: boolean) => {
      const call = callFor(mediaLegId);
      return held ? call.hold() : call.unhold();
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
  const sendDtmf = useCallback(
    (mediaLegId: string, digit: string) => callFor(mediaLegId).dtmf(digit),
    [callFor],
  );
  const dial = useCallback((input: DialMediaLeg) => {
    const client = clientRef.current;
    if (!client) throw new Error("Softphone is not connected");
    const call = client.newCall(input);
    callsRef.current.set(call.id, call);
    return call.id;
  }, []);
  const subscribeLegacy = useCallback((observer: LegacyObserver) => {
    legacyObserversRef.current.add(observer);
    return () => {
      legacyObserversRef.current.delete(observer);
    };
  }, []);

  return {
    activate,
    answer,
    connection,
    deactivate,
    decline,
    dial,
    error,
    hangup,
    hold,
    microphoneReady,
    mute,
    observations,
    prepare,
    remoteAudioRef,
    sendDtmf,
    setupError,
    setupPending,
    soundReady,
    subscribeLegacy,
  };
}

export function useSoftphoneMedia(options: SoftphoneMediaOptions) {
  const { subscribeLegacy: _subscribeLegacy, ...media } =
    useSoftphoneMediaEngine(options);
  return media;
}

/** Temporary phone-aware bridge used only by the legacy panel until Phase 5B. */
export function useLegacySoftphoneMedia(options: SoftphoneMediaOptions) {
  return useSoftphoneMediaEngine(options);
}
