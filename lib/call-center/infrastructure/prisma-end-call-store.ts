import { Prisma } from "@/generated/prisma/client";
import {
  EndCallError,
  type EndCallInput,
  type EndCallStore,
  type EndCallTransaction,
} from "@/lib/call-center/application/end-call";
import type {
  OperationReceiptData,
  OperationReceiptInput,
} from "@/lib/call-center/application/operation-receipts";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { resolveQueueAccess } from "@/lib/call-center/auth/queue-access";
import { settleCanonicalCallLegs } from "@/lib/call-center/infrastructure/prisma-call-resource-settlement";
import { PrismaOperationReceiptTransaction } from "@/lib/call-center/infrastructure/prisma-operation-receipts";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
type TransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

const TERMINAL_CALL_STATUSES = ["ABANDONED", "COMPLETED", "FAILED", "VOICEMAIL"];
const LIVE_LEG_STATUSES = ["CREATED", "DIALING", "RINGING", "ANSWERED", "BRIDGED"];

class PrismaEndCallTransaction implements EndCallTransaction {
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

  async endCall(actor: QueueAccessActor, input: EndCallInput, now: Date) {
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "practiceId" = ${actor.practiceId} AND "id" = ${input.callId} FOR UPDATE`,
    );
    const call = await this.transaction.callCenterCall.findFirst({
      include: {
        legs: true,
        queue: { select: { id: true } },
      },
      where: { id: input.callId, practiceId: actor.practiceId },
    });
    if (!call?.queue) throw new EndCallError("Canonical call not found", 404);
    await resolveQueueAccess(actor, call.queue.id, this.transaction);
    if (call.effectOwner !== "CANONICAL") {
      throw new EndCallError("Canonical routing does not own this call", 409);
    }

    const session = await this.transaction.callCenterAgentSession.findFirst({
      select: { id: true },
      where: {
        browserSessionId: input.clientInstanceId,
        practiceId: actor.practiceId,
        userId: actor.userId,
      },
    });
    const leg = session
      ? call.legs.find(
          (candidate) =>
            candidate.agentSessionId === session.id &&
            candidate.kind === "AGENT" &&
            LIVE_LEG_STATUSES.includes(candidate.status),
        )
      : null;
    if (!session || !leg) {
      if (TERMINAL_CALL_STATUSES.includes(call.status)) {
        return {
          callId: call.id,
          commandIdsJson: "[]",
          status: call.status === "COMPLETED" ? "COMPLETED" : "ABANDONED",
        };
      }
      throw new EndCallError("This browser does not own a live call leg", 403);
    }

    const endsCall =
      call.winningLegId === leg.id ||
      (call.direction === "OUTBOUND" && call.winningLegId === null);
    const callStatus: "ABANDONED" | "COMPLETED" =
      call.status === "CONNECTED" || call.status === "WRAP_UP"
        ? "COMPLETED"
        : "ABANDONED";
    const status = endsCall ? callStatus : "REJECTED";

    if (endsCall) {
      await this.transaction.callCenterCall.update({
        data: {
          deadlineAt: null,
          endedAt: now,
          stateVersion: { increment: 1 },
          status: callStatus,
        },
        where: { id: call.id },
      });
    }
    const commandIds = await settleCanonicalCallLegs(this.transaction, {
      callId: call.id,
      includeCustomerLegs: endsCall,
      legIds: endsCall ? undefined : [leg.id],
      now,
      reason: endsCall ? "USER_HANGUP" : "OFFER_REJECTED",
    });
    return {
      callId: call.id,
      commandIdsJson: JSON.stringify(commandIds),
      status,
    };
  }
}

export class PrismaEndCallStore implements EndCallStore {
  constructor(
    private readonly runTransaction: TransactionRunner = (operation) =>
      prisma.$transaction(operation),
  ) {}

  transaction<T>(operation: (transaction: EndCallTransaction) => Promise<T>) {
    return this.runTransaction((transaction) =>
      operation(new PrismaEndCallTransaction(transaction)),
    );
  }
}

export const prismaEndCallStore = new PrismaEndCallStore();
