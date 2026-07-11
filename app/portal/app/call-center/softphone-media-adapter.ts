export type MediaConnectionState = "CONNECTING" | "FAILED" | "OFFLINE" | "READY";

export type MediaLegState =
  "ACTIVE" | "CONNECTING" | "ENDED" | "FAILED" | "HELD" | "RINGING" | "UNKNOWN";

export type MediaObservation = {
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
  connectionId: string;
  direction?: unknown;
  mediaLegId: string;
  providerCallControlId?: unknown;
  providerCallLegId?: unknown;
  providerCallSessionId?: unknown;
  remoteAudioReady: boolean;
  state?: unknown;
};

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
