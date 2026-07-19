"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { AgentSessionView, CallView } from "@/lib/call-center/realtime-contract";
import type { BrowserLifecycleEvent } from "@/lib/call-center/application/record-browser-lifecycle";

import {
  claimCallCenterClientInstance,
  type CallCenterClientInstance,
} from "./call-center/call-center-client-instance";
import type { MediaObservation } from "./call-center/softphone-media-adapter";
import {
  type CanonicalAgentConnectionState,
  useCanonicalAgentSession,
} from "./call-center/use-canonical-agent-session";
import { selectCanonicalBrowserMediaLeg } from "./call-center/canonical-active-call-center";
import { useIncomingCallRingtone } from "./call-center/use-incoming-call-ringtone";
import {
  useSoftphoneMedia,
  type DialMediaLeg,
  type SoftphoneLifecycleEvent,
} from "./call-center/use-softphone";

const PHONE_OWNER_CHANNEL = "acuity-call-center-phone-owner";
const PHONE_ACTIVE_ELSEWHERE = "Phone active in another tab";
const TELNYX_WEBRTC_SDK_VERSION = "2.27.3";
const TELEMETRY_BATCH_SIZE = 20;

export function phoneOwnerMessageError(
  data: unknown,
  clientInstanceId: string,
): string | null {
  return data &&
    typeof data === "object" &&
    "clientInstanceId" in data &&
    data.clientInstanceId !== clientInstanceId
    ? PHONE_ACTIVE_ELSEWHERE
    : null;
}

function canonicalConnectionState(
  state: ReturnType<typeof useSoftphoneMedia>["connection"],
): CanonicalAgentConnectionState {
  switch (state) {
    case "READY":
      return "READY";
    case "CONNECTING":
      return "CONNECTING";
    case "FAILED":
      return "ERROR";
    case "OFFLINE":
      return "CLOSED";
  }
}

export function selectSoftphoneRuntimeCalls(
  observations: readonly MediaObservation[],
  answeringMediaLegId: string | null,
) {
  const active =
    observations.find(({ state }) => ["ACTIVE", "HELD"].includes(state)) ?? null;
  const incoming = observations.filter(
    ({ direction, state }) =>
      direction === "INBOUND" && ["CONNECTING", "RINGING"].includes(state),
  );
  const answering =
    answeringMediaLegId &&
    observations.some(
      ({ mediaLegId, state }) =>
        mediaLegId === answeringMediaLegId &&
        ["ACTIVE", "CONNECTING", "HELD", "RINGING"].includes(state),
    )
      ? answeringMediaLegId
      : null;
  return {
    active,
    answeringMediaLegId: answering,
    incoming,
    ringtoneOfferId: active || answering ? null : (incoming[0]?.mediaLegId ?? null),
  };
}

type RuntimeCallBinding = ReturnType<typeof selectCanonicalBrowserMediaLeg>;

export function selectSoftphoneRuntimeBinding(
  callId: string,
  calls: readonly CallView[],
  session: Pick<AgentSessionView, "endpointId" | "id"> | null,
  observations: readonly MediaObservation[],
) {
  if (!session) return null;
  const call = calls.find((candidate) => candidate.id === callId);
  return call
    ? selectCanonicalBrowserMediaLeg(call, session.id, session.endpointId, observations)
    : null;
}

export function isCanonicalOfferAnswerable(
  callId: string,
  calls: readonly Pick<CallView, "id" | "status" | "winningLegId">[],
) {
  const call = calls.find((candidate) => candidate.id === callId);
  return Boolean(
    call &&
    call.status === "RINGING" &&
    !call.winningLegId &&
    !calls.some((candidate) => candidate.status === "CONNECTED"),
  );
}

type RuntimeMediaActions = {
  activate(mediaLegId: string): void;
  answer(mediaLegId: string): Promise<void>;
  hangup(mediaLegId: string): void;
  mute(mediaLegId: string, muted: boolean): void;
};

function readyMediaLeg(binding: RuntimeCallBinding) {
  if (!binding || binding.observation.availability !== "READY") {
    throw new Error("The call is reconnecting");
  }
  return binding.observation.mediaLegId;
}

export function createSoftphoneRuntimeCallActions(
  resolve: (callId: string) => RuntimeCallBinding,
  media: RuntimeMediaActions,
) {
  return {
    activate(callId: string) {
      media.activate(readyMediaLeg(resolve(callId)));
    },
    answer(callId: string) {
      return media.answer(readyMediaLeg(resolve(callId)));
    },
    hangup(callId: string) {
      media.hangup(readyMediaLeg(resolve(callId)));
    },
    mute(callId: string, muted: boolean) {
      media.mute(readyMediaLeg(resolve(callId)), muted);
    },
  };
}

