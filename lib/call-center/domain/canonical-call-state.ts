export type CanonicalCallStatus =
  | "ABANDONED"
  | "COMPLETED"
  | "CONNECTED"
  | "FAILED"
  | "QUEUED"
  | "RECEIVED"
  | "RINGING"
  | "VOICEMAIL"
  | "WRAP_UP";

export type CanonicalCallState = {
  answeredAt: Date | null;
  endedAt: Date | null;
  firstRingAt: Date | null;
  queuedAt: Date | null;
  stateVersion: number;
  status: CanonicalCallStatus;
  voicemailStartedAt: Date | null;
};

export type CanonicalLegStatus =
  "ANSWERED" | "BRIDGED" | "CREATED" | "DIALING" | "ENDED" | "FAILED" | "RINGING";

export type CanonicalLegState = {
  answeredAt: Date | null;
  bridgedAt: Date | null;
  endedAt: Date | null;
  status: CanonicalLegStatus;
};

const CALL_RANK: Partial<Record<CanonicalCallStatus, number>> = {
  RECEIVED: 0,
  QUEUED: 1,
  RINGING: 2,
  CONNECTED: 3,
  WRAP_UP: 4,
};
const TERMINAL_CALL_STATUSES = new Set<CanonicalCallStatus>([
  "ABANDONED",
  "COMPLETED",
  "FAILED",
  "VOICEMAIL",
]);
const LEG_RANK: Record<CanonicalLegStatus, number> = {
  CREATED: 0,
  DIALING: 1,
  RINGING: 2,
  ANSWERED: 3,
  BRIDGED: 4,
  ENDED: 5,
  FAILED: 5,
};
const TERMINAL_LEG_STATUSES = new Set<CanonicalLegStatus>(["ENDED", "FAILED"]);

function earliest(current: Date | null, candidate: Date) {
  return !current || candidate.getTime() < current.getTime() ? candidate : current;
}

function sameDate(left: Date | null, right: Date | null) {
  return left?.getTime() === right?.getTime();
}

function evidenceBackedCallStatus(
  current: CanonicalCallState,
  hasBridgeEvidence: boolean,
) {
  if (hasBridgeEvidence) return current.endedAt ? "COMPLETED" : "CONNECTED";
  if (current.voicemailStartedAt) return "VOICEMAIL";
  return current.status;
}

export function reconcileCanonicalCallOutcome(
  current: CanonicalCallState,
  { hasBridgeEvidence = false }: { hasBridgeEvidence?: boolean } = {},
) {
  const status = evidenceBackedCallStatus(current, hasBridgeEvidence);
  return status === current.status
    ? current
    : { ...current, stateVersion: current.stateVersion + 1, status };
}

function callStatusAfterObservation(
  current: CanonicalCallStatus,
  observed: CanonicalCallStatus,
) {
  if (current === observed) return current;

  // A retained voicemail is stronger evidence than an earlier unanswered
  // hangup. This refines the terminal outcome without reopening the call.
  if (current === "ABANDONED" && observed === "VOICEMAIL") return observed;
  if (TERMINAL_CALL_STATUSES.has(current)) return current;
  if (TERMINAL_CALL_STATUSES.has(observed)) return observed;

  return (CALL_RANK[observed] ?? -1) > (CALL_RANK[current] ?? -1) ? observed : current;
}

export function advanceCanonicalCall(
  current: CanonicalCallState,
  observed: CanonicalCallStatus,
  occurredAt: Date,
  { hasBridgeEvidence = false }: { hasBridgeEvidence?: boolean } = {},
): CanonicalCallState {
  const next = {
    ...current,
    status: callStatusAfterObservation(current.status, observed),
  };

  if (observed === "QUEUED") next.queuedAt = earliest(next.queuedAt, occurredAt);
  if (observed === "RINGING") next.firstRingAt = earliest(next.firstRingAt, occurredAt);
  if (observed === "CONNECTED") next.answeredAt = earliest(next.answeredAt, occurredAt);
  if (observed === "VOICEMAIL") {
    next.voicemailStartedAt = earliest(next.voicemailStartedAt, occurredAt);
  }
  if (TERMINAL_CALL_STATUSES.has(observed) || observed === "WRAP_UP") {
    next.endedAt = earliest(next.endedAt, occurredAt);
  }

  // Persisted bridge evidence outranks a provisional voicemail/abandon outcome.
  // If a terminal fact already exists the handled call is completed; otherwise
  // it remains connected. This makes delivery order irrelevant.
  next.status = evidenceBackedCallStatus(next, hasBridgeEvidence);

  const changed =
    next.status !== current.status ||
    !sameDate(next.queuedAt, current.queuedAt) ||
    !sameDate(next.firstRingAt, current.firstRingAt) ||
    !sameDate(next.answeredAt, current.answeredAt) ||
    !sameDate(next.voicemailStartedAt, current.voicemailStartedAt) ||
    !sameDate(next.endedAt, current.endedAt);

  return changed ? { ...next, stateVersion: current.stateVersion + 1 } : current;
}

export function advanceCanonicalLeg(
  current: CanonicalLegState,
  observed: CanonicalLegStatus,
  occurredAt: Date,
): CanonicalLegState {
  const next = { ...current };

  if (observed === "ANSWERED" || observed === "BRIDGED") {
    next.answeredAt = earliest(next.answeredAt, occurredAt);
  }
  if (observed === "BRIDGED") next.bridgedAt = earliest(next.bridgedAt, occurredAt);
  if (TERMINAL_LEG_STATUSES.has(observed)) {
    next.endedAt = earliest(next.endedAt, occurredAt);
  }
  if (
    !TERMINAL_LEG_STATUSES.has(current.status) &&
    LEG_RANK[observed] > LEG_RANK[current.status]
  ) {
    next.status = observed;
  }

  return next;
}

export function terminalCallObservation(
  current: CanonicalCallStatus,
): "ABANDONED" | "COMPLETED" {
  return current === "CONNECTED" || current === "WRAP_UP" ? "COMPLETED" : "ABANDONED";
}

export function selectWinningAgentLeg(
  legs: ReadonlyArray<{ bridgedAt: Date | null; id: string }>,
) {
  return (
    legs
      .filter((leg): leg is { bridgedAt: Date; id: string } => Boolean(leg.bridgedAt))
      .toSorted(
        (left, right) =>
          left.bridgedAt.getTime() - right.bridgedAt.getTime() ||
          left.id.localeCompare(right.id),
      )[0]?.id ?? null
  );
}
