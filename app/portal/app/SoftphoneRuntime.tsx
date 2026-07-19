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
  takingMediaLegId: string | null,
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
      active || takingMediaLegId ? null : (incoming[0]?.mediaLegId ?? null),
  };
}

type SoftphoneRuntimeValue = {
  clientInstanceId: string | null;
  error: string | null;
  media: Omit<ReturnType<typeof useSoftphoneMedia>, "setRemoteAudioElement">;
  ringtone: ReturnType<typeof useIncomingCallRingtone>;
  session: AgentSessionView | null;
  take(mediaLegId: string): Promise<void>;
  takeover(): Promise<void>;
  takingMediaLegId: string | null;
};

const SoftphoneContext = createContext<SoftphoneRuntimeValue | null>(null);

export function SoftphoneRuntime({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<CallCenterClientInstance | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [takingMediaLegId, setTakingMediaLegId] = useState<string | null>(null);
  const [mediaReadiness, setMediaReadiness] = useState({
    audioReady: false,
    connectionState: "CLOSED" as CanonicalAgentConnectionState,
    microphoneReady: false,
  });
  const answeredRef = useRef(new Set<string>());
  const ownerChannelRef = useRef<BroadcastChannel | null>(null);
  const takingRef = useRef<string | null>(null);
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
      if (
        data &&
        typeof data === "object" &&
        "clientInstanceId" in data &&
        data.clientInstanceId !== clientInstanceId
      ) {
        void stopSession();
      }
    };
    return () => {
      ownerChannelRef.current = null;
      channel.close();
    };
  }, [clientInstanceId, stopSession]);

  const visibleTakingMediaLegId =
    takingMediaLegId &&
    media.observations.some(
      ({ mediaLegId, state }) =>
        mediaLegId === takingMediaLegId && ["CONNECTING", "RINGING"].includes(state),
    )
      ? takingMediaLegId
      : null;
  const calls = selectSoftphoneRuntimeCalls(media.observations, visibleTakingMediaLegId);
  const ringtone = useIncomingCallRingtone(calls.ringtoneOfferId);

  useEffect(() => {
    const active = media.observations.find(({ state }) =>
      ["ACTIVE", "HELD"].includes(state),
    );
    if (active) media.activate(active.mediaLegId);
  }, [media, media.observations]);

  useEffect(() => {
    for (const item of media.observations) {
      if (["ENDED", "FAILED"].includes(item.state)) {
        answeredRef.current.delete(item.mediaLegId);
      }
    }
    if (takingMediaLegId && !visibleTakingMediaLegId) {
      takingRef.current = null;
    }
  }, [media.observations, takingMediaLegId, visibleTakingMediaLegId]);

  const take = useCallback(
    async (mediaLegId: string) => {
      if (takingRef.current || calls.active || answeredRef.current.has(mediaLegId)) {
        return;
      }
      takingRef.current = mediaLegId;
      setTakingMediaLegId(mediaLegId);
      answeredRef.current.add(mediaLegId);
      try {
        await Promise.resolve(media.answer(mediaLegId));
        media.activate(mediaLegId);
      } catch (error) {
        answeredRef.current.delete(mediaLegId);
        takingRef.current = null;
        setTakingMediaLegId(null);
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
    ownerChannelRef.current?.postMessage({ clientInstanceId });
    await startSession();
  }, [clientInstanceId, startSession]);

  const value = useMemo<SoftphoneRuntimeValue>(
    () => ({
      clientInstanceId,
      error:
        identityError ??
        agentSession.error ??
        (media.connection === "FAILED" ? "Phone disconnected — reconnecting" : null),
      media,
      ringtone,
      session,
      take,
      takeover,
      takingMediaLegId: visibleTakingMediaLegId,
    }),
    [
      agentSession.error,
      clientInstanceId,
      identityError,
      media,
      ringtone,
      session,
      take,
      takeover,
      visibleTakingMediaLegId,
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
