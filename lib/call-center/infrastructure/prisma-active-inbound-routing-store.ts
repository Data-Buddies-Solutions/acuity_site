import { Prisma } from "@/generated/prisma/client";
import {
  ACTIVE_INBOUND_ROUTING_EVENT,
  ActiveRoutingError,
  routeActiveInboundCall,
  type ActiveRoutingContext,
  type ActiveRoutingDecisionEvent,
  type ActiveRoutingDial,
  type ActiveRoutingEventData,
  type ActiveRoutingPrerequisite,
  type ActiveRoutingStore,
  type ActiveRoutingTransaction,
} from "@/lib/call-center/application/active-inbound-routing";
import type { RoutingDecision } from "@/lib/call-center/domain/routing-decision";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
export type ActiveRoutingTransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

const routingEventSelect = {
  data: true,
  occurredAt: true,
  revision: true,
} satisfies Prisma.CallCenterEventSelect;

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + Math.max(0, seconds) * 1_000);
}

function toRoutingEvent(event: {
  data: Prisma.JsonValue;
  occurredAt: Date;
  revision: bigint;
}): ActiveRoutingDecisionEvent {
  return event;
}

class PrismaActiveRoutingTransaction implements ActiveRoutingTransaction {
  constructor(private readonly transaction: Transaction) {}

  async findRouting(practiceId: string, callId: string) {
    const event = await this.transaction.callCenterEvent.findUnique({
      select: routingEventSelect,
      where: {
        practiceId_type_idempotencyKey: {
          idempotencyKey: callId,
          practiceId,
          type: ACTIVE_INBOUND_ROUTING_EVENT,
        },
      },
    });
    return event ? toRoutingEvent(event) : null;
  }

  async loadContext(practiceId: string, callId: string) {
    const call = await this.transaction.callCenterCall.findFirst({
      select: {
        direction: true,
        effectOwner: true,
        id: true,
        practiceId: true,
        queueId: true,
        status: true,
      },
      where: { id: callId, practiceId },
    });
    if (!call) return null;
    if (!call.queueId) return { ...call, callId: call.id, queue: null };

    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_queue" WHERE "practiceId" = ${practiceId} AND "id" = ${call.queueId} FOR UPDATE`,
    );
    const queue = await this.transaction.callCenterQueue.findFirst({
      select: {
        enabled: true,
        id: true,
        locations: { select: { locationId: true } },
        maxWaitSec: true,
        members: {
          select: { enabled: true, userId: true },
          where: { role: "AGENT" },
        },
        ringTimeoutSec: true,
      },
      where: { id: call.queueId, practiceId },
    });
    if (!queue) return { ...call, callId: call.id, queue: null };

    const userIds = queue.members.map(({ userId }) => userId);
    const sessions =
      userIds.length === 0
        ? []
        : await this.transaction.callCenterAgentSession.findMany({
            select: {
              audioReady: true,
              connectionState: true,
              currentCallId: true,
              offeredCallId: true,
              endpoint: {
                select: {
                  enabled: true,
                  id: true,
                  locationId: true,
                  providerCredentialId: true,
                  sipUsername: true,
                  userId: true,
                },
              },
              id: true,
              leaseExpiresAt: true,
              microphoneReady: true,
              presence: true,
              stateVersion: true,
              userId: true,
            },
            where: {
              connectionState: { not: "CLOSED" },
              practiceId,
              userId: { in: userIds },
            },
          });

