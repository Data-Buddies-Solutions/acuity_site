import { Prisma } from "@/generated/prisma/client";
import {
  advanceCanonicalCall,
  advanceCanonicalLeg,
  reconcileCanonicalCallOutcome,
  selectWinningAgentLeg,
  terminalCallObservation,
} from "@/lib/call-center/domain/canonical-call-state";
import type { CanonicalProjectionRecord } from "@/lib/call-center/infrastructure/canonical-provider-webhook-inbox";
import {
  resolveCanonicalTelnyxCallObservations,
  resolveCanonicalTelnyxLegKind,
  type CanonicalTelnyxCallFact,
  type ResolvedCanonicalTelnyxCallFact,
} from "@/lib/call-center/infrastructure/telnyx-canonical-call-fact";
import { phoneLookupVariants } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

export class CanonicalProjectionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CanonicalProjectionError";
  }
}

export type CanonicalProjectionResult = {
  callId: string;
  callStatus: string;
  legId: string;
  legStatus: string;
  practiceId: string;
  routingMode: "LEGACY" | "SHADOW" | "ACTIVE" | null;
};

export type CanonicalCallProjector = {
  projectAndComplete(
    event: CanonicalProjectionRecord,
    fact: CanonicalTelnyxCallFact,
    projectedAt: Date,
  ): Promise<CanonicalProjectionResult>;
};

type Transaction = Prisma.TransactionClient;

export function assertCanonicalProviderLegIdentity(
  existing: {
    providerCallControlId: string | null;
    providerCallLegId: string | null;
  },
  supplied: Pick<CanonicalTelnyxCallFact, "providerCallControlId" | "providerCallLegId">,
) {
  if (
    (supplied.providerCallControlId &&
      existing.providerCallControlId &&
      supplied.providerCallControlId !== existing.providerCallControlId) ||
    (supplied.providerCallLegId &&
      existing.providerCallLegId &&
      supplied.providerCallLegId !== existing.providerCallLegId)
  ) {
    throw new CanonicalProjectionError("CANONICAL_LEG_IDENTITY_MISMATCH");
  }
}

type AgentLinkContext = {
  callerSession: { telnyxCallSessionId: string | null } | null;
  id: string;
  practiceId: string;
};

export function resolveCanonicalAgentLink(input: {
  queueItem: AgentLinkContext | null;
  requestedQueueItemId: string | null;
  requestedRingAttemptId: string | null;
  ringAttempt: { queueItem: AgentLinkContext } | null;
}) {
  if (input.requestedRingAttemptId) {
    if (!input.ringAttempt) {
      throw new CanonicalProjectionError("CANONICAL_RING_ATTEMPT_NOT_FOUND");
    }
    if (
      input.requestedQueueItemId &&
      input.ringAttempt.queueItem.id !== input.requestedQueueItemId
    ) {
      throw new CanonicalProjectionError("CANONICAL_QUEUE_LINK_MISMATCH");
    }
    return input.ringAttempt.queueItem;
  }

  if (input.requestedQueueItemId && !input.queueItem) {
    throw new CanonicalProjectionError("CANONICAL_QUEUE_ITEM_NOT_FOUND");
  }
  if (!input.queueItem) {
    throw new CanonicalProjectionError("CANONICAL_AGENT_LINK_NOT_FOUND");
  }
  return input.queueItem;
}

async function existingLeg(tx: Transaction, fact: CanonicalTelnyxCallFact) {
  const identity = [
    ...(fact.providerCallControlId
      ? [{ providerCallControlId: fact.providerCallControlId }]
      : []),
    ...(fact.providerCallLegId ? [{ providerCallLegId: fact.providerCallLegId }] : []),
    ...(!fact.providerCallControlId &&
    !fact.providerCallLegId &&
    fact.eventType === "calls.voicemail.completed" &&
    fact.providerCallSessionId
      ? [
          {
            kind: "CUSTOMER" as const,
            providerCallSessionId: fact.providerCallSessionId,
          },
        ]
      : []),
  ];
  const matches = await tx.callCenterCallLeg.findMany({
    include: { call: true },
    take: 2,
    where: {
      OR: identity,
    },
  });

  if (matches.length > 1) {
    throw new CanonicalProjectionError("CANONICAL_LEG_IDENTITY_AMBIGUOUS");
  }
  const match = matches[0] ?? null;
  if (match) assertCanonicalProviderLegIdentity(match, fact);
  return match;
}

