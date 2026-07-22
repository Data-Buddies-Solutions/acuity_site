"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  resolveAgentAvailabilityIntent,
  type AgentAvailabilityIntent,
} from "@/lib/call-center/domain/agent-session-readiness";

import {
  claimCallCenterClientInstance,
  type CallCenterClientInstance,
} from "./call-center/call-center-client-instance";
import type { MediaObservation } from "./call-center/softphone-media-adapter";
import {
  SoftphoneRuntimeProvider,
  type SoftphoneRuntimeValue,
} from "./call-center/softphone-runtime-context";
import {
  type CanonicalAgentConnectionState,
  useCanonicalAgentSession,
} from "./call-center/use-canonical-agent-session";
import { useIncomingCallRingtone } from "./call-center/use-incoming-call-ringtone";
import { useSoftphoneMedia } from "./call-center/use-softphone";

const PHONE_OWNER_CHANNEL = "acuity-call-center-phone-owner";
const PHONE_ACTIVE_ELSEWHERE = "Phone active in another tab";
const AVAILABILITY_INTENT_STORAGE_PREFIX = "acuity.call-center.availability-intent";
const OUTBOUND_MEDIA_OBSERVATION_TIMEOUT_MS = 75_000;

function readConfirmedAvailabilityIntent(
  storage: Storage,
  clientInstanceId: string,
  sessionId: string,
): AgentAvailabilityIntent | null {
  const key = `${AVAILABILITY_INTENT_STORAGE_PREFIX}.${clientInstanceId}`;
  try {
    const stored = JSON.parse(storage.getItem(key) ?? "null") as {
      intent?: unknown;
      sessionId?: unknown;
    } | null;
    if (
      stored?.sessionId === sessionId &&
      (stored.intent === "AVAILABLE" || stored.intent === "PAUSED")
    ) {
      return stored.intent;
    }
    if (stored) storage.removeItem(key);
  } catch {
    // Unavailable browser storage cannot supersede canonical Agent Session state.
  }
  return null;
}

function writeConfirmedAvailabilityIntent(
  storage: Storage,
  clientInstanceId: string,
  sessionId: string,
  intent: AgentAvailabilityIntent,
) {
  try {
    storage.setItem(
      `${AVAILABILITY_INTENT_STORAGE_PREFIX}.${clientInstanceId}`,
      JSON.stringify({ intent, sessionId }),
    );
  } catch {
    // Canonical Agent Session state remains authoritative if storage is unavailable.
  }
}

export function scheduleOutboundOperationExpiry(
  expire: () => void,
  delayMs = OUTBOUND_MEDIA_OBSERVATION_TIMEOUT_MS,
) {
  const timeout = setTimeout(expire, delayMs);
  return () => clearTimeout(timeout);
}

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
  ringtone: {
    enabled?: boolean;
    outboundOperationActive?: boolean;
    suppressedOfferIds?: readonly string[];
  } = {},
) {
  const {
    enabled: ringtoneEnabled = true,
    outboundOperationActive = false,
    suppressedOfferIds = [],
  } = ringtone;
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
    ringtoneOfferId:
      !ringtoneEnabled || active || answering || outboundOperationActive
        ? null
        : (incoming.find(({ mediaLegId }) => !suppressedOfferIds.includes(mediaLegId))
            ?.mediaLegId ?? null),
  };
}

function isIncomingRingtoneObservation({ direction, state }: MediaObservation) {
  return direction === "INBOUND" && ["CONNECTING", "RINGING"].includes(state);
}

export function updateSuppressedRingtoneOffers(
  current: readonly string[],
  observation: MediaObservation,
  outboundOperationActive: boolean,
) {
  if (["ENDED", "FAILED"].includes(observation.state)) {
    return current.filter((mediaLegId) => mediaLegId !== observation.mediaLegId);
  }
  if (
    !outboundOperationActive ||
    !isIncomingRingtoneObservation(observation) ||
    current.includes(observation.mediaLegId)
  ) {
    return current;
  }
  return [...current, observation.mediaLegId];
}

export function releaseProvisionalSuppressedRingtoneOffers(
  current: readonly string[],
  baseline: readonly string[] | null,
) {
  if (!baseline) return current;
  return current.filter((mediaLegId) => baseline.includes(mediaLegId));
}

type OutboundMediaOperation = {
  active: boolean;
  canonicalCallId: string | null;
  canonicalLegId: string | null;
  mediaLegId: string | null;
};

