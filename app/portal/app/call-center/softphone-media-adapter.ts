export type MediaConnectionState = "CONNECTING" | "FAILED" | "OFFLINE" | "READY";

type MediaLegState =
  "ACTIVE" | "CONNECTING" | "ENDED" | "FAILED" | "HELD" | "RINGING" | "UNKNOWN";

export type MediaObservation = {
  canonicalCallId?: string | null;
  canonicalLegId?: string | null;
  connectionId: string;
  direction: "INBOUND" | "OUTBOUND" | "UNKNOWN";
  mediaLegId: string;
  providerCallControlId: string | null;
  providerCallLegId: string | null;
  providerCallSessionId: string | null;
  remoteAudioReady: boolean;
  state: MediaLegState;
};

type ProviderMediaUpdate = {
  clientState?: unknown;
  connectionId: string;
  direction?: unknown;
  mediaLegId: string;
  providerCallControlId?: unknown;
  providerCallLegId?: unknown;
  providerCallSessionId?: unknown;
  remoteAudioReady: boolean;
  state?: unknown;
};

function canonicalMediaIdentity(clientState: unknown) {
  if (typeof clientState !== "string" || !clientState.trim()) {
    return { canonicalCallId: null, canonicalLegId: null };
  }
  try {
    const decoded: unknown = JSON.parse(globalThis.atob(clientState));
    if (
      !decoded ||
      typeof decoded !== "object" ||
      !("canonicalCommand" in decoded) ||
      decoded.canonicalCommand !== true ||
      !("callId" in decoded) ||
      typeof decoded.callId !== "string" ||
      !("legId" in decoded) ||
      typeof decoded.legId !== "string"
    ) {
      return { canonicalCallId: null, canonicalLegId: null };
    }
    return {
      canonicalCallId: decoded.callId,
      canonicalLegId: decoded.legId,
    };
  } catch {
    return { canonicalCallId: null, canonicalLegId: null };
  }
}

function providerId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mediaDirection(value: unknown): MediaObservation["direction"] {
  const direction = typeof value === "string" ? value.toLowerCase() : "";

  if (direction === "inbound" || direction === "incoming") return "INBOUND";
  if (direction === "outbound" || direction === "outgoing") return "OUTBOUND";
  return "UNKNOWN";
}

function mediaState(value: unknown): MediaLegState {
  const state = typeof value === "string" ? value.toLowerCase() : "";

  if (["new", "requesting", "ringing", "trying"].includes(state)) return "RINGING";
  if (["answering", "early", "recovering"].includes(state)) return "CONNECTING";
  if (state === "active") return "ACTIVE";
  if (state === "held") return "HELD";
  if (["fail", "failed"].includes(state)) return "FAILED";
  if (["destroy", "hangup", "purge"].includes(state)) return "ENDED";
  return "UNKNOWN";
}

/**
 * Converts a provider update into the correlation-safe frontend media contract.
 * Caller numbers are intentionally absent: logical calls bind to provider/media
 * identifiers, never phone-number heuristics.
 */
export function normalizeMediaObservation(update: ProviderMediaUpdate): MediaObservation {
  const connectionId = providerId(update.connectionId);
  const mediaLegId = providerId(update.mediaLegId);

  if (!connectionId || !mediaLegId) {
    throw new Error("Media observations require connection and media leg IDs");
  }

  return {
    ...canonicalMediaIdentity(update.clientState),
    connectionId,
    direction: mediaDirection(update.direction),
    mediaLegId,
    providerCallControlId: providerId(update.providerCallControlId),
    providerCallLegId: providerId(update.providerCallLegId),
    providerCallSessionId: providerId(update.providerCallSessionId),
    remoteAudioReady: update.remoteAudioReady,
    state: mediaState(update.state),
  };
}

export function upsertMediaObservation(
  observations: readonly MediaObservation[],
  observation: MediaObservation,
) {
  const existing = observations.findIndex(
    ({ connectionId, mediaLegId }) =>
      connectionId === observation.connectionId && mediaLegId === observation.mediaLegId,
  );

  if (existing < 0) return [...observations, observation];

  return observations.map((current, index) =>
    index === existing ? observation : current,
  );
}
