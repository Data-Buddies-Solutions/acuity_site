import { Prisma } from "@/generated/prisma/client";
import { settleCanonicalCallLegs } from "@/lib/call-center/infrastructure/prisma-call-resource-settlement";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
export type OutboundRecoveryTransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

type DueCall = { callId: string; practiceId: string };
type SettleAgentLegs = typeof settleCanonicalCallLegs;

export class PrismaOutboundInitiationRecovery {
  constructor(
    private readonly runTransaction: OutboundRecoveryTransactionRunner = (operation) =>
      prisma.$transaction(operation),
    private readonly settleAgentLegs: SettleAgentLegs = settleCanonicalCallLegs,
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
            AND call."status" IN (
              CAST('RECEIVED' AS "CallCenterCallStatus"),
              CAST('RINGING' AS "CallCenterCallStatus")
            )
            AND call."deadlineAt" <= ${now}
          ORDER BY call."deadlineAt" ASC, call."id" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);
        if (!due) return null;

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
            status: { in: ["RECEIVED", "RINGING"] },
          },
        });
        if (failed.count !== 1) return null;

        await this.settleAgentLegs(transaction, {
          callId: due.callId,
          now,
          reason: "OUTBOUND_DIAL_TIMEOUT",
          terminalLegStatus: "FAILED",
        });
        await transaction.callCenterEvent.create({
          data: {
            aggregateId: due.callId,
            aggregateType: "CALL",
            data: { errorCode: "OUTBOUND_DIAL_TIMEOUT" },
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
