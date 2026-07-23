import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { INBOUND_ANSWER_GRACE_SECONDS } from "@/lib/call-center/domain/active-inbound-lifecycle";

export type InboundAnswerReservationStatus =
  "ACCEPTED" | "ANSWERED" | "BRIDGED" | "EXPIRED" | "FAILED" | "RELEASED";

export type InboundAnswerReservation = {
  acceptedAt: Date;
  agentSessionId: string;
  expiresAt: Date;
  id: string;
  idempotencyKey: string;
  legId: string;
  status: InboundAnswerReservationStatus;
};

export type InboundAnswerClaimContext = {
  call: {
    deadlineAt: Date | null;
    direction: "INBOUND" | "OUTBOUND";
    hardDeadlineAt: Date | null;
    id: string;
    status: string;
    voicemailStartedAt: Date | null;
    winningLegId: string | null;
  };
  endpointOccupied: boolean;
  leg: {
    agentSessionId: string | null;
    endpointId: string | null;
    id: string;
    kind: "AGENT" | "CUSTOMER";
    status: string;
  } | null;
  reservation: InboundAnswerReservation | null;
  priorClaim:
    | {
        actorUserId: string;
        outcome: "ACCEPTED";
        reservation: InboundAnswerReservation;
      }
    | {
        legId: string;
        outcome: "REJECTED";
        reason: InboundAnswerRejectionReason;
        sessionId: string;
      }
    | null;
  session: {
    audioReady: boolean;
    connectionState: string;
    endpointId: string;
    id: string;
    leaseExpiresAt: Date;
    microphoneReady: boolean;
    presence: string;
    userId: string;
  } | null;
};

export type InboundAnswerRejectionReason =
  | "ACTIVE_WINNER"
  | "AGENT_SESSION_UNAVAILABLE"
  | "ANSWER_IN_PROGRESS"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_CALL_LEG"
  | "NOT_AUTHORIZED"
  | "STALE_OFFER"
  | "VOICEMAIL_STARTED";

export type InboundAnswerClaimInput = {
  callId: string;
  idempotencyKey: string;
  legId: string;
  sessionId: string;
};

export interface InboundAnswerClaimTransaction {
  accept(input: {
    acceptedAt: Date;
    agentSessionId: string;
    expiresAt: Date;
    idempotencyKey: string;
    legId: string;
  }): Promise<InboundAnswerReservation>;
  load(
    input: InboundAnswerClaimInput,
    now: Date,
  ): Promise<InboundAnswerClaimContext | null>;
  recordRejection(input: {
    callId: string;
    idempotencyKey: string;
    legId: string;
    occurredAt: Date;
    reason: InboundAnswerRejectionReason;
    sessionId: string;
  }): Promise<void>;
  release(input: {
    failedAt: Date;
    failureCode: "BROWSER_ANSWER_FAILED" | "BROWSER_DISCONNECTED";
    idempotencyKey: string;
    reservationId: string;
  }): Promise<boolean>;
}

export interface InboundAnswerClaimStore {
  withCallLock<T>(
    actor: QueueAccessActor,
    input: Pick<InboundAnswerClaimInput, "callId" | "legId">,
    work: (transaction: InboundAnswerClaimTransaction) => Promise<T>,
  ): Promise<T>;
}

const LIVE_OFFER_STATUSES = new Set(["CREATED", "DIALING", "RINGING"]);
const ACTIVE_RESERVATION_STATUSES = new Set<InboundAnswerReservationStatus>([
  "ACCEPTED",
  "ANSWERED",
  "BRIDGED",
]);

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1_000);
}

function acceptedReplay(
  reservation: InboundAnswerReservation | null,
  input: InboundAnswerClaimInput,
  now: Date,
) {
  if (!reservation) {
    return null;
  }
  const exactIdentity =
    reservation.legId === input.legId && reservation.agentSessionId === input.sessionId;
  if (reservation.idempotencyKey === input.idempotencyKey) {
    return exactIdentity
      ? { replayed: true as const, reservation, status: "ACCEPTED" as const }
      : null;
  }
  if (
    !exactIdentity ||
    !ACTIVE_RESERVATION_STATUSES.has(reservation.status) ||
    (reservation.status !== "BRIDGED" && reservation.expiresAt <= now)
  ) {
    return null;
  }
  return { replayed: true as const, reservation, status: "ACCEPTED" as const };
}

function rejectionResult(
  input: InboundAnswerClaimInput,
  reason: InboundAnswerRejectionReason,
) {
  return {
    callId: input.callId,
    legId: input.legId,
    reason,
    status: "REJECTED" as const,
  };
}