    return {
      callId: call.id,
      direction: call.direction,
      effectOwner: call.effectOwner,
      practiceId: call.practiceId,
      queue: {
        enabled: queue.enabled,
        id: queue.id,
        locationIds: queue.locations.map(({ locationId }) => locationId),
        maxWaitSec: queue.maxWaitSec,
        members: queue.members.map((member) => ({
          enabled: member.enabled,
          sessions: sessions
            .filter(
              (session) =>
                session.userId === member.userId &&
                session.endpoint.userId === member.userId,
            )
            .map((session) => ({
              audioReady: session.audioReady,
              connectionState: session.connectionState,
              currentCallId: session.currentCallId,
              offeredCallId: session.offeredCallId,
              endpoint: {
                configured: Boolean(
                  session.endpoint.providerCredentialId && session.endpoint.sipUsername,
                ),
                enabled: session.endpoint.enabled,
                id: session.endpoint.id,
                locationId: session.endpoint.locationId,
              },
              id: session.id,
              leaseExpiresAt: session.leaseExpiresAt,
              microphoneReady: session.microphoneReady,
              presence: session.presence,
              stateVersion: session.stateVersion,
            })),
          userId: member.userId,
        })),
        ringTimeoutSec: queue.ringTimeoutSec,
      },
      status: call.status,
    } satisfies ActiveRoutingContext;
  }

  async startRouting(
    context: ActiveRoutingContext & {
      queue: NonNullable<ActiveRoutingContext["queue"]>;
    },
    decision: RoutingDecision,
    prerequisite: ActiveRoutingPrerequisite | undefined,
    routingKey: string,
    now: Date,
  ) {
    const call = await this.transaction.callCenterCall.findFirst({
      select: {
        deadlineAt: true,
        queuedAt: true,
        queueDeadlineAt: true,
        stateVersion: true,
      },
      where: {
        direction: "INBOUND",
        effectOwner: "CANONICAL",
        id: context.callId,
        practiceId: context.practiceId,
        queueId: context.queue.id,
        status: { in: ["RECEIVED", "QUEUED", "RINGING"] },
      },
    });
    if (!call) throw new ActiveRoutingError("Call changed before routing", 409);

    let answerCommandId: string;
    let startRingbackCommandId: string;
    let createdPrerequisiteCommandIds: string[] = [];
    if (prerequisite) {
      const commands = await this.transaction.callCenterCommand.findMany({
        select: {
          callId: true,
          dependsOnCommandId: true,
          id: true,
          practiceId: true,
          status: true,
          type: true,
        },
        where: {
          id: {
            in: [prerequisite.answerCommandId, prerequisite.startRingbackCommandId],
          },
        },
      });
      const answer = commands.find(
        (command) =>
          command.id === prerequisite.answerCommandId &&
          command.type === "ANSWER_CUSTOMER",
      );
      const ringback = commands.find(
        (command) =>
          command.id === prerequisite.startRingbackCommandId &&
          command.type === "START_RINGBACK",
      );
      if (
        !answer ||
        !ringback ||
        answer.callId !== context.callId ||
        answer.practiceId !== context.practiceId ||
        ringback.callId !== context.callId ||
        ringback.practiceId !== context.practiceId ||
        ringback.dependsOnCommandId !== answer.id ||
        ringback.status === "FAILED"
      ) {
        throw new ActiveRoutingError("Routing prerequisite is unavailable", 409);
      }
      answerCommandId = answer.id;
      startRingbackCommandId = ringback.id;
    } else {
      const customerLegs = await this.transaction.callCenterCallLeg.findMany({
        orderBy: { startedAt: "asc" },
        select: { id: true },
        take: 2,
        where: {
          callId: context.callId,
          kind: "CUSTOMER",
          providerCallControlId: { not: null },
          status: { notIn: ["ENDED", "FAILED"] },
        },
      });
      if (customerLegs.length !== 1) {
        throw new ActiveRoutingError("Canonical customer leg is unavailable", 409);
      }
      const customerLegId = customerLegs[0]!.id;
      const answer = await this.transaction.callCenterCommand.create({
        data: {
          arguments: {},
          callId: context.callId,
          idempotencyKey: `route:${routingKey}:answer`,
          legId: customerLegId,
          practiceId: context.practiceId,
          type: "ANSWER_CUSTOMER",
        },
        select: { id: true },
      });
      const ringback = await this.transaction.callCenterCommand.create({
        data: {
          arguments: { timeoutSeconds: context.queue.ringTimeoutSec },
          callId: context.callId,
          dependsOnCommandId: answer.id,
          idempotencyKey: `route:${routingKey}:ringback`,
          legId: customerLegId,
          practiceId: context.practiceId,
          type: "START_RINGBACK",
        },
        select: { id: true },
      });
      answerCommandId = answer.id;
      startRingbackCommandId = ringback.id;
      createdPrerequisiteCommandIds = [answer.id, ringback.id];
    }

    const sessions = new Map(
      context.queue.members.flatMap((member) =>
        member.sessions.map((session) => [
          session.id,
          { ...session, userId: member.userId },
        ]),
      ),
    );
    const routed: ActiveRoutingDial[] = [];
    const priorAttempts = await this.transaction.callCenterCallLeg.count({
      where: { callId: context.callId, kind: "AGENT" },
    });

    for (const selection of decision.eligible) {
      const session = sessions.get(selection.agentSessionId);
      if (!session || session.endpoint.id !== selection.endpointId) continue;

      const reserved = await this.transaction.callCenterAgentSession.updateMany({
        data: {
          offeredCallId: context.callId,
          readyAt: null,
          stateVersion: { increment: 1 },
        },
        where: {
          audioReady: true,
          connectionState: "READY",
          currentCallId: null,
          offeredCallId: null,
          endpoint: {
            enabled: true,
            id: selection.endpointId,
            locationId: session.endpoint.locationId,
            providerCredentialId: { not: null },
            sipUsername: { not: null },
            userId: selection.userId,
          },
          endpointId: selection.endpointId,
          id: selection.agentSessionId,
          leaseExpiresAt: { gt: now },
          microphoneReady: true,
          practiceId: context.practiceId,
          presence: "AVAILABLE",
          stateVersion: session.stateVersion,
          userId: selection.userId,
        },
      });
      if (reserved.count !== 1) continue;

      const leg = await this.transaction.callCenterCallLeg.create({
        data: {
          agentSessionId: selection.agentSessionId,
          attemptNumber: priorAttempts + routed.length + 1,
          callId: context.callId,
          endpointId: selection.endpointId,
          kind: "AGENT",
          startedAt: now,
          status: "CREATED",
        },
        select: { id: true },
      });
      const command = await this.transaction.callCenterCommand.create({
        data: {
          arguments: {
            agentSessionId: selection.agentSessionId,
            endpointId: selection.endpointId,
          },
          callId: context.callId,
          dependsOnCommandId: startRingbackCommandId,
          idempotencyKey: `route:${routingKey}:dial:${selection.agentSessionId}`,
          legId: leg.id,
          practiceId: context.practiceId,
          type: "DIAL_AGENT",
        },
        select: { id: true },
      });
      await this.transaction.callCenterEvent.create({
        data: {
          aggregateId: selection.agentSessionId,
          aggregateType: "AGENT_SESSION",
          data: {
            callId: context.callId,
            presence: "AVAILABLE",
            stateVersion: session.stateVersion + 1,
          },
          idempotencyKey: `route:${routingKey}:offer:${selection.agentSessionId}`,
          occurredAt: now,
          practiceId: context.practiceId,
          type: "AGENT_SESSION_CALL_OFFERED",
        },
      });
      routed.push({ ...selection, commandId: command.id, legId: leg.id });
    }

    const queueDeadlineAt =
      call.queueDeadlineAt ?? addSeconds(now, context.queue.maxWaitSec);
    const ringDeadlineAt = addSeconds(now, context.queue.ringTimeoutSec);
    const deadlineAt =
      ringDeadlineAt <= queueDeadlineAt ? ringDeadlineAt : queueDeadlineAt;
    const updatedCall = await this.transaction.callCenterCall.update({
      data: {
        deadlineAt,
        queueDeadlineAt,
        queuedAt: call.queuedAt ?? now,
        stateVersion: { increment: 1 },
        status: "QUEUED",
      },
      select: { stateVersion: true },
      where: { id: context.callId },
    });

    const data: ActiveRoutingEventData = {
      ...decision,
      answerCommandId,
      commandIds: [
        ...createdPrerequisiteCommandIds,
        ...routed.map(({ commandId }) => commandId),
      ],
      deadlineAt: deadlineAt.toISOString(),
      dialCommandIds: routed.map(({ commandId }) => commandId),
      queueDeadlineAt: queueDeadlineAt.toISOString(),
      routed,
      startRingbackCommandId,
      stateVersion: updatedCall.stateVersion,
    };
    const event = await this.transaction.callCenterEvent.create({
      data: {
        aggregateId: context.callId,
        aggregateType: "CALL",
        data,
        idempotencyKey: routingKey,
        occurredAt: now,
        practiceId: context.practiceId,
        type: ACTIVE_INBOUND_ROUTING_EVENT,
      },
      select: routingEventSelect,
    });
    return toRoutingEvent(event);
  }
}

