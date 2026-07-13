import { Prisma } from "@/generated/prisma/client";
import type {
  ShadowRoutingContext,
  ShadowRoutingDecisionEvent,
  ShadowRoutingSource,
  ShadowRoutingStore,
  ShadowRoutingTransaction,
} from "@/lib/call-center/application/shadow-routing";
import type {
  ShadowRoutingRecoveryCandidate,
  ShadowRoutingRecoveryStore,
} from "@/lib/call-center/application/recover-shadow-routing";
import type { RoutingDecision } from "@/lib/call-center/domain/routing-decision";
import { prisma } from "@/lib/prisma";

export type ShadowRoutingPrismaTransaction = Prisma.TransactionClient;
export type ShadowRoutingTransactionRunner = <T>(
  operation: (transaction: ShadowRoutingPrismaTransaction) => Promise<T>,
) => Promise<T>;
export type ShadowRoutingPrismaClient = Pick<typeof prisma, "$queryRaw">;

const decisionEventSelect = {
  data: true,
  occurredAt: true,
  revision: true,
} satisfies Prisma.CallCenterEventSelect;

const missingDecisionWhere = Prisma.sql`
  WHERE call."direction" = CAST('INBOUND' AS "CallCenterCallDirection")
    AND call."status" IN (
      CAST('RECEIVED' AS "CallCenterCallStatus"),
      CAST('QUEUED' AS "CallCenterCallStatus"),
      CAST('RINGING' AS "CallCenterCallStatus"),
      CAST('CONNECTED' AS "CallCenterCallStatus"),
      CAST('WRAP_UP' AS "CallCenterCallStatus")
    )
    AND queue."routingMode" = CAST('SHADOW' AS "CallCenterRoutingMode")
    AND NOT EXISTS (
      SELECT 1
      FROM "call_center_event" AS event
      WHERE event."practiceId" = call."practiceId"
        AND event."type" = 'CALL_ROUTING_SHADOW_DECIDED'
        AND event."idempotencyKey" = call."id"
    )
`;

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
    decision: RoutingDecision & { source: ShadowRoutingSource },
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
        status: true,
        queue: {
          select: {
            enabled: true,
            id: true,
            locations: { select: { locationId: true } },
            members: {
              select: { enabled: true, userId: true },
              where: { role: "AGENT" },
            },
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
              offeredCallId: true,
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
            })),
          userId: member.userId,
        })),
        routingMode: call.queue.routingMode,
      },
      status: call.status,
    } satisfies ShadowRoutingContext;
  }
}

export class PrismaShadowRoutingStore
  implements ShadowRoutingStore, ShadowRoutingRecoveryStore
{
  constructor(
    private readonly runTransaction: ShadowRoutingTransactionRunner = (operation) =>
      prisma.$transaction(operation),
    private readonly client: ShadowRoutingPrismaClient = prisma,
  ) {}

  async countMissingDecisions() {
    const [result] = await this.client.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*) AS "count"
        FROM "call_center_call" AS call
        INNER JOIN "call_center_queue" AS queue
          ON queue."id" = call."queueId"
          AND queue."practiceId" = call."practiceId"
        ${missingDecisionWhere}
      `,
    );
    return Number(result?.count ?? 0);
  }

  listMissingDecisions(limit: number) {
    return this.client.$queryRaw<ShadowRoutingRecoveryCandidate[]>(
      Prisma.sql`
        SELECT call."id" AS "callId", call."practiceId"
        FROM "call_center_call" AS call
        INNER JOIN "call_center_queue" AS queue
          ON queue."id" = call."queueId"
          AND queue."practiceId" = call."practiceId"
        ${missingDecisionWhere}
        ORDER BY call."receivedAt" ASC, call."id" ASC
        LIMIT ${limit}
      `,
    );
  }

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
