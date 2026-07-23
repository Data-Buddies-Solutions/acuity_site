import { Prisma } from "@/generated/prisma/client";
import type {
  InboundAnswerClaimContext,
  InboundAnswerClaimInput,
  InboundAnswerClaimStore,
  InboundAnswerClaimTransaction,
  InboundAnswerRejectionReason,
  InboundAnswerReservation,
} from "@/lib/call-center/application/claim-inbound-answer";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
type TransactionRunner = <T>(
  work: (transaction: Transaction) => Promise<T>,
) => Promise<T>;
const logger = createLogger("call-center-inbound-answer");

const reservationSelect = {
  acceptedAt: true,
  agentSessionId: true,
  expiresAt: true,
  id: true,
  idempotencyKey: true,
  legId: true,
  status: true,
} satisfies Prisma.CallCenterAnswerReservationSelect;

function reservationView(
  reservation: Prisma.CallCenterAnswerReservationGetPayload<{
    select: typeof reservationSelect;
  }>,
): InboundAnswerReservation {
  return reservation;
}

function answerEventKey(callId: string, idempotencyKey: string) {
  return `answer:${callId}:${idempotencyKey}`;
}

function jsonRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function priorAcceptedClaim(
  data: Prisma.JsonValue | null | undefined,
  idempotencyKey: string,
): InboundAnswerReservation | null {
  const record = jsonRecord(data);
  if (
    !record ||
    typeof record.acceptedAt !== "string" ||
    typeof record.agentSessionId !== "string" ||
    typeof record.expiresAt !== "string" ||
    typeof record.legId !== "string" ||
    typeof record.reservationId !== "string"
  ) {
    return null;
  }
  const acceptedAt = new Date(record.acceptedAt);
  const expiresAt = new Date(record.expiresAt);
  if (!Number.isFinite(acceptedAt.getTime()) || !Number.isFinite(expiresAt.getTime())) {
    return null;
  }
  return {
    acceptedAt,
    agentSessionId: record.agentSessionId,
    expiresAt,
    id: record.reservationId,
    idempotencyKey,
    legId: record.legId,
    status: "ACCEPTED",
  };
}

function priorRejectedClaim(data: Prisma.JsonValue | null | undefined) {
  const record = jsonRecord(data);
  const reasons: InboundAnswerRejectionReason[] = [
    "ACTIVE_WINNER",
    "AGENT_SESSION_UNAVAILABLE",
    "ANSWER_IN_PROGRESS",
    "IDEMPOTENCY_KEY_REUSED",
    "INVALID_CALL_LEG",
    "NOT_AUTHORIZED",
    "STALE_OFFER",
    "VOICEMAIL_STARTED",
  ];
  if (
    !record ||
    typeof record.legId !== "string" ||
    typeof record.reason !== "string" ||
    !reasons.includes(record.reason as InboundAnswerRejectionReason) ||
    typeof record.sessionId !== "string"
  ) {
    return null;
  }
  return {
    legId: record.legId,
    outcome: "REJECTED" as const,
    reason: record.reason as InboundAnswerRejectionReason,
    sessionId: record.sessionId,
  };
}

class PrismaInboundAnswerClaimTransaction implements InboundAnswerClaimTransaction {
  constructor(
    private readonly transaction: Transaction,
    private readonly actor: QueueAccessActor,
    private readonly callId: string,
    private readonly lockedEndpointId: string | null,
  ) {}

