"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Call, INotification, TelnyxRTC } from "@telnyx/webrtc";

import {
  type MediaConnectionState,
  type MediaObservation,
} from "./softphone-media-adapter";
import {
  callCenterResponse,
  localCallCenterError,
  operatorErrorCopy,
} from "./call-center-errors";
import {
  isCallDoesNotExist,
  isSessionNotReattached,
  pendingAnswerAction,
  reconcileCallUpdate,
  telnyxErrorDetails,
} from "./softphone-recovery";
import { useSoftphoneBrowserMedia } from "./use-softphone-browser-media";

type TelnyxTokenResponse =
  | { callerNumber?: string; login: string; password: string }
  | { callerNumber?: string; token: string };

export type DialMediaLeg = {
  callerNumber: string;
  clientState: string;
  destinationNumber: string;
};

export type BrowserOfferRecoveryReason =
  "CALL_DOES_NOT_EXIST" | "SDK_CALL_TERMINAL" | "SESSION_NOT_REATTACHED";

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
    reason: BrowserOfferRecoveryReason;
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

function mediaFailure() {
  const code =
    typeof navigator !== "undefined" && !navigator.onLine
      ? "NETWORK_LOST"
      : "PROVIDER_UNAVAILABLE";
  return operatorErrorCopy(localCallCenterError(code), "connect").message;
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
  const pendingAnswerRef = useRef<PendingAnswer | null>(null);
  const debugRef = useRef(onDebug);
  const canContinueAnswerRef = useRef(canContinueAnswer);
  const lifecycleRef = useRef(onLifecycle);
  const observationRef = useRef(onObservation);
  const recoveryNeededRef = useRef(onRecoveryNeeded);
  const requestedRecoveryRef = useRef(new Set<string>());
  const [connection, setConnection] = useState<MediaConnectionState>(
    enabled ? "CONNECTING" : "OFFLINE",
  );
  const [error, setError] = useState<string | null>(null);
  const [observations, setObservations] = useState<readonly MediaObservation[]>([]);

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
  const {
    attachAudio,
    detachAudio,
    microphoneReady,
    prepare,
    remoteAudioElement,
    setRemoteAudioElement: storeRemoteAudioElement,
    soundReady,
  } = useSoftphoneBrowserMedia({ autoPrepare, debug });
  const setRemoteAudioElement = useCallback(
    (element: HTMLAudioElement | null) => {
      storeRemoteAudioElement(element);
      if (clientRef.current && element) clientRef.current.remoteElement = element;
    },
    [storeRemoteAudioElement],
  );

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

  const requestRecovery = useCallback(
    (
      observation: MediaObservation,
      reason: BrowserOfferRecoveryReason,
      correlationMediaLegId = observation.mediaLegId,
    ) => {
      const recoveryKey = `${correlationMediaLegId}:${observation.recoveryGeneration}`;
      if (!requestedRecoveryRef.current.has(recoveryKey)) {
        requestedRecoveryRef.current.add(recoveryKey);
        recoveryNeededRef.current?.({
          mediaLegId: correlationMediaLegId,
          reason,
          recoveryGeneration: observation.recoveryGeneration,
        });
      }
      debug("telnyx-call-invalidated", {
        mediaLegId: observation.mediaLegId,
        reason,
        recoveryGeneration: observation.recoveryGeneration,
      });
      emitLifecycle({
        category: "REATTACH_FAILED",
        connectionGeneration: observation.recoveryGeneration,
        connectionId: observation.connectionId,
        errorCode:
          reason === "SESSION_NOT_REATTACHED"
            ? "48501"
            : reason === "CALL_DOES_NOT_EXIST"
              ? "-32002"
              : reason,
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
    [debug, emitLifecycle],
  );

  const invalidateMediaLeg = useCallback(
    (mediaLegId: string, reason: BrowserOfferRecoveryReason) => {
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
      requestRecovery(observation, reason);
    },
    [commitObservations, requestRecovery],
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
        const audioElement = remoteAudioElement();
        if (audioElement) client.remoteElement = audioElement;

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
          const sessionNotReattached = isSessionNotReattached(event);
          if (sessionNotReattached && details.callId) {
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
          if (sessionNotReattached) {
            debug("telnyx-session-not-reattached", {
              mediaLegId: details.callId ?? "unknown",
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
          const reconciled = reconcileCallUpdate({
            call,
            connectionId: adapterConnectionId,
            current: observationsRef.current,
            recoveryGeneration: recoveryGenerationRef.current,
          });
          if (!reconciled.accepted) {
            debug("telnyx-recovery-correlation-failed", {
              mediaLegId: call.id,
              recoveredMediaLegId: reconciled.recoveredMediaLegId,
            });
            emitLifecycle({
              category: "REATTACH_CORRELATION_FAILED",
              connectionGeneration: recoveryGenerationRef.current,
              connectionId: adapterConnectionId,
              ...reconciled.providerIds,
              recoveredCallId: reconciled.recoveredMediaLegId,
              sdkCallId: call.id,
              sdkCallState: call.state,
            });
            return;
          }
          const {
            nextObservations,
            observation: correlatedObservation,
            priorObservation,
            recoveredMediaLegId,
            terminal,
          } = reconciled;
          calls.set(call.id, call);
          if (recoveredMediaLegId) calls.delete(recoveredMediaLegId);
          const pendingAnswer = pendingAnswerRef.current;
          const answerAction = pendingAnswerAction({
            callId: call.id,
            canContinue: (mediaLegId) =>
              canContinueAnswerRef.current?.(mediaLegId) ?? true,
            current: observationsRef.current,
            observation: correlatedObservation,
            pending: pendingAnswer,
            recoveredMediaLegId,
          });
          if (pendingAnswer) {
            switch (answerAction) {
              case "ANSWER_REPLACEMENT":
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
                    pendingAnswer.reject(
                      localCallCenterError("CALL_NOT_CONNECTED", false),
                    );
                  }
                });
                break;
              case "FAIL":
                emitAnswerOutcome(pendingAnswer, correlatedObservation, "FAILED", {
                  name: "CALL_ENDED",
                });
                pendingAnswer.reject(localCallCenterError("CALL_NOT_CONNECTED", false));
                break;
              case "REJECT":
                emitAnswerOutcome(pendingAnswer, correlatedObservation, "FAILED", {
                  name: "ANSWER_INTENT_NO_LONGER_VALID",
                });
                pendingAnswer.reject(localCallCenterError("CALL_NOT_CONNECTED", false));
                break;
              case "SUCCEED":
                emitAnswerOutcome(pendingAnswer, correlatedObservation, "SUCCEEDED");
                pendingAnswer.resolve();
                break;
              case "NONE":
                break;
            }
          }
          const recoverableTerminal =
            terminal &&
            correlatedObservation.direction === "INBOUND" &&
            priorObservation &&
            ["CONNECTING", "RINGING"].includes(priorObservation.state);
          if (recoverableTerminal) {
            requestRecovery(
              correlatedObservation,
              "SDK_CALL_TERMINAL",
              priorObservation.mediaLegId,
            );
          }
          commitObservations(nextObservations);
          observationRef.current?.(correlatedObservation);
          if (recoveredMediaLegId && priorObservation && !terminal) {
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
            detachAudio(call.id);
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
    remoteAudioElement,
    requestRecovery,
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
