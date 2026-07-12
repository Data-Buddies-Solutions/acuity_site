export const ROUTING_EXCLUSION_CODES = [
  "QUEUE_DISABLED",
  "MEMBERSHIP_DISABLED",
  "NO_SESSION",
  "ENDPOINT_DISABLED",
  "ENDPOINT_NOT_CONFIGURED",
  "LOCATION_MISMATCH",
  "LEASE_EXPIRED",
  "CONNECTION_NOT_READY",
  "PRESENCE_NOT_AVAILABLE",
  "MICROPHONE_NOT_READY",
  "AUDIO_NOT_READY",
  "CURRENT_CALL",
] as const;

export type RoutingExclusionCode = (typeof ROUTING_EXCLUSION_CODES)[number];

export type RoutingSessionCandidate = {
  audioReady: boolean;
  connectionState: "CONNECTING" | "READY" | "ERROR" | "CLOSED";
  currentCallId: string | null;
  endpoint: {
    configured: boolean;
    enabled: boolean;
    id: string;
    locationId: string | null;
  };
  id: string;
  leaseExpiresAt: Date;
  microphoneReady: boolean;
  presence: "AVAILABLE" | "PAUSED" | "BUSY" | "WRAP_UP" | "OFFLINE";
};

export type RoutingQueueSnapshot = {
  enabled: boolean;
  id: string;
  locationIds: string[];
  members: Array<{
    enabled: boolean;
    sessions: RoutingSessionCandidate[];
    userId: string;
  }>;
};

export type RoutingSelection = {
  agentSessionId: string;
  endpointId: string;
  userId: string;
};

export type RoutingDecision = {
  eligible: RoutingSelection[];
  exclusions: Record<RoutingExclusionCode, number>;
  queueId: string;
};

function emptyExclusions(): Record<RoutingExclusionCode, number> {
  return Object.fromEntries(ROUTING_EXCLUSION_CODES.map((code) => [code, 0])) as Record<
    RoutingExclusionCode,
    number
  >;
}

function compareIds(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function exclusionFor(
  session: RoutingSessionCandidate,
  queueLocationIds: ReadonlySet<string>,
  now: Date,
): RoutingExclusionCode | null {
  if (!session.endpoint.enabled) return "ENDPOINT_DISABLED";
  if (!session.endpoint.configured) return "ENDPOINT_NOT_CONFIGURED";
  if (
    queueLocationIds.size > 0 &&
    (!session.endpoint.locationId || !queueLocationIds.has(session.endpoint.locationId))
  ) {
    return "LOCATION_MISMATCH";
  }
  if (session.leaseExpiresAt <= now) return "LEASE_EXPIRED";
  if (session.connectionState !== "READY") return "CONNECTION_NOT_READY";
  if (session.presence !== "AVAILABLE") return "PRESENCE_NOT_AVAILABLE";
  if (!session.microphoneReady) return "MICROPHONE_NOT_READY";
  if (!session.audioReady) return "AUDIO_NOT_READY";
  if (session.currentCallId) return "CURRENT_CALL";
  return null;
}

/**
 * Computes one deterministic parallel-ring decision from a tenant-scoped
 * snapshot. It performs no I/O and has no provider or persistence dependency.
 */
export function decideInboundRouting(
  queue: RoutingQueueSnapshot,
  now: Date,
): RoutingDecision {
  const exclusions = emptyExclusions();
  if (!queue.enabled) {
    exclusions.QUEUE_DISABLED = 1;
    return { eligible: [], exclusions, queueId: queue.id };
  }

  const eligible: RoutingSelection[] = [];
  const queueLocationIds = new Set(queue.locationIds);

  for (const member of queue.members) {
    if (!member.enabled) {
      exclusions.MEMBERSHIP_DISABLED += 1;
      continue;
    }
    if (member.sessions.length === 0) {
      exclusions.NO_SESSION += 1;
      continue;
    }

    for (const session of member.sessions) {
      const exclusion = exclusionFor(session, queueLocationIds, now);
      if (exclusion) {
        exclusions[exclusion] += 1;
        continue;
      }
      eligible.push({
        agentSessionId: session.id,
        endpointId: session.endpoint.id,
        userId: member.userId,
      });
    }
  }

  eligible.sort(
    (left, right) =>
      compareIds(left.endpointId, right.endpointId) ||
      compareIds(left.agentSessionId, right.agentSessionId),
  );
  return { eligible, exclusions, queueId: queue.id };
}
