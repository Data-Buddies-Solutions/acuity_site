export type PresenceStatus = "AVAILABLE" | "BUSY" | "PAUSED";

export type SoftphoneReadiness = {
  message: string;
  microphoneReady: boolean;
  providerReady: boolean;
  ready: boolean;
  soundReady: boolean;
  stationId: string | null;
  stationSelected: boolean;
};

export function resolveSoftphoneReadiness({
  microphoneReady,
  providerReady,
  soundReady,
  stationId,
  stationSelected,
}: Omit<SoftphoneReadiness, "message" | "ready">): SoftphoneReadiness {
  const message = !stationSelected
    ? "Choose a station to connect."
    : !providerReady
      ? "Connecting to phone service."
      : !microphoneReady
        ? "Enable microphone access to receive calls."
        : !soundReady
          ? "Enable browser sound to hear calls ring."
          : "Ready to receive calls.";

  return {
    message,
    microphoneReady,
    providerReady,
    ready: stationSelected && providerReady && microphoneReady && soundReady,
    soundReady,
    stationId,
    stationSelected,
  };
}

export function desiredPresenceStatus({
  busy,
  requestedStatus,
  softphoneReady,
}: {
  busy: boolean;
  requestedStatus: PresenceStatus;
  softphoneReady: boolean;
}): PresenceStatus | "OFFLINE" {
  if (!softphoneReady) {
    return "OFFLINE";
  }

  return busy ? "BUSY" : requestedStatus;
}

export function reportedPresenceStatus({
  acknowledgedStatus,
  desiredStatus,
}: {
  acknowledgedStatus: PresenceStatus | null;
  desiredStatus: PresenceStatus | "OFFLINE";
}): PresenceStatus | "OFFLINE" {
  return acknowledgedStatus === desiredStatus ? desiredStatus : "OFFLINE";
}

export function readinessForStation(
  readiness: SoftphoneReadiness,
  stationId: string | null,
  stationSelected: boolean,
) {
  if (readiness.stationId === stationId) {
    return readiness;
  }

  return resolveSoftphoneReadiness({
    microphoneReady: readiness.microphoneReady,
    providerReady: false,
    soundReady: readiness.soundReady,
    stationId,
    stationSelected,
  });
}

export function hasLocalProviderCallLeg({
  active,
  heldCount,
  incoming,
  queuedCount,
}: {
  active: boolean;
  heldCount: number;
  incoming: boolean;
  queuedCount: number;
}) {
  return active || incoming || heldCount > 0 || queuedCount > 0;
}
