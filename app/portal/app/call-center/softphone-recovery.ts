import type { Call } from "@telnyx/webrtc";

import {
  normalizeMediaObservation,
  upsertMediaObservation,
  type MediaObservation,
  type ProviderMediaIdentity,
} from "./softphone-media-adapter";

export type TelnyxErrorDetails = {
  callId: string | null;
  code: string | null;
  fatal: boolean | null;
  message: string | null;
  name: string | null;
};

export type ReconciledCallUpdate =
  | {
      accepted: false;
      providerIds: ProviderMediaIdentity;
      recoveredMediaLegId: string | null;
    }
  | {
      accepted: true;
      nextObservations: readonly MediaObservation[];
      observation: MediaObservation;
      priorObservation: MediaObservation | null;
      recoveredMediaLegId: string | null;
      terminal: boolean;
    };

export type PendingAnswerAction =
  "ANSWER_REPLACEMENT" | "FAIL" | "NONE" | "REJECT" | "SUCCEED";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function telnyxErrorDetails(value: unknown): TelnyxErrorDetails {
  const outer = record(value);
  const inner = record(outer?.error) ?? outer;
  const code = inner?.code;
  const name = inner?.name;
  const message = inner?.message;
  return {
    callId: typeof outer?.callId === "string" ? outer.callId : null,
    code: typeof code === "number" || typeof code === "string" ? String(code) : null,
    fatal: typeof inner?.fatal === "boolean" ? inner.fatal : null,
    message: typeof message === "string" ? message : null,
    name: typeof name === "string" ? name : null,
  };
}

export function isCallDoesNotExist(value: unknown) {
  const details = telnyxErrorDetails(value);
  return (
    details.code === "-32002" ||
    /CALL[\s_]DOES[\s_]NOT[\s_]EXIST/i.test(
      [details.name, details.message].filter(Boolean).join(" "),
    )
  );
}

export function isSessionNotReattached(value: unknown) {
  const details = telnyxErrorDetails(value);
  return (
    details.code === "48501" ||
    details.name === "SESSION_NOT_REATTACHED" ||
    details.message === "SESSION_NOT_REATTACHED"
  );
}

function sharesProviderIdentity(
  observation: MediaObservation,
  providerIds: ProviderMediaIdentity,
) {
  return observation.correlationProviderIds.some((identity) =>
    Boolean(
      (providerIds.providerCallControlId &&
        identity.providerCallControlId === providerIds.providerCallControlId) ||
      (providerIds.providerCallLegId &&
        identity.providerCallLegId === providerIds.providerCallLegId) ||
      (providerIds.providerCallSessionId &&
        identity.providerCallSessionId === providerIds.providerCallSessionId),
    ),
  );
}

function uniqueProviderIdentities(
  identities: readonly ProviderMediaIdentity[],
): ProviderMediaIdentity[] {
  return identities.filter(
    (identity, index) =>
      index ===
      identities.findIndex(
        (candidate) =>
          candidate.providerCallControlId === identity.providerCallControlId &&
          candidate.providerCallLegId === identity.providerCallLegId &&
          candidate.providerCallSessionId === identity.providerCallSessionId,
      ),
  );
}

