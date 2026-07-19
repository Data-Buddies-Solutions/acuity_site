import { Prisma } from "@/generated/prisma/client";
import type {
  FailedBrowserOfferRecoveryContext,
  FailedBrowserOfferRecoveryInput,
  FailedBrowserOfferRecoveryStore,
  FailedBrowserOfferRecoveryTransaction,
} from "@/lib/call-center/application/replace-failed-browser-offer";
import type {
  OperationReceiptData,
  OperationReceiptInput,
} from "@/lib/call-center/application/operation-receipts";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { resolveQueueAccess } from "@/lib/call-center/auth/queue-access";
import { normalizeCanonicalCallStatus } from "@/lib/call-center/domain/canonical-call-state";
import { lockCallCenterPractice } from "@/lib/call-center/infrastructure/prisma-call-center-practice-lock";
import { PrismaOperationReceiptTransaction } from "@/lib/call-center/infrastructure/prisma-operation-receipts";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
export type FailedBrowserOfferRecoveryTransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

export class PrismaFailedBrowserOfferRecoveryTransaction implements FailedBrowserOfferRecoveryTransaction {
  private readonly receipts: PrismaOperationReceiptTransaction;

  constructor(private readonly transaction: Transaction) {
    this.receipts = new PrismaOperationReceiptTransaction(transaction);
  }

  appendReceipt(input: OperationReceiptInput, data: OperationReceiptData, now: Date) {
    return this.receipts.appendReceipt(input, data, now);
  }

  findReceipt(practiceId: string, type: string, idempotencyKey: string) {
    return this.receipts.findReceipt(practiceId, type, idempotencyKey);
  }

  lockReceiptKey(practiceId: string, type: string, idempotencyKey: string) {
    return this.receipts.lockReceiptKey(practiceId, type, idempotencyKey);
  }

  async loadContext(
    actor: QueueAccessActor,
    input: FailedBrowserOfferRecoveryInput,
  ): Promise<FailedBrowserOfferRecoveryContext | null> {
    await lockCallCenterPractice(this.transaction, actor.practiceId);
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "practiceId" = ${actor.practiceId} AND "id" = ${input.callId} FOR UPDATE`,
    );
    const call = await this.transaction.callCenterCall.findFirst({
      select: {
        deadlineAt: true,
        direction: true,
        id: true,
        practiceId: true,
        queueId: true,
        status: true,
        voicemailStartedAt: true,
        winningLegId: true,
      },
      where: { id: input.callId, practiceId: actor.practiceId },
    });
    if (!call?.queueId) return null;
    await resolveQueueAccess(actor, call.queueId, this.transaction);
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_queue" WHERE "practiceId" = ${actor.practiceId} AND "id" = ${call.queueId} FOR UPDATE`,
    );
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_call_leg" WHERE "callId" = ${call.id} AND "id" = ${input.callLegId} FOR UPDATE`,
    );
    const leg = await this.transaction.callCenterCallLeg.findFirst({
      include: {
        agentSession: {
          select: {
            browserSessionId: true,
            endpointId: true,
            id: true,
            leaseExpiresAt: true,
            userId: true,
          },
        },
      },
      where: {
        callId: call.id,
        id: input.callLegId,
      },
    });
    if (!leg?.agentSession) return null;
    const newerLeg = await this.transaction.callCenterCallLeg.findFirst({
      select: { id: true },
      where: {
        agentSessionId: leg.agentSessionId,
        attemptNumber: { gt: leg.attemptNumber },
        callId: call.id,
        endpointId: leg.endpointId,
        kind: "AGENT",
      },
    });

    return {
      call: {
        ...call,
        status: normalizeCanonicalCallStatus(call.status),
      },
      leg: {
        agentSessionId: leg.agentSessionId,
        attemptNumber: leg.attemptNumber,
        endpointId: leg.endpointId,
        id: leg.id,
        isCurrent: !newerLeg,
        kind: leg.kind,
        providerCallControlId: leg.providerCallControlId,
        status: leg.status,
      },
      session: leg.agentSession,
    };
  }

  async createReplacement(
    context: FailedBrowserOfferRecoveryContext,
    input: FailedBrowserOfferRecoveryInput,
    now: Date,
  ) {
    const failed = await this.transaction.callCenterCallLeg.updateMany({
      data: {
        errorCode: input.reason,
        status: "FAILED",
      },
      where: {
        id: context.leg.id,
        status: { in: ["CREATED", "DIALING", "RINGING"] },
      },
    });
    if (failed.count !== 1) {
      throw new Error("Call offer changed before replacement");
    }

    const latestAttempt = await this.transaction.callCenterCallLeg.aggregate({
      _max: { attemptNumber: true },
      where: { callId: context.call.id, kind: "AGENT" },
    });
    const newLeg = await this.transaction.callCenterCallLeg.create({
      data: {
        agentKey:
          `recovery:${context.call.id}:${context.leg.endpointId}:` +
          input.recoveryGeneration,
        agentSessionId: context.session.id,
        attemptNumber: (latestAttempt._max.attemptNumber ?? 0) + 1,
        callId: context.call.id,
        endpointId: context.session.endpointId,
        kind: "AGENT",
        startedAt: now,
        status: "CREATED",
      },
      select: { id: true },
    });
    const hangup = await this.transaction.callCenterCommand.create({
      data: {
        arguments: {},
        callId: context.call.id,
        idempotencyKey: `recover:${input.idempotencyKey}:hangup`,
        legId: context.leg.id,
        practiceId: context.call.practiceId,
        type: "HANGUP_LEG",
      },
      select: { id: true },
    });
    const dial = await this.transaction.callCenterCommand.create({
      data: {
        arguments: {
          agentSessionId: context.session.id,
          endpointId: context.session.endpointId,
        },
        callId: context.call.id,
        dependsOnCommandId: hangup.id,
        idempotencyKey: `recover:${input.idempotencyKey}:dial`,
        legId: newLeg.id,
        practiceId: context.call.practiceId,
        type: "DIAL_AGENT",
      },
      select: { id: true },
    });
    const call = await this.transaction.callCenterCall.update({
      data: { stateVersion: { increment: 1 } },
      select: { stateVersion: true },
      where: { id: context.call.id },
    });
    return {
      dialCommandId: dial.id,
      hangupCommandId: hangup.id,
      newCallLegId: newLeg.id,
      stateVersion: call.stateVersion,
    };
  }
}

export class PrismaFailedBrowserOfferRecoveryStore implements FailedBrowserOfferRecoveryStore {
  constructor(
    private readonly runTransaction: FailedBrowserOfferRecoveryTransactionRunner = (
      operation,
    ) => prisma.$transaction(operation),
  ) {}

  withTransaction<T>(
    work: (transaction: FailedBrowserOfferRecoveryTransaction) => Promise<T>,
  ) {
    return this.runTransaction((transaction) =>
      work(new PrismaFailedBrowserOfferRecoveryTransaction(transaction)),
    );
  }
}

export const prismaFailedBrowserOfferRecoveryStore =
  new PrismaFailedBrowserOfferRecoveryStore();