function rejectionFor(
  context: InboundAnswerClaimContext | null,
  actor: QueueAccessActor,
  input: InboundAnswerClaimInput,
  now: Date,
): InboundAnswerRejectionReason | null {
  if (!context) return "NOT_AUTHORIZED";
  if (context.call.direction !== "INBOUND") return "STALE_OFFER";
  if (context.call.winningLegId) return "ACTIVE_WINNER";
  if (context.call.voicemailStartedAt || context.call.status === "VOICEMAIL") {
    return "VOICEMAIL_STARTED";
  }
  if (
    !["RECEIVED", "QUEUED", "RINGING"].includes(context.call.status) ||
    (context.call.deadlineAt && context.call.deadlineAt <= now) ||
    (context.call.hardDeadlineAt && context.call.hardDeadlineAt <= now)
  ) {
    return "STALE_OFFER";
  }
  const leg = context.leg;
  if (
    !leg ||
    leg.id !== input.legId ||
    leg.kind !== "AGENT" ||
    !leg.endpointId ||
    !LIVE_OFFER_STATUSES.has(leg.status)
  ) {
    return "INVALID_CALL_LEG";
  }
  const session = context.session;
  if (
    !session ||
    context.endpointOccupied ||
    session.id !== input.sessionId ||
    session.userId !== actor.userId ||
    session.endpointId !== leg.endpointId ||
    leg.agentSessionId !== session.id ||
    session.presence !== "AVAILABLE" ||
    session.connectionState !== "READY" ||
    !session.microphoneReady ||
    !session.audioReady ||
    session.leaseExpiresAt <= now
  ) {
    return "AGENT_SESSION_UNAVAILABLE";
  }
  const reservation = context.reservation;
  if (
    reservation &&
    ACTIVE_RESERVATION_STATUSES.has(reservation.status) &&
    (reservation.status === "BRIDGED" || reservation.expiresAt > now)
  ) {
    return "ANSWER_IN_PROGRESS";
  }
  return null;
}

export function claimInboundAnswer(
  store: InboundAnswerClaimStore,
  actor: QueueAccessActor,
  input: InboundAnswerClaimInput,
  now = new Date(),
) {
  return store.withCallLock(actor, input, async (transaction) => {
    const context = await transaction.load(input, now);
    const prior = context?.priorClaim;
    if (prior) {
      if (prior.outcome === "ACCEPTED" && prior.actorUserId !== actor.userId) {
        return rejectionResult(input, "IDEMPOTENCY_KEY_REUSED");
      }
      const legId = prior.outcome === "ACCEPTED" ? prior.reservation.legId : prior.legId;
      const sessionId =
        prior.outcome === "ACCEPTED" ? prior.reservation.agentSessionId : prior.sessionId;
      if (legId !== input.legId || sessionId !== input.sessionId) {
        return rejectionResult(input, "IDEMPOTENCY_KEY_REUSED");
      }
      if (prior.outcome === "ACCEPTED") {
        return {
          replayed: true as const,
          reservation: prior.reservation,
          status: "ACCEPTED" as const,
        };
      }
      return rejectionResult(input, prior.reason);
    }
    if (
      context?.reservation?.idempotencyKey === input.idempotencyKey &&
      (context.reservation.legId !== input.legId ||
        context.reservation.agentSessionId !== input.sessionId)
    ) {
      return rejectionResult(input, "IDEMPOTENCY_KEY_REUSED");
    }
    const replayAuthorized =
      context && !rejectionFor({ ...context, reservation: null }, actor, input, now);
    const replay = replayAuthorized
      ? acceptedReplay(context.reservation, input, now)
      : null;
    if (replay) return replay;

    const reason = rejectionFor(context, actor, input, now);
    if (reason) {
      await transaction.recordRejection({
        callId: input.callId,
        idempotencyKey: input.idempotencyKey,
        legId: input.legId,
        occurredAt: now,
        reason,
        sessionId: input.sessionId,
      });
      return rejectionResult(input, reason);
    }

    const hardDeadlineAt = context!.call.hardDeadlineAt;
    const graceDeadline = addSeconds(now, INBOUND_ANSWER_GRACE_SECONDS);
    const expiresAt =
      hardDeadlineAt && hardDeadlineAt < graceDeadline ? hardDeadlineAt : graceDeadline;
    const reservation = await transaction.accept({
      acceptedAt: now,
      agentSessionId: input.sessionId,
      expiresAt,
      idempotencyKey: input.idempotencyKey,
      legId: input.legId,
    });
    return { replayed: false as const, reservation, status: "ACCEPTED" as const };
  });
}

export type InboundAnswerReleaseInput = InboundAnswerClaimInput & {
  failureCode: "BROWSER_ANSWER_FAILED" | "BROWSER_DISCONNECTED";
};

export function releaseInboundAnswer(
  store: InboundAnswerClaimStore,
  actor: QueueAccessActor,
  input: InboundAnswerReleaseInput,
  now = new Date(),
) {
  return store.withCallLock(actor, input, async (transaction) => {
    const context = await transaction.load(input, now);
    const reservation = context?.reservation;
    if (
      !reservation ||
      reservation.idempotencyKey !== input.idempotencyKey ||
      reservation.legId !== input.legId ||
      reservation.agentSessionId !== input.sessionId ||
      !["ACCEPTED", "ANSWERED"].includes(reservation.status)
    ) {
      return { released: false as const, status: "IGNORED" as const };
    }
    const released = await transaction.release({
      failedAt: now,
      failureCode: input.failureCode,
      idempotencyKey: input.idempotencyKey,
      reservationId: reservation.id,
    });
    return released
      ? { released: true as const, status: "RELEASED" as const }
      : { released: false as const, status: "IGNORED" as const };
  });
}