  async load(
    input: InboundAnswerClaimInput,
    now: Date,
  ): Promise<InboundAnswerClaimContext | null> {
    const call = await this.transaction.callCenterCall.findFirst({
      select: {
        answerReservation: { select: reservationSelect },
        deadlineAt: true,
        direction: true,
        hardDeadlineAt: true,
        id: true,
        number: { select: { practicePhoneNumber: { select: { locationId: true } } } },
        queue: {
          select: {
            enabled: true,
            locations: { select: { locationId: true } },
            members: {
              select: { id: true },
              where: { enabled: true, role: "AGENT", userId: this.actor.userId },
            },
          },
        },
        status: true,
        voicemailStartedAt: true,
        winningLegId: true,
      },
      where: { id: this.callId, practiceId: this.actor.practiceId },
    });
    if (!call?.queue?.enabled || call.queue.members.length === 0) return null;

    const scopedLocationIds = new Set(
      call.queue.locations.map(({ locationId }) => locationId),
    );
    const numberLocationId = call.number.practicePhoneNumber.locationId;
    if (
      !this.actor.hasAllLocationAccess &&
      ((scopedLocationIds.size > 0 &&
        !this.actor.allowedLocationIds.some((id) => scopedLocationIds.has(id))) ||
        (numberLocationId && !this.actor.allowedLocationIds.includes(numberLocationId)))
    ) {
      return null;
    }

    const leg = await this.transaction.callCenterCallLeg.findFirst({
      select: {
        agentSessionId: true,
        endpointId: true,
        id: true,
        kind: true,
        status: true,
      },
      where: { callId: call.id, id: input.legId },
    });
    if (leg?.endpointId !== this.lockedEndpointId) return null;
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_agent_session" WHERE "id" = ${input.sessionId} FOR UPDATE`,
    );
    const session = await this.transaction.callCenterAgentSession.findFirst({
      select: {
        audioReady: true,
        connectionState: true,
        endpointId: true,
        id: true,
        leaseExpiresAt: true,
        microphoneReady: true,
        presence: true,
        userId: true,
      },
      where: {
        id: input.sessionId,
        practiceId: this.actor.practiceId,
        userId: this.actor.userId,
      },
    });
    const activeReservation = leg?.endpointId
      ? await this.transaction.callCenterAnswerReservation.findFirst({
          select: { id: true },
          where: {
            callId: { not: call.id },
            OR: [
              {
                leg: { endpointId: leg.endpointId, status: "BRIDGED" },
                status: "BRIDGED",
              },
              {
                expiresAt: { gt: now },
                leg: { endpointId: leg.endpointId },
                status: { in: ["ACCEPTED", "ANSWERED"] },
              },
            ],
          },
        })
      : null;
    const activeLeg = leg?.endpointId
      ? await this.transaction.callCenterCallLeg.findFirst({
          select: { id: true },
          where: {
            callId: { not: call.id },
            endpointId: leg.endpointId,
            status: { in: ["ANSWERED", "BRIDGED"] },
          },
        })
      : null;
    const eventKey = answerEventKey(call.id, input.idempotencyKey);
    const priorAcceptanceEvent = await this.transaction.callCenterEvent.findUnique({
      select: { actorUserId: true, data: true },
      where: {
        practiceId_type_idempotencyKey: {
          idempotencyKey: eventKey,
          practiceId: this.actor.practiceId,
          type: "CALL_ANSWER_CLAIM_ACCEPTED",
        },
      },
    });
    const priorRejectionEvent = await this.transaction.callCenterEvent.findUnique({
      select: { actorUserId: true, data: true },
      where: {
        practiceId_type_idempotencyKey: {
          idempotencyKey: eventKey,
          practiceId: this.actor.practiceId,
          type: "CALL_ANSWER_CLAIM_REJECTED",
        },
      },
    });
    const priorAcceptance =
      priorAcceptanceEvent?.actorUserId === this.actor.userId
        ? priorAcceptedClaim(priorAcceptanceEvent.data, input.idempotencyKey)
        : null;