export function updateOutboundOperationFromMedia(
  current: OutboundMediaOperation,
  observation: MediaObservation,
): OutboundMediaOperation {
  if (!current.active) {
    return {
      active: false,
      canonicalCallId: null,
      canonicalLegId: null,
      mediaLegId: null,
    };
  }

  const matchesCanonicalLeg =
    current.canonicalCallId &&
    current.canonicalLegId &&
    observation.canonicalCallId === current.canonicalCallId &&
    observation.canonicalLegId === current.canonicalLegId;
  if (!matchesCanonicalLeg) return current;

  const terminal = ["ENDED", "FAILED"].includes(observation.state);
  if (terminal) {
    return {
      active: false,
      canonicalCallId: null,
      canonicalLegId: null,
      mediaLegId: null,
    };
  }

  if (["ACTIVE", "CONNECTING", "HELD", "RINGING"].includes(observation.state)) {
    return { ...current, mediaLegId: observation.mediaLegId };
  }

  return current;
}

export function SoftphoneRuntime({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<CallCenterClientInstance | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [availabilityIntent, setAvailabilityIntent] =
    useState<AgentAvailabilityIntent>("PAUSED");
  const [outboundOperationActive, setOutboundOperationActive] = useState(false);
  const [suppressedOfferIds, setSuppressedOfferIds] = useState<readonly string[]>([]);
  const [mediaReadiness, setMediaReadiness] = useState({
    audioReady: false,
    connectionState: "CLOSED" as CanonicalAgentConnectionState,
    microphoneReady: false,
  });
  const availabilityChoiceRef = useRef<AgentAvailabilityIntent | null>(null);
  const availabilityLeaseGenerationRef = useRef<number | null>(null);
  const availabilitySessionIdRef = useRef<string | null>(null);
  const mediaObservationsRef = useRef<readonly MediaObservation[]>([]);
  const ownerChannelRef = useRef<BroadcastChannel | null>(null);
  const outboundCanonicalCallIdRef = useRef<string | null>(null);
  const outboundCanonicalLegIdRef = useRef<string | null>(null);
  const outboundOperationExpiryRef = useRef<(() => void) | null>(null);
  const outboundMediaLegIdRef = useRef<string | null>(null);
  const outboundOperationRef = useRef(false);
  const outboundSuppressionBaselineRef = useRef<readonly string[] | null>(null);
  const suppressedOfferIdsRef = useRef<readonly string[]>([]);
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
    presence: clientInstanceId ? availabilityIntent : "OFFLINE",
  });
  const session = agentSession.session;
  const startSession = agentSession.start;
  const stopSession = agentSession.stop;
  const clearOutboundOperationExpiry = useCallback(() => {
    outboundOperationExpiryRef.current?.();
    outboundOperationExpiryRef.current = null;
  }, []);
  const schedulePersistentOutboundExpiry = useCallback(() => {
    clearOutboundOperationExpiry();
    outboundOperationExpiryRef.current = scheduleOutboundOperationExpiry(() => {
      outboundOperationExpiryRef.current = null;
      outboundCanonicalCallIdRef.current = null;
      outboundCanonicalLegIdRef.current = null;
      outboundMediaLegIdRef.current = null;
      outboundOperationRef.current = false;
      setOutboundOperationActive(false);
    });
  }, [clearOutboundOperationExpiry]);
  const observeMedia = useCallback(
    (observation: MediaObservation) => {
      const currentOutboundOperation = {
        active: outboundOperationRef.current,
        canonicalCallId: outboundCanonicalCallIdRef.current,
        canonicalLegId: outboundCanonicalLegIdRef.current,
        mediaLegId: outboundMediaLegIdRef.current,
      };
      const nextOutboundOperation = updateOutboundOperationFromMedia(
        currentOutboundOperation,
        observation,
      );
      outboundCanonicalCallIdRef.current = nextOutboundOperation.canonicalCallId;
      outboundCanonicalLegIdRef.current = nextOutboundOperation.canonicalLegId;
      outboundMediaLegIdRef.current = nextOutboundOperation.mediaLegId;
      if (!nextOutboundOperation.active) {
        clearOutboundOperationExpiry();
      }
      if (nextOutboundOperation.active !== currentOutboundOperation.active) {
        outboundOperationRef.current = nextOutboundOperation.active;
        setOutboundOperationActive(nextOutboundOperation.active);
      }

      const nextSuppressedOfferIds = updateSuppressedRingtoneOffers(
        suppressedOfferIdsRef.current,
        observation,
        outboundOperationRef.current,
      );
      suppressedOfferIdsRef.current = nextSuppressedOfferIds;
      setSuppressedOfferIds(nextSuppressedOfferIds);
    },
    [clearOutboundOperationExpiry],
  );
  const { setRemoteAudioElement, ...media } = useSoftphoneMedia({
    agentSessionId: session?.id ?? null,
    autoPrepare: Boolean(session),
    browserSessionId: clientInstanceId ?? "",
    enabled: Boolean(session),
    onObservation: observeMedia,
  });

  useEffect(() => {
    mediaObservationsRef.current = media.observations;
  }, [media.observations]);

  useEffect(() => clearOutboundOperationExpiry, [clearOutboundOperationExpiry]);

  useEffect(() => {
    if (!session) {
      if (!clientInstanceId) {
        availabilityChoiceRef.current = null;
        availabilityLeaseGenerationRef.current = null;
        availabilitySessionIdRef.current = null;
        // A new browser identity starts with an explicit unavailable choice.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAvailabilityIntent("PAUSED");
      }
      return;
    }
    const newLease =
      agentSession.leaseGeneration !== null &&
      availabilityLeaseGenerationRef.current !== agentSession.leaseGeneration;
    const sameLease = !newLease && availabilitySessionIdRef.current === session.id;
    const confirmedChoice = sameLease
      ? availabilityChoiceRef.current
      : clientInstanceId && agentSession.leaseContinuity === "REPLAYED"
        ? readConfirmedAvailabilityIntent(
            window.sessionStorage,
            clientInstanceId,
            session.id,
          )
        : null;
    const next =
      newLease && agentSession.leaseContinuity !== "REPLAYED"
        ? "PAUSED"
        : session.presence === "BUSY" && confirmedChoice
          ? confirmedChoice
          : resolveAgentAvailabilityIntent(session.presence);
    if (!sameLease && clientInstanceId && agentSession.leaseContinuity !== "REPLAYED") {
      try {
        window.sessionStorage.removeItem(
          `${AVAILABILITY_INTENT_STORAGE_PREFIX}.${clientInstanceId}`,
        );
      } catch {
        // Canonical Agent Session state remains authoritative without storage.
      }
    }
    availabilityLeaseGenerationRef.current = agentSession.leaseGeneration;
    availabilitySessionIdRef.current = session.id;
    if (
      confirmedChoice === "AVAILABLE" &&
      session.presence === "PAUSED" &&
      (session.connectionState !== "READY" ||
        !session.microphoneReady ||
        !session.audioReady)
    ) {
      availabilityChoiceRef.current = confirmedChoice;
      if (clientInstanceId) {
        writeConfirmedAvailabilityIntent(
          window.sessionStorage,
          clientInstanceId,
          session.id,
          confirmedChoice,
        );
      }
      setAvailabilityIntent((current) =>
        current === confirmedChoice ? current : confirmedChoice,
      );
      return;
    }
    availabilityChoiceRef.current = next;
    if (
      clientInstanceId &&
      (session.presence === "AVAILABLE" ||
        session.presence === "BUSY" ||
        (session.presence === "PAUSED" &&
          session.connectionState === "READY" &&
          session.microphoneReady &&
          session.audioReady))
    ) {
      writeConfirmedAvailabilityIntent(
        window.sessionStorage,
        clientInstanceId,
        session.id,
        next,
      );
    }
    // Every canonical projection can supersede an older local availability choice.
    setAvailabilityIntent((current) => (current === next ? current : next));
  }, [
    agentSession.leaseContinuity,
    agentSession.leaseGeneration,
    clientInstanceId,
    session,
  ]);

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

  const calls = selectSoftphoneRuntimeCalls(
    media.observations,
    media.answeringMediaLegId,
    {
      enabled: session?.presence === "AVAILABLE",
      outboundOperationActive,
      suppressedOfferIds,
    },
  );
  const ringtone = useIncomingCallRingtone(calls.ringtoneOfferId);

  useEffect(() => {
    const active = media.observations.find(({ state }) =>
      ["ACTIVE", "HELD"].includes(state),
    );
    if (active) media.activate(active.mediaLegId);
  }, [media, media.observations]);

  const answer = useCallback(
    async (mediaLegId: string, expiresAt?: string) => {
      if (media.answeringMediaLegId || calls.active) return;
      await media.answer(mediaLegId, expiresAt);
    },
    [calls.active, media],
  );
  const setOutboundOperation = useCallback(
    (
      active: boolean,
      identity?: { callId: string; legId: string },
      options?: { releaseProvisionalSuppression?: boolean },
    ) => {
      const wasActive = outboundOperationRef.current;
      outboundOperationRef.current = active;
      if (!active) {
        clearOutboundOperationExpiry();
        outboundCanonicalCallIdRef.current = null;
        outboundCanonicalLegIdRef.current = null;
        outboundMediaLegIdRef.current = null;
        if (options?.releaseProvisionalSuppression) {
          const nextSuppressedOfferIds = releaseProvisionalSuppressedRingtoneOffers(
            suppressedOfferIdsRef.current,
            outboundSuppressionBaselineRef.current,
          );
          suppressedOfferIdsRef.current = nextSuppressedOfferIds;
          setSuppressedOfferIds(nextSuppressedOfferIds);
        }
        outboundSuppressionBaselineRef.current = null;
      } else if (identity) {
        outboundCanonicalCallIdRef.current = identity.callId;
        outboundCanonicalLegIdRef.current = identity.legId;
        outboundMediaLegIdRef.current = null;
        outboundSuppressionBaselineRef.current = null;
        schedulePersistentOutboundExpiry();
      } else if (!wasActive) {
        outboundSuppressionBaselineRef.current = suppressedOfferIdsRef.current;
        schedulePersistentOutboundExpiry();
      }
      if (active) {
        const nextSuppressedOfferIds = mediaObservationsRef.current.reduce(
          (next, observation) => updateSuppressedRingtoneOffers(next, observation, true),
          suppressedOfferIdsRef.current,
        );
        suppressedOfferIdsRef.current = nextSuppressedOfferIds;
        setSuppressedOfferIds(nextSuppressedOfferIds);
      }
      setOutboundOperationActive(active);
    },
    [clearOutboundOperationExpiry, schedulePersistentOutboundExpiry],
  );
  const setAvailability = useCallback(
    async (presence: AgentAvailabilityIntent) => {
      const confirmed = await agentSession.setAvailability(presence);
      availabilityChoiceRef.current = presence;
      availabilitySessionIdRef.current = confirmed?.id ?? null;
      if (clientInstanceId && confirmed) {
        writeConfirmedAvailabilityIntent(
          window.sessionStorage,
          clientInstanceId,
          confirmed.id,
          presence,
        );
      }
      setAvailabilityIntent(presence);
    },
    [agentSession, clientInstanceId],
  );
  const retryAvailability = useCallback(async () => {
    const confirmed = await agentSession.retryAvailability();
    if (!confirmed) return;
    const presence = resolveAgentAvailabilityIntent(confirmed.presence);
    availabilityChoiceRef.current = presence;
    availabilitySessionIdRef.current = confirmed.id;
    if (clientInstanceId) {
      writeConfirmedAvailabilityIntent(
        window.sessionStorage,
        clientInstanceId,
        confirmed.id,
        presence,
      );
    }
    setAvailabilityIntent(presence);
  }, [agentSession, clientInstanceId]);
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
      answeringMediaLegId: calls.answeringMediaLegId,
      availabilityError: agentSession.availabilityError,
      availabilityIntent,
      availabilityPending: agentSession.availabilityPending,
      availabilityRetryable: agentSession.availabilityRetryable,
      clientInstanceId,
      error:
        identityError ??
        agentSession.error ??
        media.microphoneError ??
        (media.connection === "FAILED" ? "Phone disconnected — reconnecting" : null),
      media,
      retryAvailability,
      ringtone,
      session,
      setAvailability,
      setOutboundOperationActive: setOutboundOperation,
      takeover,
    }),
    [
      agentSession.error,
      agentSession.availabilityError,
      agentSession.availabilityPending,
      agentSession.availabilityRetryable,
      answer,
      availabilityIntent,
      clientInstanceId,
      identityError,
      media,
      retryAvailability,
      ringtone,
      session,
      setAvailability,
      setOutboundOperation,
      takeover,
      calls.answeringMediaLegId,
    ],
  );

  return (
    <SoftphoneRuntimeProvider value={value}>
      {children}
      <audio ref={setRemoteAudioElement} autoPlay className="hidden" playsInline />
    </SoftphoneRuntimeProvider>
  );
}