export function reconcileCallUpdate({
  call,
  connectionId,
  current,
  recoveryGeneration,
}: {
  call: Call;
  connectionId: string;
  current: readonly MediaObservation[];
  recoveryGeneration: number;
}): ReconciledCallUpdate {
  const providerIds = {
    providerCallControlId: call.telnyxIDs?.telnyxCallControlId ?? null,
    providerCallLegId: call.telnyxIDs?.telnyxLegId ?? null,
    providerCallSessionId: call.telnyxIDs?.telnyxSessionId ?? null,
  };
  const explicitPredecessorId = call.recoveredCallId?.trim() || null;
  const currentObservation = current.find(
    (observation) => observation.mediaLegId === call.id,
  );
  const providerPredecessors =
    explicitPredecessorId || currentObservation
      ? []
      : current.filter(
          (observation) =>
            observation.mediaLegId !== call.id &&
            observation.availability !== "READY" &&
            sharesProviderIdentity(observation, providerIds),
        );
  const recoveredMediaLegId =
    explicitPredecessorId ??
    currentObservation?.recoveredMediaLegId ??
    (providerPredecessors.length === 1
      ? (providerPredecessors[0]?.mediaLegId ?? null)
      : null);
  const predecessors = recoveredMediaLegId
    ? current.filter((observation) => observation.mediaLegId === recoveredMediaLegId)
    : [];
  const knownReplacement = Boolean(
    recoveredMediaLegId &&
    current.some(
      (observation) =>
        observation.mediaLegId === call.id &&
        observation.recoveredMediaLegId === recoveredMediaLegId,
    ),
  );
  if (
    providerPredecessors.length > 1 ||
    (recoveredMediaLegId && predecessors.length !== 1 && !knownReplacement)
  ) {
    return {
      accepted: false,
      providerIds,
      recoveredMediaLegId,
    };
  }

  const observation = normalizeMediaObservation({
    availability: "READY",
    connectionId,
    direction: call.direction,
    mediaLegId: call.id,
    ...providerIds,
    recoveredMediaLegId,
    recoveryGeneration,
    remoteAudioReady: Boolean(call.remoteStream),
    state: call.state,
  });
  const priorObservation =
    predecessors[0] ??
    current.find(
      (candidate) =>
        candidate.mediaLegId === call.id &&
        candidate.recoveredMediaLegId === recoveredMediaLegId,
    ) ??
    null;
  const correlatedObservation = priorObservation
    ? {
        ...observation,
        correlationProviderIds: uniqueProviderIdentities([
          ...observation.correlationProviderIds,
          ...priorObservation.correlationProviderIds,
        ]),
      }
    : observation;
  const withoutPredecessor = current.filter(
    ({ connectionId: observedConnectionId, mediaLegId }) =>
      (observedConnectionId !== correlatedObservation.connectionId ||
        mediaLegId !== correlatedObservation.mediaLegId) &&
      mediaLegId !== recoveredMediaLegId,
  );
  const terminal = ["ENDED", "FAILED"].includes(correlatedObservation.state);
  return {
    accepted: true,
    nextObservations: terminal
      ? withoutPredecessor
      : upsertMediaObservation(withoutPredecessor, correlatedObservation),
    observation: correlatedObservation,
    priorObservation,
    recoveredMediaLegId,
    terminal,
  };
}

export function pendingAnswerAction({
  callId,
  canContinue,
  current,
  observation,
  pending,
  recoveredMediaLegId,
}: {
  callId: string;
  canContinue(mediaLegId: string): boolean;
  current: readonly MediaObservation[];
  observation: MediaObservation;
  pending: {
    invokedMediaLegIds: ReadonlySet<string>;
    mediaLegId: string;
  } | null;
  recoveredMediaLegId: string | null;
}): PendingAnswerAction {
  if (!pending) return "NONE";

  let effectiveMediaLegId = pending.mediaLegId;
  let transfer = false;
  if (recoveredMediaLegId && pending.mediaLegId === recoveredMediaLegId) {
    const activeElsewhere = current.some(
      (candidate) =>
        candidate.mediaLegId !== recoveredMediaLegId &&
        ["ACTIVE", "HELD"].includes(candidate.state),
    );
    if (activeElsewhere || !canContinue(recoveredMediaLegId)) {
      return "REJECT";
    }
    effectiveMediaLegId = callId;
    transfer = !pending.invokedMediaLegIds.has(callId);
  }

  if (effectiveMediaLegId !== observation.mediaLegId) {
    return transfer ? "ANSWER_REPLACEMENT" : "NONE";
  }
  if (["ACTIVE", "HELD"].includes(observation.state)) {
    return "SUCCEED";
  }
  if (["ENDED", "FAILED"].includes(observation.state)) {
    return "FAIL";
  }
  return transfer ? "ANSWER_REPLACEMENT" : "NONE";
}
