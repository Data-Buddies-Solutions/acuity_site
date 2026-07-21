import {
  LIVE_CANONICAL_LEG_STATUSES,
  UNBRIDGED_LIVE_CANONICAL_LEG_STATUSES,
} from "@/lib/call-center/domain/canonical-call-state";
import { CallCenterRequestError } from "@/lib/call-center/operator-error";
import type { AgentSessionView, CallView } from "@/lib/call-center/realtime-contract";

import type { MediaObservation } from "./softphone-media-adapter";

const OUTBOUND_OPERATION_STORAGE_KEY = "acuity-call-center:outbound-operation";

type OutboundOperationStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export function reconcileCanonicalOutboundRuntime(input: {
  awaitingFreshSnapshot: boolean;
  canonicalCallId: string | null;
  canonicalCallObserved: boolean;
  canonicalCallVisible: boolean;
  freshSnapshotAvailable: boolean;
  hasActiveOutboundCall: boolean;
  startingOutbound: boolean;
}) {
  const active = input.startingOutbound || input.hasActiveOutboundCall;
  const observed =
    input.canonicalCallObserved ||
    input.canonicalCallVisible ||
    (active && !input.startingOutbound);

  if (active) {
    return { active: true, callId: input.canonicalCallId, observed };
  }
  if (
    observed ||
    input.freshSnapshotAvailable ||
    (!input.awaitingFreshSnapshot && !input.canonicalCallId)
  ) {
    return { active: false, callId: null, observed: false };
  }

  // Preserve suppression until a snapshot newer than the request result can
  // prove that an ambiguous or just-created operation has no active call.
  return null;
}

export function isDefinitiveCanonicalOutboundFailure(error: unknown) {
  return error instanceof CallCenterRequestError && !error.operatorError.retryable;
}

function outboundSourceLegId(call: CallView) {
  return call.direction === "OUTBOUND"
    ? (call.legs.find((leg) => leg.kind === "AGENT")?.id ?? null)
    : null;
}

function transferSourceLegId(call: CallView) {
  return call.winningLegId ?? outboundSourceLegId(call);
}

export function selectCanonicalAgentActiveCall(
  calls: readonly CallView[],
  session: Pick<AgentSessionView, "endpointId" | "id"> | null,
) {
  if (!session) return null;
  return (
    calls.find((call) => {
      const ownedLeg = call.legs.find(
        (leg) =>
          leg.kind === "AGENT" &&
          leg.agentSessionId === session.id &&
          leg.endpointId === session.endpointId &&
          !["ENDED", "FAILED"].includes(leg.status),
      );
      if (call.direction === "OUTBOUND") {
        if (call.status === "CONNECTED") {
          return (
            transferSourceLegId(call) === ownedLeg?.id &&
            ["ANSWERED", "BRIDGED"].includes(ownedLeg.status)
          );
        }
        return Boolean(ownedLeg);
      }
      return (
        call.status === "CONNECTED" &&
        Boolean(call.answeredAt) &&
        call.winningLegId === ownedLeg?.id &&
        ownedLeg.status === "BRIDGED"
      );
    }) ?? null
  );
}

export function isCanonicalTransferOffer(
  call: CallView,
  session: Pick<AgentSessionView, "endpointId" | "id"> | null,
) {
  if (!session || call.status !== "CONNECTED") return false;
  const sourceLegId = transferSourceLegId(call);
  if (!sourceLegId) return false;
  return call.legs.some(
    (leg) =>
      leg.kind === "AGENT" &&
      leg.agentSessionId === session.id &&
      leg.endpointId === session.endpointId &&
      leg.id !== sourceLegId &&
      UNBRIDGED_LIVE_CANONICAL_LEG_STATUSES.includes(leg.status as never),
  );
}

export function selectCanonicalTransferOffers(
  calls: readonly CallView[],
  session: Pick<AgentSessionView, "endpointId" | "id"> | null,
) {
  return calls.filter((call) => isCanonicalTransferOffer(call, session));
}

export function hasCanonicalSessionLiveLeg(
  calls: readonly CallView[],
  session: Pick<AgentSessionView, "id"> | null,
) {
  return Boolean(
    session &&
    calls.some((call) =>
      call.legs.some(
        (leg) =>
          leg.agentSessionId === session.id &&
          LIVE_CANONICAL_LEG_STATUSES.includes(leg.status as never),
      ),
    ),
  );
}

export function hasCanonicalPendingTransfer(call: CallView) {
  return call.status === "CONNECTED" && call.transferring;
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

export function failCanonicalOutboundOperation(
  storage: OutboundOperationStorage,
  target: Parameters<typeof outboundTargetFingerprint>[0],
  key: string,
  error: unknown,
) {
  if (isDefinitiveCanonicalOutboundFailure(error)) {
    completeCanonicalOutboundOperation(storage, target, key);
  }
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
