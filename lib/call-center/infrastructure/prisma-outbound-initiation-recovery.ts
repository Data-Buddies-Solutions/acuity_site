import { Prisma } from "@/generated/prisma/client";
import { releaseAgentSessionReservation } from "@/lib/call-center/infrastructure/prisma-agent-session-reservation";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
export type OutboundRecoveryTransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

type DueCall = { callId: string; practiceId: string };

export class PrismaOutboundInitiationRecovery {
  constructor(
    private readonly runTransaction: OutboundRecoveryTransactionRunner = (operation) =>
      prisma.$transaction(operation),
  ) {}

  async recoverDue(now: Date, limit: number) {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const callIds: string[] = [];
    while (callIds.length < boundedLimit) {
      const callId = await this.runTransaction(async (transaction) => {
        const [due] = await transaction.$queryRaw<DueCall[]>(Prisma.sql`
          SELECT call."id" AS "callId", call."practiceId"
          FROM "call_center_call" AS call
          WHERE call."direction" = CAST('OUTBOUND' AS "CallCenterCallDirection")
            AND call."effectOwner" = CAST('CANONICAL' AS "CallCenterEffectOwner")
            AND call."status" = CAST('RECEIVED' AS "CallCenterCallStatus")
            AND call."deadlineAt" <= ${now}
          ORDER BY call."deadlineAt" ASC, call."id" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);
        if (!due) return null;

        const legs = await transaction.callCenterCallLeg.findMany({
          select: { agentSessionId: true, id: true },
          where: {
            callId: due.callId,
            kind: "AGENT",
            status: { in: ["CREATED", "DIALING", "RINGING", "ANSWERED"] },
          },
        });
        const failed = await transaction.callCenterCall.updateMany({
          data: {
            deadlineAt: null,
            endedAt: now,
            stateVersion: { increment: 1 },
            status: "FAILED",
          },
          where: {
            deadlineAt: { lte: now },
            direction: "OUTBOUND",
            effectOwner: "CANONICAL",
            id: due.callId,
            status: "RECEIVED",
          },
        });
        if (failed.count !== 1) return null;

        await transaction.callCenterCallLeg.updateMany({
          data: {
            endedAt: now,
            errorCode: "OUTBOUND_INITIATION_TIMEOUT",
            status: "FAILED",
          },
          where: {
            id: { in: legs.map(({ id }) => id) },
            status: { in: ["CREATED", "DIALING", "RINGING", "ANSWERED"] },
          },
        });
        for (const sessionId of new Set(
          legs
            .map(({ agentSessionId }) => agentSessionId)
            .filter((id): id is string => Boolean(id)),
        )) {
          await releaseAgentSessionReservation(transaction, {
            agentSessionId: sessionId,
            callId: due.callId,
            idempotencyKey: `outbound-timeout:${due.callId}:${sessionId}`,
            now,
            reason: "OUTBOUND_INITIATION_TIMEOUT",
          });
        }
        await transaction.callCenterEvent.create({
          data: {
            aggregateId: due.callId,
            aggregateType: "CALL",
            data: { errorCode: "OUTBOUND_INITIATION_TIMEOUT" },
            idempotencyKey: `outbound-timeout:${due.callId}`,
            occurredAt: now,
            practiceId: due.practiceId,
            type: "CALL_OUTBOUND_INITIATION_FAILED",
          },
        });
        return due.callId;
      });
      if (!callId) break;
      callIds.push(callId);
    }
    return { callIds, recovered: callIds.length };
  }
}

export const prismaOutboundInitiationRecovery = new PrismaOutboundInitiationRecovery();