    return {
      call: {
        deadlineAt: call.deadlineAt,
        direction: call.direction,
        hardDeadlineAt: call.hardDeadlineAt,
        id: call.id,
        status: call.status,
        voicemailStartedAt: call.voicemailStartedAt,
        winningLegId: call.winningLegId,
      },
      endpointOccupied: Boolean(activeReservation || activeLeg),
      leg,
      reservation: call.answerReservation
        ? reservationView(call.answerReservation)
        : null,
      priorClaim: priorAcceptance
        ? {
            actorUserId: priorAcceptanceEvent!.actorUserId!,
            outcome: "ACCEPTED",
            reservation: priorAcceptance,
          }
        : priorRejectionEvent?.actorUserId === this.actor.userId
          ? priorRejectedClaim(priorRejectionEvent.data)
          : null,
      session,
    };
  }

  async accept(input: {
    acceptedAt: Date;
    agentSessionId: string;
    expiresAt: Date;
    idempotencyKey: string;
    legId: string;
  }) {
    const reservation = await this.transaction.callCenterAnswerReservation.upsert({
      create: {
        ...input,
        callId: this.callId,
        status: "ACCEPTED",
      },
      select: reservationSelect,
      update: {
        ...input,
        answeredAt: null,
        bridgedAt: null,
        failureCode: null,
        releasedAt: null,
        status: "ACCEPTED",
      },
      where: { callId: this.callId },
    });
    await this.transaction.callCenterCall.update({
      data: { stateVersion: { increment: 1 } },
      where: { id: this.callId },
    });
    await this.transaction.callCenterEvent.upsert({
      create: {
        actorUserId: this.actor.userId,
        aggregateId: this.callId,
        aggregateType: "CALL",
        data: {
          acceptedAt: input.acceptedAt.toISOString(),
          agentSessionId: input.agentSessionId,
          expiresAt: input.expiresAt.toISOString(),
          legId: input.legId,
          reservationId: reservation.id,
        },
        idempotencyKey: answerEventKey(this.callId, input.idempotencyKey),
        occurredAt: input.acceptedAt,
        practiceId: this.actor.practiceId,
        type: "CALL_ANSWER_CLAIM_ACCEPTED",
      },
      update: {},
      where: {
        practiceId_type_idempotencyKey: {
          idempotencyKey: answerEventKey(this.callId, input.idempotencyKey),
          practiceId: this.actor.practiceId,
          type: "CALL_ANSWER_CLAIM_ACCEPTED",
        },
      },
    });
    return reservationView(reservation);
  }

  async recordRejection(input: {
    callId: string;
    idempotencyKey: string;
    legId: string;
    occurredAt: Date;
    reason: InboundAnswerRejectionReason;
    sessionId: string;
  }) {
    if (input.reason === "NOT_AUTHORIZED") return;
    await this.transaction.callCenterEvent.upsert({
      create: {
        actorUserId: this.actor.userId,
        aggregateId: input.callId,
        aggregateType: "CALL",
        data: {
          legId: input.legId,
          reason: input.reason,
          sessionId: input.sessionId,
        },
        idempotencyKey: answerEventKey(input.callId, input.idempotencyKey),
        occurredAt: input.occurredAt,
        practiceId: this.actor.practiceId,
        type: "CALL_ANSWER_CLAIM_REJECTED",
      },
      update: {},
      where: {
        practiceId_type_idempotencyKey: {
          idempotencyKey: answerEventKey(input.callId, input.idempotencyKey),
          practiceId: this.actor.practiceId,
          type: "CALL_ANSWER_CLAIM_REJECTED",
        },
      },
    });
  }

  async release(input: {
    failedAt: Date;
    failureCode: "BROWSER_ANSWER_FAILED" | "BROWSER_DISCONNECTED";
    idempotencyKey: string;
    reservationId: string;
  }) {
    const released = await this.transaction.callCenterAnswerReservation.updateMany({
      data: {
        failureCode: input.failureCode,
        releasedAt: input.failedAt,
        status: "FAILED",
      },
      where: {
        id: input.reservationId,
        status: { in: ["ACCEPTED", "ANSWERED"] },
      },
    });
    if (released.count !== 1) return false;
    await this.transaction.callCenterCall.update({
      data: { stateVersion: { increment: 1 } },
      where: { id: this.callId },
    });
    await this.transaction.callCenterEvent.upsert({
      create: {
        actorUserId: this.actor.userId,
        aggregateId: this.callId,
        aggregateType: "CALL",
        data: {
          failureCode: input.failureCode,
          reservationId: input.reservationId,
        },
        idempotencyKey: `${answerEventKey(this.callId, input.idempotencyKey)}:failed`,
        occurredAt: input.failedAt,
        practiceId: this.actor.practiceId,
        type: "CALL_ANSWER_FAILED",
      },
      update: {},
      where: {
        practiceId_type_idempotencyKey: {
          idempotencyKey: `${answerEventKey(this.callId, input.idempotencyKey)}:failed`,
          practiceId: this.actor.practiceId,
          type: "CALL_ANSWER_FAILED",
        },
      },
    });
    return true;
  }
}

export class PrismaInboundAnswerClaimStore implements InboundAnswerClaimStore {
  constructor(
    private readonly runTransaction: TransactionRunner = (work) =>
      prisma.$transaction(work),
  ) {}

  withCallLock<T>(
    actor: QueueAccessActor,
    input: Pick<InboundAnswerClaimInput, "callId" | "legId">,
    work: (transaction: InboundAnswerClaimTransaction) => Promise<T>,
  ) {
    return this.runTransaction(async (transaction) => {
      const target = await transaction.callCenterCallLeg.findFirst({
        select: { endpointId: true },
        where: {
          call: { practiceId: actor.practiceId },
          callId: input.callId,
          id: input.legId,
        },
      });
      if (target?.endpointId) {
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "call_center_endpoint" WHERE "id" = ${target.endpointId} FOR UPDATE`,
        );
      }
      const startedAt = performance.now();
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "practiceId" = ${actor.practiceId} AND "id" = ${input.callId} FOR UPDATE`,
      );
      logger.info("inbound Answer call lock acquired", {
        callId: input.callId,
        lockWaitMs: performance.now() - startedAt,
      });
      return work(
        new PrismaInboundAnswerClaimTransaction(
          transaction,
          actor,
          input.callId,
          target?.endpointId ?? null,
        ),
      );
    });
  }
}

export const prismaInboundAnswerClaimStore = new PrismaInboundAnswerClaimStore();
