import { parseRevision } from "@/lib/call-center/realtime";
import { CallCenterRequestError } from "@/lib/call-center/operator-error";
import type {
  AgentSessionView,
  CallView,
  OperationView,
} from "@/lib/call-center/realtime-contract";

import type { MediaObservation } from "./softphone-media-adapter";

const OUTBOUND_OPERATION_STORAGE_KEY = "acuity-call-center:outbound-operation";

export const OUTBOUND_SESSION_RECOVERY_FAILURE_MESSAGE =
  "Calling is temporarily unavailable. We couldn’t restore your session automatically. Refresh the page.";

type OutboundOperationStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function isCallNotReady(error: unknown) {
  return (
    error instanceof CallCenterRequestError &&
    error.operatorError.code === "CALL_NOT_READY"
  );
}

function isActionableReadinessError(error: unknown) {
  return (
    error instanceof CallCenterRequestError &&
    !["CALL_NOT_READY", "SESSION_EXPIRED", "SESSION_STALE"].includes(
      error.operatorError.code,
    )
  );
}

export async function runOutboundWithExpiredLeaseRefresh<T>({
  leaseExpiresAt,
  onRecovering,
  operation,
  refresh,
}: {
  leaseExpiresAt: string;
  onRecovering: () => void;
  operation: () => Promise<T>;
  refresh: () => Promise<unknown>;
}) {
  try {
    return await operation();
  } catch (error) {
    if (!isCallNotReady(error) || new Date(leaseExpiresAt).getTime() > Date.now()) {
      throw error;
    }
  }

  onRecovering();
  try {
    await refresh();
    return await operation();
  } catch (error) {
    if (isActionableReadinessError(error)) throw error;
    throw new Error(OUTBOUND_SESSION_RECOVERY_FAILURE_MESSAGE);
  }
}

export function selectCanonicalAgentActiveCall(
  calls: readonly CallView[],
  session: Pick<
    AgentSessionView,
    "currentCallId" | "endpointId" | "id" | "offeredCallId"
  > | null,
) {
  const callId = session?.currentCallId ?? session?.offeredCallId;
  const call = callId ? (calls.find(({ id }) => id === callId) ?? null) : null;
  if (call?.direction === "OUTBOUND") return call;
  if (!session?.currentCallId || call?.id !== session.currentCallId) return null;
  if (call.status !== "CONNECTED" || !call.answeredAt || !call.winningLegId) {
    return null;
  }
  const winningLeg = call.legs.find(({ id }) => id === call.winningLegId);
  return winningLeg?.kind === "AGENT" &&
    winningLeg.status === "BRIDGED" &&
    winningLeg.agentSessionId === session.id &&
    winningLeg.endpointId === session.endpointId
    ? call
    : null;
}

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

export async function isCanonicalClaimConflict(response: Response) {
  if (response.status !== 409) return false;
  try {
    const body: unknown = await response.json();
    return (
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      body.code === "CALL_ALREADY_CLAIMED"
    );
  } catch {
    return false;
  }
}

export function canonicalTransferIdempotencyKey(
  callId: string,
  sourceLegId: string,
  targetUserId: string,
  attempt = 1,
) {
  const base = `canonical-transfer:${callId}:${sourceLegId}:${targetUserId}`;
  return attempt === 1 ? base : `${base}:${attempt}`;
}

export function canonicalTransferAttemptNumber(
  call: Pick<CallView, "legs">,
  operations: readonly OperationView[] | null,
  sourceLegId: string,
  targetUserId: string,
) {
  const targetLegIds = new Set(
    operations
      ?.filter(
        (operation) =>
          operation.type === "TRANSFER" &&
          operation.sourceLegId === sourceLegId &&
          operation.targetUserId === targetUserId &&
          operation.targetLegId,
      )
      .map(({ targetLegId }) => targetLegId as string) ?? [],
  );
  if (targetLegIds.size === 0) return 1;

  const latestTarget = [...call.legs].reverse().find(({ id }) => targetLegIds.has(id));
  return latestTarget && !["ENDED", "FAILED"].includes(latestTarget.status)
    ? targetLegIds.size
    : targetLegIds.size + 1;
}

export function beginCanonicalTake(inFlight: Set<string>, callId: string) {
  if (inFlight.has(callId)) return false;
  inFlight.add(callId);
  return true;
}

export async function answerCanonicalMediaOnce(
  inFlight: Set<string>,
  mediaLegId: string,
  answer: () => Promise<void>,
) {
  if (inFlight.has(mediaLegId)) return false;
  inFlight.add(mediaLegId);
  try {
    await answer();
    return true;
  } catch (error) {
    inFlight.delete(mediaLegId);
    throw error;
  }
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

function sameProviderSession(
  leg: CallView["legs"][number],
  observation: MediaObservation,
) {
  return Boolean(
    leg.providerCallSessionId &&
    observation.direction === "INBOUND" &&
    ["ACTIVE", "CONNECTING", "HELD", "RINGING"].includes(observation.state) &&
    observation.providerCallSessionId === leg.providerCallSessionId,
  );
}

export function selectCanonicalBrowserMediaLeg(
  call: CallView,
  agentSessionId: string,
  endpointId: string,
  observations: readonly MediaObservation[],
) {
  const liveLegs = call.legs.filter(
    (leg) =>
      leg.kind === "AGENT" &&
      leg.agentSessionId === agentSessionId &&
      leg.endpointId === endpointId &&
      !["ENDED", "FAILED"].includes(leg.status),
  );
  const liveObservations = observations.filter(
    ({ state }) => !["ENDED", "FAILED"].includes(state),
  );
  const matches = (
    predicate: (leg: CallView["legs"][number], observation: MediaObservation) => boolean,
  ) =>
    liveLegs.flatMap((leg) =>
      liveObservations
        .filter((observation) => predicate(leg, observation))
        .map((observation) => ({ leg, observation })),
    );

  const exact = matches(sameProviderLeg);
  if (exact.length) return exact.length === 1 ? exact[0] : null;

  const session = matches(sameProviderSession);
  return session.length === 1 ? session[0] : null;
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
