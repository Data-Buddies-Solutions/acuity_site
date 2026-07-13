import { parseRevision } from "@/lib/call-center/realtime";
import type {
  AgentSessionView,
  CallView,
  OperationView,
} from "@/lib/call-center/realtime-contract";

import type { MediaObservation } from "./softphone-media-adapter";

const OUTBOUND_OPERATION_STORAGE_KEY = "acuity-call-center:outbound-operation";

type OutboundOperationStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function outboundTargetFingerprint(target: {
  clientInstanceId: string;
  destination: string;
  numberId: string;
  queueId: string;
}) {
  return JSON.stringify({ ...target, destination: target.destination.trim() });
}

export function canonicalOutboundIdempotencyKey(
  storage: OutboundOperationStorage,
  target: Parameters<typeof outboundTargetFingerprint>[0],
  createId: () => string,
) {
  const fingerprint = outboundTargetFingerprint(target);
  try {
    const stored = JSON.parse(storage.getItem(OUTBOUND_OPERATION_STORAGE_KEY) ?? "null");
    if (
      stored &&
      typeof stored === "object" &&
      stored.fingerprint === fingerprint &&
      typeof stored.key === "string" &&
      stored.key
    ) {
      return stored.key;
    }
  } catch {
    // Replace malformed tab-local state below.
  }
  const key = `canonical-outbound:${target.clientInstanceId}:${createId()}`;
  storage.setItem(OUTBOUND_OPERATION_STORAGE_KEY, JSON.stringify({ fingerprint, key }));
  return key;
}

export function completeCanonicalOutboundOperation(
  storage: OutboundOperationStorage,
  target: Parameters<typeof outboundTargetFingerprint>[0],
  key: string,
) {
  try {
    const stored = JSON.parse(storage.getItem(OUTBOUND_OPERATION_STORAGE_KEY) ?? "null");
    if (
      stored?.fingerprint === outboundTargetFingerprint(target) &&
      stored?.key === key
    ) {
      storage.removeItem(OUTBOUND_OPERATION_STORAGE_KEY);
    }
  } catch {
    storage.removeItem(OUTBOUND_OPERATION_STORAGE_KEY);
  }
}

export function canonicalClaimIdempotencyKey(callId: string, agentSessionId: string) {
  return `canonical-claim:${callId}:${agentSessionId}`;
}

export function canonicalTransferIdempotencyKey(
  callId: string,
  sourceLegId: string,
  targetUserId: string,
) {
  return `canonical-transfer:${callId}:${sourceLegId}:${targetUserId}`;
}

export function beginCanonicalTake(inFlight: Set<string>, callId: string) {
  if (inFlight.has(callId)) return false;
  inFlight.add(callId);
  return true;
}

export function beginCanonicalTransfer(
  inFlight: Set<string>,
  callId: string,
  sourceLegId: string,
) {
  const key = `${callId}:${sourceLegId}`;
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

function sameProviderLeg(leg: CallView["legs"][number], observation: MediaObservation) {
  const controlMatch =
    leg.providerCallControlId &&
    observation.providerCallControlId === leg.providerCallControlId;
  const legMatch =
    leg.providerCallLegId && observation.providerCallLegId === leg.providerCallLegId;
  return Boolean(controlMatch || legMatch);
}

export function selectCanonicalBrowserMediaLeg(
  call: CallView,
  agentSessionId: string,
  endpointId: string,
  observations: readonly MediaObservation[],
) {
  const candidates = call.legs.flatMap((leg) => {
    if (
      leg.kind !== "AGENT" ||
      leg.agentSessionId !== agentSessionId ||
      leg.endpointId !== endpointId ||
      ["ENDED", "FAILED"].includes(leg.status)
    ) {
      return [];
    }
    return observations
      .filter((observation) => sameProviderLeg(leg, observation))
      .map((observation) => ({ leg, observation }));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export function selectLatestClaimOperation(
  operations: readonly OperationView[] | null,
  target: {
    agentSessionId: string;
    callId: string;
    endpointId: string;
    legId: string;
  },
) {
  return (
    operations
      ?.filter(
        (operation) =>
          operation.callId === target.callId &&
          operation.type === "CLAIM" &&
          operation.targetAgentSessionId === target.agentSessionId &&
          operation.targetEndpointId === target.endpointId &&
          operation.targetLegId === target.legId,
      )
      .sort((left, right) => {
        const leftRevision = parseRevision(left.operationEventRevision) ?? BigInt(0);
        const rightRevision = parseRevision(right.operationEventRevision) ?? BigInt(0);
        return leftRevision > rightRevision ? -1 : leftRevision < rightRevision ? 1 : 0;
      })[0] ?? null
  );
}

export function selectLatestTransferOperation(
  operations: readonly OperationView[] | null,
  target: {
    callId: string;
    sourceLegId: string;
    targetUserId?: string;
  },
) {
  return (
    operations
      ?.filter(
        (operation) =>
          operation.callId === target.callId &&
          operation.type === "TRANSFER" &&
          operation.sourceLegId === target.sourceLegId &&
          (!target.targetUserId || operation.targetUserId === target.targetUserId),
      )
      .sort((left, right) => {
        const leftRevision = parseRevision(left.operationEventRevision) ?? BigInt(0);
        const rightRevision = parseRevision(right.operationEventRevision) ?? BigInt(0);
        return leftRevision > rightRevision ? -1 : leftRevision < rightRevision ? 1 : 0;
      })[0] ?? null
  );
}

export function selectCanonicalTransferSource(
  call: CallView,
  session: Pick<AgentSessionView, "endpointId" | "id">,
) {
  if (!call.winningLegId || call.status !== "CONNECTED") return null;
  const leg = call.legs.find(({ id }) => id === call.winningLegId);
  return leg?.kind === "AGENT" &&
    leg.status === "BRIDGED" &&
    leg.agentSessionId === session.id &&
    leg.endpointId === session.endpointId
    ? leg
    : null;
}

export function selectCanonicalTransferTakeCandidate(
  calls: readonly CallView[],
  operations: readonly OperationView[] | null,
  session: Pick<AgentSessionView, "endpointId" | "id">,
  observations: readonly MediaObservation[],
) {
  const latestByLeg = new Map<string, OperationView>();
  for (const operation of operations ?? []) {
    if (
      operation.type !== "TRANSFER" ||
      operation.targetAgentSessionId !== session.id ||
      operation.targetEndpointId !== session.endpointId ||
      !operation.targetLegId
    ) {
      continue;
    }
    const current = latestByLeg.get(operation.targetLegId);
    const currentRevision = current
      ? (parseRevision(current.operationEventRevision) ?? BigInt(0))
      : BigInt(-1);
    const candidateRevision =
      parseRevision(operation.operationEventRevision) ?? BigInt(0);
    if (candidateRevision > currentRevision) {
      latestByLeg.set(operation.targetLegId, operation);
    }
  }
  const candidates = [...latestByLeg.values()].flatMap((operation) => {
    if (operation.status === "FAILED" || !operation.sourceLegId) return [];
    const call = calls.find(({ id }) => id === operation.callId);
    if (!call || call.winningLegId !== operation.sourceLegId) return [];
    const match = selectCanonicalBrowserMediaLeg(
      call,
      session.id,
      session.endpointId,
      observations,
    );
    if (!match || match.leg.id !== operation.targetLegId) return [];
    return [{ call, ...match, operation }];
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export function operationShouldAnswerMedia(operation: OperationView | null) {
  return Boolean(operation && operation.status !== "FAILED");
}