async function resolveAgentContext(
  tx: Transaction,
  fact: ResolvedCanonicalTelnyxCallFact,
) {
  const ringAttempt = fact.clientRingAttemptId
    ? await tx.callCenterRingAttempt.findUnique({
        select: {
          queueItem: {
            select: {
              callerSession: { select: { telnyxCallSessionId: true } },
              id: true,
              practiceId: true,
            },
          },
          seatId: true,
        },
        where: { id: fact.clientRingAttemptId },
      })
    : null;
  const queueItem =
    !fact.clientRingAttemptId && fact.clientQueueItemId
      ? await tx.callCenterQueueItem.findUnique({
          select: {
            callerSession: { select: { telnyxCallSessionId: true } },
            id: true,
            practiceId: true,
          },
          where: { id: fact.clientQueueItemId },
        })
      : null;
  const context = resolveCanonicalAgentLink({
    queueItem,
    requestedQueueItemId: fact.clientQueueItemId,
    requestedRingAttemptId: fact.clientRingAttemptId,
    ringAttempt,
  });
  const endpointId = fact.endpointId ?? ringAttempt?.seatId ?? null;

  if (ringAttempt && fact.endpointId && ringAttempt.seatId !== fact.endpointId) {
    throw new CanonicalProjectionError("CANONICAL_ENDPOINT_LINK_MISMATCH");
  }
  if (!endpointId) throw new CanonicalProjectionError("CANONICAL_ENDPOINT_NOT_FOUND");

  const endpoint = await tx.callCenterEndpoint.findFirst({
    select: { id: true },
    where: { id: endpointId, practiceId: context.practiceId },
  });
  if (!endpoint) throw new CanonicalProjectionError("CANONICAL_ENDPOINT_NOT_FOUND");

  const customerSessionId = context.callerSession?.telnyxCallSessionId;
  if (!customerSessionId) {
    throw new CanonicalProjectionError("CANONICAL_CUSTOMER_SESSION_NOT_FOUND");
  }

  const call = await tx.callCenterCall.findUnique({
    where: { providerCallSessionId: customerSessionId },
  });
  if (!call || call.practiceId !== context.practiceId) {
    throw new CanonicalProjectionError("CANONICAL_CALL_NOT_FOUND");
  }

  return { call, endpointId: endpoint.id };
}

function customerPhones(
  fact: CanonicalTelnyxCallFact,
  direction: "INBOUND" | "OUTBOUND",
) {
  return direction === "INBOUND"
    ? { callerPhone: fact.fromPhone, practicePhone: fact.toPhone }
    : { callerPhone: fact.toPhone, practicePhone: fact.fromPhone };
}

export function earliestObservedAt(current: Date, observed: Date) {
  return observed.getTime() < current.getTime() ? observed : current;
}

export function enrichCanonicalCallIdentity(
  call: {
    callerName: string | null;
    direction: "INBOUND" | "OUTBOUND";
    fromPhone: string;
    receivedAt: Date;
    toPhone: string;
  },
  fact: CanonicalTelnyxCallFact,
  legKind: "AGENT" | "CUSTOMER",
) {
  if (legKind === "AGENT") return call;

  const identity = customerPhones(fact, call.direction);
  return {
    ...call,
    callerName: call.callerName || fact.callerName,
    fromPhone:
      call.fromPhone ||
      (call.direction === "INBOUND" ? identity.callerPhone : identity.practicePhone),
    receivedAt: earliestObservedAt(call.receivedAt, fact.occurredAt),
    toPhone:
      call.toPhone ||
      (call.direction === "INBOUND" ? identity.practicePhone : identity.callerPhone),
  };
}