type SoftphoneRuntimeValue = {
  activate(callId: string): void;
  answer(callId: string): Promise<void>;
  answeringCallId: string | null;
  callAvailability(callId: string): MediaObservation["availability"] | "PREPARING";
  clientInstanceId: string | null;
  dial(callId: string, input: DialMediaLeg): void;
  error: string | null;
  hangup(callId: string): void;
  mute(callId: string, muted: boolean): void;
  ringtone: ReturnType<typeof useIncomingCallRingtone>;
  session: AgentSessionView | null;
  synchronizeCalls(calls: readonly CallView[]): void;
  takeover(): Promise<void>;
};

const SoftphoneContext = createContext<SoftphoneRuntimeValue | null>(null);

export function SoftphoneRuntime({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<CallCenterClientInstance | null>(null);
  const [, setCanonicalCalls] = useState<readonly CallView[]>([]);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [answeringCallId, setAnsweringCallId] = useState<string | null>(null);
  const [mediaReadiness, setMediaReadiness] = useState({
    audioReady: false,
    connectionState: "CLOSED" as CanonicalAgentConnectionState,
    microphoneReady: false,
  });
  const answeringRef = useRef<string | null>(null);
  const canonicalCallsRef = useRef<readonly CallView[]>([]);
  const mediaObservationsRef = useRef(new Map<string, MediaObservation>());
  const ownerChannelRef = useRef<BroadcastChannel | null>(null);
  const sessionRef = useRef<AgentSessionView | null>(null);
  const telemetryQueueRef = useRef<BrowserLifecycleEvent[]>([]);
  const telemetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientInstanceId = client?.clientInstanceId ?? null;

  useEffect(() => {
    let active = true;
    let claimed: CallCenterClientInstance | null = null;
    void claimCallCenterClientInstance()
      .then((next) => {
        if (!active) {
          next.release();
          return;
        }
        claimed = next;
        setClient(next);
      })
      .catch(() => {
        if (active) setIdentityError("Phone disconnected — reconnecting");
      });
    return () => {
      active = false;
      claimed?.release();
    };
  }, []);

  const agentSession = useCanonicalAgentSession({
    ...mediaReadiness,
    clientInstanceId,
    presence:
      mediaReadiness.connectionState === "READY" &&
      mediaReadiness.audioReady &&
      mediaReadiness.microphoneReady
        ? "AVAILABLE"
        : clientInstanceId
          ? "PAUSED"
          : "OFFLINE",
  });
  const session = agentSession.session;
  sessionRef.current = session;
  const startSession = agentSession.start;
  const stopSession = agentSession.stop;
  const onObservation = useCallback((observation: MediaObservation) => {
    mediaObservationsRef.current.set(observation.mediaLegId, observation);
  }, []);
  const flushTelemetry = useCallback(() => {
    if (telemetryTimerRef.current) {
      clearTimeout(telemetryTimerRef.current);
      telemetryTimerRef.current = null;
    }
    const events = telemetryQueueRef.current.splice(0, TELEMETRY_BATCH_SIZE);
    if (!events.length) return;
    void fetch("/api/portal/call-center/browser-events", {
      body: JSON.stringify({ events }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }).catch(() => {});
    if (telemetryQueueRef.current.length) {
      telemetryTimerRef.current = setTimeout(flushTelemetry, 0);
    }
  }, []);
  const queueLifecycleEvent = useCallback(
    (event: SoftphoneLifecycleEvent) => {
      const currentSession = sessionRef.current;
      if (!currentSession || !clientInstanceId) return;
      const observation = event.sdkCallId
        ? mediaObservationsRef.current.get(event.sdkCallId)
        : null;
      const matches = observation
        ? canonicalCallsRef.current.flatMap((call) => {
            const binding = selectSoftphoneRuntimeBinding(
              call.id,
              [call],
              currentSession,
              [observation],
            );
            return binding ? [{ binding, call }] : [];
          })
        : [];
      const match = matches.length === 1 ? matches[0] : null;
      telemetryQueueRef.current.push({
        agentSessionId: currentSession.id,
        ...(event.answerOperationId
          ? { answerOperationId: event.answerOperationId }
          : {}),
        ...(event.answerOutcome ? { answerOutcome: event.answerOutcome } : {}),
        browserClientInstanceId: clientInstanceId,
        callId: match?.call.id ?? null,
        callLegId: match?.binding.leg.id ?? null,
        category: event.category,
        connectionGeneration: event.connectionGeneration,
        connectionId: event.connectionId,
        connectionState: event.connectionState,
        datacenter: event.datacenter,
        deploymentRevision:
          process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
          process.env.NEXT_PUBLIC_GIT_COMMIT_SHA ??
          null,
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        ...(typeof event.errorFatal === "boolean"
          ? { errorFatal: event.errorFatal }
          : {}),
        ...(event.errorName ? { errorName: event.errorName } : {}),
        eventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        providerCallControlId: event.providerCallControlId,
        providerCallLegId: event.providerCallLegId,
        providerCallSessionId: event.providerCallSessionId,
        recoveredCallId: event.recoveredCallId,
        region: event.region,
        sdkCallId: event.sdkCallId,
        sdkCallState: event.sdkCallState,
        sdkVersion: TELNYX_WEBRTC_SDK_VERSION,
      });
      if (telemetryQueueRef.current.length >= TELEMETRY_BATCH_SIZE) {
        flushTelemetry();
      } else if (!telemetryTimerRef.current) {
        telemetryTimerRef.current = setTimeout(flushTelemetry, 250);
      }
    },
    [clientInstanceId, flushTelemetry],
  );
  useEffect(
    () => () => {
      flushTelemetry();
    },
    [flushTelemetry],
  );
  const requestReplacement = useCallback(
    (request: {
      mediaLegId: string;
      reason: "CALL_DOES_NOT_EXIST" | "SESSION_NOT_REATTACHED";
      recoveryGeneration: number;
    }) => {
      const currentSession = sessionRef.current;
      const observation = mediaObservationsRef.current.get(request.mediaLegId);
      if (!currentSession || !observation || !clientInstanceId) return;
      const matches = canonicalCallsRef.current.flatMap((call) => {
        const binding = selectSoftphoneRuntimeBinding(call.id, [call], currentSession, [
          observation,
        ]);
        return binding ? [{ binding, call }] : [];
      });
      if (matches.length !== 1) return;
      const [{ binding, call }] = matches;
      const recoveryKey =
        `browser-recovery:${call.id}:${binding.leg.id}:` + request.recoveryGeneration;
      const send = async () => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const response = await fetch(
              `/api/portal/call-center/calls/${encodeURIComponent(call.id)}/recover-offer`,
              {
                body: JSON.stringify({
                  agentSessionId: currentSession.id,
                  callLegId: binding.leg.id,
                  clientInstanceId,
                  reason: request.reason,
                  recoveryGeneration: request.recoveryGeneration,
                }),
                headers: {
                  "Content-Type": "application/json",
                  "Idempotency-Key": recoveryKey,
                },
                method: "POST",
              },
            );
            if (response.ok || response.status < 500) return;
          } catch {
            // Retry once through the same durable idempotency boundary.
          }
        }
      };
      void send();
    },
    [clientInstanceId],
  );
  const canAnswerCanonicalOffer = useCallback(
    (callId: string) => isCanonicalOfferAnswerable(callId, canonicalCallsRef.current),
    [],
  );
  const canContinueAnswer = useCallback(
    (mediaLegId: string) => {
      const currentSession = sessionRef.current;
      const observation = mediaObservationsRef.current.get(mediaLegId);
      if (!currentSession || !observation) return false;
      const matches = canonicalCallsRef.current.flatMap((call) => {
        const binding = selectSoftphoneRuntimeBinding(call.id, [call], currentSession, [
          observation,
        ]);
        return binding ? [{ binding, call }] : [];
      });
      return matches.length === 1 && canAnswerCanonicalOffer(matches[0]?.call.id ?? "");
    },
    [canAnswerCanonicalOffer],
  );
  const { setRemoteAudioElement, ...media } = useSoftphoneMedia({
    agentSessionId: session?.id ?? null,
    autoPrepare: Boolean(session),
    browserSessionId: clientInstanceId ?? "",
    canContinueAnswer,
    enabled: Boolean(session),
    onLifecycle: queueLifecycleEvent,
    onObservation,
    onRecoveryNeeded: requestReplacement,
  });
  useEffect(() => {
    mediaObservationsRef.current.clear();
    for (const observation of media.observations) {
      mediaObservationsRef.current.set(observation.mediaLegId, observation);
    }
  }, [media.observations]);
  const bindingFor = useCallback(
    (callId: string) =>
      selectSoftphoneRuntimeBinding(
        callId,
        canonicalCallsRef.current,
        sessionRef.current,
        media.observations,
      ),
    [media.observations],
  );
  const callActions = useMemo(
    () => createSoftphoneRuntimeCallActions(bindingFor, media),
    [bindingFor, media],
  );
  const synchronizeCalls = useCallback((calls: readonly CallView[]) => {
    canonicalCallsRef.current = calls;
    setCanonicalCalls(calls);
  }, []);

  useEffect(() => {
    const next = {
      audioReady: media.soundReady,
      connectionState: canonicalConnectionState(media.connection),
      microphoneReady: media.microphoneReady,
    };
    // Provider readiness is an external subscription snapshot.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMediaReadiness((current) =>
      current.audioReady === next.audioReady &&
      current.connectionState === next.connectionState &&
      current.microphoneReady === next.microphoneReady
        ? current
        : next,
    );
  }, [media.connection, media.microphoneReady, media.soundReady]);

  useEffect(() => {
    if (clientInstanceId) void startSession();
    return () => {
      if (clientInstanceId) void stopSession();
    };
  }, [clientInstanceId, startSession, stopSession]);

  useEffect(() => {
    if (!clientInstanceId || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(PHONE_OWNER_CHANNEL);
    ownerChannelRef.current = channel;
    channel.onmessage = ({ data }) => {
      const ownershipError = phoneOwnerMessageError(data, clientInstanceId);
      if (ownershipError) {
        setIdentityError(ownershipError);
        void stopSession();
      }
    };
    return () => {
      ownerChannelRef.current = null;
      channel.close();
    };
  }, [clientInstanceId, stopSession]);

  const answeringBinding = answeringCallId ? bindingFor(answeringCallId) : null;
  const calls = selectSoftphoneRuntimeCalls(
    media.observations,
    answeringBinding?.observation.mediaLegId ?? null,
  );
  const ringtone = useIncomingCallRingtone(calls.ringtoneOfferId);

  useEffect(() => {
    const active = media.observations.find(({ state }) =>
      ["ACTIVE", "HELD"].includes(state),
    );
    if (active) media.activate(active.mediaLegId);
  }, [media, media.observations]);

  useEffect(() => {
    if (answeringCallId && !answeringBinding) {
      answeringRef.current = null;
      // Provider observations are an external subscription snapshot.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnsweringCallId(null);
    }
  }, [answeringBinding, answeringCallId]);

  const answer = useCallback(
    async (callId: string) => {
      if (answeringRef.current || calls.active) return;
      if (!canAnswerCanonicalOffer(callId)) {
        throw new Error("The call is no longer available to answer");
      }
      answeringRef.current = callId;
      setAnsweringCallId(callId);
      try {
        await callActions.answer(callId);
      } catch (error) {
        answeringRef.current = null;
        setAnsweringCallId(null);
        throw error;
      }
    },
    [callActions, calls.active, canAnswerCanonicalOffer],
  );
  const callAvailability = useCallback(
    (callId: string) => bindingFor(callId)?.observation.availability ?? "PREPARING",
    [bindingFor],
  );
  const dial = useCallback(
    (_callId: string, input: DialMediaLeg) => {
      media.dial(input);
    },
    [media],
  );
  const takeover = useCallback(async () => {
    if (!clientInstanceId) return;
    const response = await fetch("/api/portal/call-center/agent-sessions", {
      body: JSON.stringify({ clientInstanceId, takeover: true }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("The phone could not move to this tab");
    }
    setIdentityError(null);
    ownerChannelRef.current?.postMessage({ clientInstanceId });
    await startSession();
  }, [clientInstanceId, startSession]);

  const value = useMemo<SoftphoneRuntimeValue>(
    () => ({
      activate: callActions.activate,
      answer,
      answeringCallId,
      callAvailability,
      clientInstanceId,
      dial,
      error:
        identityError ??
        agentSession.error ??
        (media.connection === "FAILED" ? "Phone disconnected — reconnecting" : null),
      hangup: callActions.hangup,
      mute: callActions.mute,
      ringtone,
      session,
      synchronizeCalls,
      takeover,
    }),
    [
      agentSession.error,
      answer,
      answeringCallId,
      callActions,
      callAvailability,
      clientInstanceId,
      dial,
      identityError,
      ringtone,
      session,
      synchronizeCalls,
      takeover,
    ],
  );

  return (
    <SoftphoneContext.Provider value={value}>
      {children}
      <audio ref={setRemoteAudioElement} autoPlay className="hidden" playsInline />
    </SoftphoneContext.Provider>
  );
}

export function useSoftphoneRuntime() {
  const runtime = useContext(SoftphoneContext);
  if (!runtime) {
    throw new Error("Softphone Runtime is not mounted");
  }
  return runtime;
}
