import { Prisma } from "@/generated/prisma/client";
import type {
  OperationReceiptData,
  OperationReceiptEvent,
  OperationReceiptInput,
  OperationReceiptTransaction,
} from "@/lib/call-center/application/operation-receipts";

export type OperationReceiptPrismaTransaction = Prisma.TransactionClient;

const receiptSelect = {
  aggregateId: true,
  aggregateType: true,
  data: true,
  occurredAt: true,
  revision: true,
} satisfies Prisma.CallCenterEventSelect;

function toReceiptEvent(event: {
  aggregateId: string;
  aggregateType: OperationReceiptEvent["aggregateType"];
  data: Prisma.JsonValue;
  occurredAt: Date;
  revision: bigint;
}): OperationReceiptEvent {
  return { ...event, data: event.data as OperationReceiptData };
}

export class PrismaOperationReceiptTransaction implements OperationReceiptTransaction {
  constructor(private readonly prisma: OperationReceiptPrismaTransaction) {}

  async appendReceipt(
    input: OperationReceiptInput,
    data: OperationReceiptData,
    now: Date,
  ) {
    const event = await this.prisma.callCenterEvent.create({
      data: {
        actorUserId: input.actorUserId,
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        data,
        idempotencyKey: input.idempotencyKey,
        occurredAt: now,
        practiceId: input.practiceId,
        type: input.type,
      },
      select: receiptSelect,
    });
    return toReceiptEvent(event);
  }

  async findReceipt(practiceId: string, type: string, idempotencyKey: string) {
    const event = await this.prisma.callCenterEvent.findUnique({
      select: receiptSelect,
      where: {
        practiceId_type_idempotencyKey: { idempotencyKey, practiceId, type },
      },
    });
    return event ? toReceiptEvent(event) : null;
  }

  async lockReceiptKey(practiceId: string, type: string, idempotencyKey: string) {
    const lockKey = `${practiceId}\u0000${type}\u0000${idempotencyKey}`;
    await this.prisma.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );
  }
}