async function resolveCustomerCall(
  tx: Transaction,
  fact: ResolvedCanonicalTelnyxCallFact,
) {
  if (!fact.providerCallSessionId) {
    throw new CanonicalProjectionError("CANONICAL_CALL_SESSION_MISSING");
  }

  const existing = await tx.callCenterCall.findUnique({
    where: { providerCallSessionId: fact.providerCallSessionId },
  });
  if (existing) return existing;

  if (!fact.direction) throw new CanonicalProjectionError("CANONICAL_DIRECTION_MISSING");
  const { callerPhone, practicePhone } = customerPhones(fact, fact.direction);
  if (!practicePhone) {
    throw new CanonicalProjectionError("CANONICAL_PRACTICE_PHONE_MISSING");
  }

  const numbers = await tx.callCenterNumber.findMany({
    include: { inboundQueue: { select: { enabled: true, practiceId: true } } },
    orderBy: { id: "asc" },
    take: 2,
    where: {
      enabled: true,
      ...(fact.direction === "INBOUND"
        ? { inboundEnabled: true }
        : { outboundEnabled: true }),
      practicePhoneNumber: {
        phoneNumber: { in: phoneLookupVariants(practicePhone) },
      },
    },
  });

  if (numbers.length === 0) {
    throw new CanonicalProjectionError("CANONICAL_NUMBER_NOT_FOUND");
  }
  if (numbers.length > 1) {
    throw new CanonicalProjectionError("CANONICAL_NUMBER_AMBIGUOUS");
  }

  const number = numbers[0];
  if (
    fact.direction === "INBOUND" &&
    (!number.inboundQueueId ||
      !number.inboundQueue?.enabled ||
      number.inboundQueue.practiceId !== number.practiceId)
  ) {
    throw new CanonicalProjectionError("CANONICAL_QUEUE_NOT_CONFIGURED");
  }

  return tx.callCenterCall.create({
    data: {
      callerName: fact.callerName,
      direction: fact.direction,
      fromPhone: fact.direction === "INBOUND" ? callerPhone : practicePhone,
      numberId: number.id,
      practiceId: number.practiceId,
      providerCallSessionId: fact.providerCallSessionId,
      queueId: fact.direction === "INBOUND" ? number.inboundQueueId : null,
      receivedAt: fact.occurredAt,
      status: "RECEIVED",
      toPhone: fact.direction === "INBOUND" ? practicePhone : callerPhone,
    },
  });
}

