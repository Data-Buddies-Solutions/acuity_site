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

import type { AgentSessionView } from "@/lib/call-center/realtime-contract";

import {
  claimCallCenterClientInstance,
  type CallCenterClientInstance,
} from "./call-center/call-center-client-instance";
import type { MediaObservation } from "./call-center/softphone-media-adapter";
import {
  type CanonicalAgentConnectionState,
  useCanonicalAgentSession,
} from "./call-center/use-canonical-agent-session";
import { useIncomingCallRingtone } from "./call-center/use-incoming-call-ringtone";
import { useSoftphoneMedia } from "./call-center/use-softphone";

const PHONE_OWNER_CHANNEL = "acuity-call-center-phone-owner";
const PHONE_ACTIVE_ELSEWHERE = "Phone active in another tab";

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
  return {
    active,
    incoming,
    ringtoneOfferId:
      active || answeringMediaLegId ? null : (incoming[0]?.mediaLegId ?? null),
  };
}

type SoftphoneRuntimeValue = {
  clientInstanceId: string | null;
  error: string | null;
  media: Omit<ReturnType<typeof useSoftphoneMedia>, "setRemoteAudioElement">;
  ringtone: ReturnType<typeof useIncomingCallRingtone>;
  session: AgentSessionView | null;
  answer(mediaLegId: string): Promise<void>;
  answeringMediaLegId: string | null;
  takeover(): Promise<void>;
};

const SoftphoneContext = createContext<SoftphoneRuntimeValue | null>(null);

export function SoftphoneRuntime({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<CallCenterClientInstance | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [answeringMediaLegId, setAnsweringMediaLegId] = useState<string | null>(null);
  const [mediaReadiness, setMediaReadiness] = useState({
    audioReady: false,
    connectionState: "CLOSED" as CanonicalAgentConnectionState,
    microphoneReady: false,
  });
  const answeringRef = useRef<string | null>(null);
  const ownerChannelRef = useRef<BroadcastChannel | null>(null);
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
  const startSession = agentSession.start;
  const stopSession = agentSession.stop;
  const { setRemoteAudioElement, ...media } = useSoftphoneMedia({
    agentSessionId: session?.id ?? null,
    autoPrepare: Boolean(session),
    browserSessionId: clientInstanceId ?? "",
    enabled: Boolean(session),
  });

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

  const visibleAnsweringMediaLegId =
    answeringMediaLegId &&
    media.observations.some(
      ({ mediaLegId, state }) =>
        mediaLegId === answeringMediaLegId && ["CONNECTING", "RINGING"].includes(state),
    )
      ? answeringMediaLegId
      : null;
  const calls = selectSoftphoneRuntimeCalls(
    media.observations,
    visibleAnsweringMediaLegId,
  );
  const ringtone = useIncomingCallRingtone(calls.ringtoneOfferId);

  useEffect(() => {
    const active = media.observations.find(({ state }) =>
      ["ACTIVE", "HELD"].includes(state),
    );
    if (active) media.activate(active.mediaLegId);
  }, [media, media.observations]);

  useEffect(() => {
    if (answeringMediaLegId && !visibleAnsweringMediaLegId) {
      answeringRef.current = null;
    }
  }, [answeringMediaLegId, visibleAnsweringMediaLegId]);

  const answer = useCallback(
    async (mediaLegId: string) => {
      if (answeringRef.current || calls.active) return;
      answeringRef.current = mediaLegId;
      setAnsweringMediaLegId(mediaLegId);
      try {
        await media.answer(mediaLegId);
      } catch (error) {
        answeringRef.current = null;
        setAnsweringMediaLegId(null);
        throw error;
      }
    },
    [calls.active, media],
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
      answer,
      answeringMediaLegId: visibleAnsweringMediaLegId,
      clientInstanceId,
      error:
        identityError ??
        agentSession.error ??
        (media.connection === "FAILED" ? "Phone disconnected — reconnecting" : null),
      media,
      ringtone,
      session,
      takeover,
    }),
    [
      agentSession.error,
      answer,
      clientInstanceId,
      identityError,
      media,
      ringtone,
      session,
      takeover,
      visibleAnsweringMediaLegId,
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