export class PrismaActiveInboundRoutingStore implements ActiveRoutingStore {
  constructor(
    private readonly runTransaction: ActiveRoutingTransactionRunner = (operation) =>
      prisma.$transaction(operation),
  ) {}

  withCallLock<T>(
    practiceId: string,
    callId: string,
    work: (transaction: ActiveRoutingTransaction) => Promise<T>,
  ) {
    return this.runTransaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "practiceId" = ${practiceId} AND "id" = ${callId} FOR UPDATE`,
      );
      return work(new PrismaActiveRoutingTransaction(transaction));
    });
  }
}

export const prismaActiveInboundRoutingStore = new PrismaActiveInboundRoutingStore();

/** Reuses the planner inside a caller-owned Prisma transaction. */
export function routeActiveInboundCallInTransaction(
  transaction: Transaction,
  input: {
    callId: string;
    practiceId: string;
    prerequisite?: ActiveRoutingPrerequisite;
    routingKey?: string;
  },
  now: Date,
) {
  return routeActiveInboundCall(
    {
      withCallLock: async (_practiceId, _callId, work) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "practiceId" = ${input.practiceId} AND "id" = ${input.callId} FOR UPDATE`,
        );
        return work(new PrismaActiveRoutingTransaction(transaction));
      },
    },
    input,
    now,
  );
}