async function lockCall(tx: Transaction, callId: string) {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "id" = ${callId} FOR UPDATE`,
  );
  const { queue, ...call } = await tx.callCenterCall.findUniqueOrThrow({
    include: { queue: { select: { routingMode: true } } },
    where: { id: callId },
  });
  return { call, routingMode: queue?.routingMode ?? null };
}

function callObservation(
  fact: ResolvedCanonicalTelnyxCallFact,
  currentStatus: Parameters<typeof terminalCallObservation>[0],
) {
  return fact.callObservation === "HANGUP"
    ? terminalCallObservation(currentStatus)
    : fact.callObservation;
}

export const prismaCanonicalCallProjector: CanonicalCallProjector = {
  async projectAndComplete(event, fact, projectedAt) {
    return prisma.$transaction(async (tx) => {
      let leg = await existingLeg(tx, fact);
      const legKind = resolveCanonicalTelnyxLegKind(leg?.kind ?? null, fact.legKind);
      const observations = resolveCanonicalTelnyxCallObservations(
        fact.eventType,
        legKind,
        fact.direction,
      );
      if (!observations) {
        throw new CanonicalProjectionError("CANONICAL_EVENT_UNSUPPORTED");
      }
      const resolvedFact: ResolvedCanonicalTelnyxCallFact = {
        ...fact,
        ...observations,
        legKind,
      };
      const resolved = leg
        ? { call: leg.call, endpointId: leg.endpointId }
        : resolvedFact.legKind === "AGENT"
          ? await resolveAgentContext(tx, resolvedFact)
          : { call: await resolveCustomerCall(tx, resolvedFact), endpointId: null };
      const locked = await lockCall(tx, resolved.call.id);
      let call = locked.call;

      if (call.practiceId !== resolved.call.practiceId) {
        throw new CanonicalProjectionError("CANONICAL_CALL_OWNER_MISMATCH");
      }
      if (!leg) {
        leg = await tx.callCenterCallLeg.create({
          data: {
            callId: call.id,
            endpointId: resolved.endpointId,
            kind: resolvedFact.legKind,
            providerCallControlId: resolvedFact.providerCallControlId,
            providerCallLegId: resolvedFact.providerCallLegId,
            providerCallSessionId: resolvedFact.providerCallSessionId,
            startedAt: resolvedFact.occurredAt,
            status: "CREATED",
          },
          include: { call: true },
        });
      }

      const nextLeg = advanceCanonicalLeg(
        leg,
        resolvedFact.legObservation,
        resolvedFact.occurredAt,
      );
      leg = await tx.callCenterCallLeg.update({
        data: {
          answeredAt: nextLeg.answeredAt,
          bridgedAt: nextLeg.bridgedAt,
          endedAt: nextLeg.endedAt,
          endpointId: leg.endpointId ?? resolved.endpointId,
          hangupCauseCode: resolvedFact.hangupCauseCode ?? leg.hangupCauseCode,
          providerCallControlId:
            leg.providerCallControlId ?? resolvedFact.providerCallControlId,
          providerCallLegId: leg.providerCallLegId ?? resolvedFact.providerCallLegId,
          providerCallSessionId:
            leg.providerCallSessionId ?? resolvedFact.providerCallSessionId,
          startedAt: earliestObservedAt(leg.startedAt, resolvedFact.occurredAt),
          status: nextLeg.status,
        },
        include: { call: true },
        where: { id: leg.id },
      });

      const bridgedLegs = await tx.callCenterCallLeg.findMany({
        select: { bridgedAt: true, id: true, kind: true },
        where: { bridgedAt: { not: null }, callId: call.id },
      });
      const winningLegId = selectWinningAgentLeg(
        bridgedLegs.filter((candidate) => candidate.kind === "AGENT"),
      );
      const hasBridgeEvidence = bridgedLegs.length > 0;
      const observedCall = callObservation(resolvedFact, call.status);
      const nextCall = observedCall
        ? advanceCanonicalCall(call, observedCall, resolvedFact.occurredAt, {
            hasBridgeEvidence,
          })
        : reconcileCanonicalCallOutcome(call, {
            hasBridgeEvidence,
          });
      const identity = enrichCanonicalCallIdentity(
        call,
        resolvedFact,
        resolvedFact.legKind,
      );
      const callProjectionChanged =
        nextCall !== call ||
        winningLegId !== call.winningLegId ||
        identity.callerName !== call.callerName ||
        identity.fromPhone !== call.fromPhone ||
        identity.toPhone !== call.toPhone ||
        identity.receivedAt.getTime() !== call.receivedAt.getTime();

      call = await tx.callCenterCall.update({
        data: {
          answeredAt: nextCall.answeredAt,
          callerName: identity.callerName,
          endedAt: nextCall.endedAt,
          firstRingAt: nextCall.firstRingAt,
          fromPhone: identity.fromPhone,
          queuedAt: nextCall.queuedAt,
          receivedAt: identity.receivedAt,
          stateVersion:
            callProjectionChanged && nextCall.stateVersion === call.stateVersion
              ? call.stateVersion + 1
              : nextCall.stateVersion,
          status: nextCall.status,
          toPhone: identity.toPhone,
          voicemailStartedAt: nextCall.voicemailStartedAt,
          winningLegId,
        },
        where: { id: call.id },
      });

      await tx.callCenterEvent.create({
        data: {
          aggregateId: call.id,
          aggregateType: "CALL",
          data: {
            callStatus: call.status,
            legId: leg.id,
            legStatus: leg.status,
            providerEventId: event.providerEventId,
          },
          idempotencyKey: `telnyx:${event.providerEventId}`,
          occurredAt: resolvedFact.occurredAt,
          practiceId: call.practiceId,
          type: resolvedFact.eventType.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
        },
      });

      const completed = await tx.providerWebhookEvent.updateMany({
        data: {
          canonicalProjectedAt: projectedAt,
          canonicalProjectionErrorCode: null,
          canonicalProjectionNextAttemptAt: null,
          canonicalProjectionStatus: "PROCESSED",
        },
        where: {
          canonicalProjectionAttemptCount: event.canonicalProjectionAttemptCount,
          canonicalProjectionStatus: "PROCESSING",
          id: event.id,
        },
      });
      if (completed.count !== 1) {
        throw new CanonicalProjectionError("CANONICAL_CLAIM_LOST");
      }

      return {
        callId: call.id,
        callStatus: call.status,
        legId: leg.id,
        legStatus: leg.status,
        practiceId: call.practiceId,
        routingMode: locked.routingMode,
      };
    });
  },
};
