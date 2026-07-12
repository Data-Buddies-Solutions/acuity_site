import { Prisma } from "@/generated/prisma/client";
import type {
  ShadowRoutingContext,
  ShadowRoutingDecisionEvent,
  ShadowRoutingStore,
  ShadowRoutingTransaction,
} from "@/lib/call-center/application/shadow-routing";
import type { RoutingDecision } from "@/lib/call-center/domain/routing-decision";
import { prisma } from "@/lib/prisma";

export type ShadowRoutingPrismaTransaction = Prisma.TransactionClient;
export type ShadowRoutingTransactionRunner = <T>(
  operation: (transaction: ShadowRoutingPrismaTransaction) => Promise<T>,
) => Promise<T>;

const decisionEventSelect = {
  data: true,
  occurredAt: true,
  revision: true,
} satisfies Prisma.CallCenterEventSelect;

function toDecisionEvent(event: {
  data: Prisma.JsonValue;
  occurredAt: Date;
  revision: bigint;
}): ShadowRoutingDecisionEvent {
  return event;
}

class PrismaShadowRoutingTransaction implements ShadowRoutingTransaction {
  constructor(private readonly transaction: ShadowRoutingPrismaTransaction) {}

  async appendDecision(
    context: ShadowRoutingContext,
    decision: RoutingDecision,
    now: Date,
  ) {
    const event = await this.transaction.callCenterEvent.create({
      data: {
        aggregateId: context.callId,
        aggregateType: "CALL",
        data: decision,
        idempotencyKey: context.callId,
        occurredAt: now,
        practiceId: context.practiceId,
        type: "CALL_ROUTING_SHADOW_DECIDED",
      },
      select: decisionEventSelect,
    });
    return toDecisionEvent(event);
  }

  async findDecision(practiceId: string, callId: string) {
    const event = await this.transaction.callCenterEvent.findUnique({
      select: decisionEventSelect,
      where: {
        practiceId_type_idempotencyKey: {
          idempotencyKey: callId,
          practiceId,
          type: "CALL_ROUTING_SHADOW_DECIDED",
        },
      },
    });
    return event ? toDecisionEvent(event) : null;
  }

  async loadContext(practiceId: string, callId: string) {
    const call = await this.transaction.callCenterCall.findFirst({
      select: {
        direction: true,
        id: true,
        practiceId: true,
        queue: {
          select: {
            enabled: true,
            id: true,
            locations: { select: { locationId: true } },
            members: { select: { enabled: true, userId: true } },
            routingMode: true,
          },
        },
      },
      where: { id: callId, practiceId },
    });
    if (!call) return null;
    if (!call.queue) return { ...call, callId: call.id, queue: null };

    const userIds = call.queue.members.map(({ userId }) => userId);
    const sessions =
      userIds.length === 0
        ? []
        : await this.transaction.callCenterAgentSession.findMany({
            select: {
              audioReady: true,
              connectionState: true,
              currentCallId: true,
              endpoint: {
                select: {
                  enabled: true,
                  id: true,
                  locationId: true,
                  providerCredentialId: true,
                  sipUsername: true,
                },
              },
              id: true,
              leaseExpiresAt: true,
              microphoneReady: true,
              presence: true,
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
      practiceId: call.practiceId,
      queue: {
        enabled: call.queue.enabled,
        id: call.queue.id,
        locationIds: call.queue.locations.map(({ locationId }) => locationId),
        members: call.queue.members.map((member) => ({
          enabled: member.enabled,
          sessions: sessions
            .filter((session) => session.userId === member.userId)
            .map((session) => ({
              audioReady: session.audioReady,
              connectionState: session.connectionState,
              currentCallId: session.currentCallId,
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
            })),
          userId: member.userId,
        })),
        routingMode: call.queue.routingMode,
      },
    } satisfies ShadowRoutingContext;
  }
}

export class PrismaShadowRoutingStore implements ShadowRoutingStore {
  constructor(
    private readonly runTransaction: ShadowRoutingTransactionRunner = (operation) =>
      prisma.$transaction(operation),
  ) {}

  withCallLock<T>(
    practiceId: string,
    callId: string,
    work: (transaction: ShadowRoutingTransaction) => Promise<T>,
  ) {
    return this.runTransaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "practiceId" = ${practiceId} AND "id" = ${callId} FOR UPDATE`,
      );
      return work(new PrismaShadowRoutingTransaction(transaction));
    });
  }
}

export const prismaShadowRoutingStore = new PrismaShadowRoutingStore();
