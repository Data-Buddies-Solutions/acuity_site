import { Prisma } from "@/generated/prisma/client";
import {
  DispositionCallError,
  type DispositionCallInput,
  type DispositionCallStore,
  type DispositionCallTransaction,
} from "@/lib/call-center/application/disposition-call";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { resolveQueueAccess } from "@/lib/call-center/auth/queue-access";
import { PrismaOperationReceiptTransaction } from "@/lib/call-center/infrastructure/prisma-operation-receipts";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;

class PrismaDispositionCallTransaction implements DispositionCallTransaction {
  private readonly receipts: PrismaOperationReceiptTransaction;
  constructor(private readonly transaction: Transaction) {
    this.receipts = new PrismaOperationReceiptTransaction(transaction);
  }
  appendReceipt(
    ...input: Parameters<PrismaOperationReceiptTransaction["appendReceipt"]>
  ) {
    return this.receipts.appendReceipt(...input);
  }
  findReceipt(...input: Parameters<PrismaOperationReceiptTransaction["findReceipt"]>) {
    return this.receipts.findReceipt(...input);
  }
  lockReceiptKey(
    ...input: Parameters<PrismaOperationReceiptTransaction["lockReceiptKey"]>
  ) {
    return this.receipts.lockReceiptKey(...input);
  }

  async saveDisposition(actor: QueueAccessActor, input: DispositionCallInput, now: Date) {
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "id" = ${input.callId} AND "practiceId" = ${actor.practiceId} FOR UPDATE`,
    );
    const call = await this.transaction.callCenterCall.findFirst({
      include: {
        number: { select: { practicePhoneNumber: { select: { locationId: true } } } },
      },
      where: { id: input.callId, practiceId: actor.practiceId },
    });
    if (!call?.queueId || call.effectOwner !== "CANONICAL") {
      throw new DispositionCallError("Canonical call not found", 404);
    }
    await resolveQueueAccess(actor, call.queueId, this.transaction);
    const locationId = call.number.practicePhoneNumber.locationId;
    if (
      !actor.hasAllLocationAccess &&
      (!locationId || !actor.allowedLocationIds.includes(locationId))
    ) {
      throw new DispositionCallError("Canonical call not found", 404);
    }
    if (call.stateVersion !== input.expectedStateVersion) {
      throw new DispositionCallError("Call changed; refresh and try again", 409);
    }
    if (!["COMPLETED", "VOICEMAIL", "ABANDONED", "FAILED"].includes(call.status)) {
      throw new DispositionCallError("Call is not ready for disposition", 409);
    }
    const tasks = input.taskIds.length
      ? await this.transaction.callCenterTask.findMany({
          select: { id: true },
          where: {
            callId: call.id,
            id: { in: input.taskIds },
            practiceId: actor.practiceId,
            status: "OPEN",
          },
        })
      : [];
    if (tasks.length !== new Set(input.taskIds).size) {
      throw new DispositionCallError("One or more follow-up tasks changed", 409);
    }
    if (tasks.length) {
      await this.transaction.callCenterTask.updateMany({
        data: { resolvedAt: now, resolvedByUserId: actor.userId, status: "RESOLVED" },
        where: { id: { in: tasks.map(({ id }) => id) }, status: "OPEN" },
      });
      for (const task of tasks) {
        await this.transaction.callCenterEvent.create({
          data: {
            actorUserId: actor.userId,
            aggregateId: task.id,
            aggregateType: "TASK",
            data: { callId: call.id, disposition: input.disposition },
            idempotencyKey: `${input.idempotencyKey}:task:${task.id}`,
            occurredAt: now,
            practiceId: actor.practiceId,
            type: "TASK_RESOLVED",
          },
        });
      }
    }
    const updated = await this.transaction.callCenterCall.update({
      data: { stateVersion: { increment: 1 } },
      select: { stateVersion: true },
      where: { id: call.id },
    });
    await this.transaction.callCenterEvent.create({
      data: {
        actorUserId: actor.userId,
        aggregateId: call.id,
        aggregateType: "CALL",
        data: {
          disposition: input.disposition,
          note: input.note,
          resolvedTaskCount: tasks.length,
        },
        idempotencyKey: `${input.idempotencyKey}:disposition`,
        occurredAt: now,
        practiceId: actor.practiceId,
        type: "CALL_DISPOSITION_SAVED",
      },
    });
    return {
      callId: call.id,
      operationType: "DISPOSITION" as const,
      resolvedTaskCount: tasks.length,
      stateVersion: updated.stateVersion,
      status: "CONFIRMED" as const,
    };
  }
}

export class PrismaDispositionCallStore implements DispositionCallStore {
  constructor(
    private readonly run = <T>(operation: (tx: Transaction) => Promise<T>) =>
      prisma.$transaction(operation),
  ) {}
  transaction<T>(operation: (transaction: DispositionCallTransaction) => Promise<T>) {
    return this.run((tx) => operation(new PrismaDispositionCallTransaction(tx)));
  }
}

export const prismaDispositionCallStore = new PrismaDispositionCallStore();
