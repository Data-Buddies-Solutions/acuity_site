import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { canonicalCallAccessWhere } from "@/lib/call-center/application/portal-canonical-history";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { resolveQueueAccess } from "@/lib/call-center/auth/queue-access";
import { lockCallCenterPractice } from "@/lib/call-center/infrastructure/prisma-call-center-practice-lock";
import { PrismaOperationReceiptTransaction } from "@/lib/call-center/infrastructure/prisma-operation-receipts";
import {
  type CanonicalSaveOperatorNoteInput,
  type DispositionCallInput,
  OperatorFollowUpError,
  type OperatorFollowUpStore,
  type OperatorFollowUpTransaction,
  type ResolveCallerThreadInput,
} from "@/lib/call-center/operator-follow-up";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
type CanonicalCallerInput = ResolveCallerThreadInput & {
  phoneVariants: string[];
};

const CLOSING_DISPOSITIONS = new Set(["RESOLVED", "WRONG_NUMBER", "OTHER"]);

function callAccess(
  actor: QueueAccessActor,
  locationId: string | undefined,
  queueId: string | undefined,
) {
  return {
    ...canonicalCallAccessWhere(
      {
        allowedLocationIds: actor.allowedLocationIds,
        hasAllLocationAccess: actor.hasAllLocationAccess,
        practice: { id: actor.practiceId },
      },
      locationId ? [locationId] : [],
    ),
    ...(queueId ? { queueId } : {}),
  } satisfies Prisma.CallCenterCallWhereInput;
}

function taskIdsMatch(actual: string[], expected: string[]) {
  const actualIds = [...actual].sort();
  const expectedIds = [...expected].sort();
  return (
    actualIds.length === expectedIds.length &&
    actualIds.every((taskId, index) => taskId === expectedIds[index])
  );
}

class PrismaOperatorFollowUpTransaction implements OperatorFollowUpTransaction {
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

  private async authorizeQueue(actor: QueueAccessActor, queueId?: string) {
    if (queueId) await resolveQueueAccess(actor, queueId, this.transaction);
  }

  private async resolveTaskRows(
    actor: QueueAccessActor,
    tasks: Array<{ callId: string; id: string }>,
    disposition: string,
    idempotencyKey: string,
    now: Date,
  ) {
    if (!tasks.length) return;
    const resolved = await this.transaction.callCenterTask.updateMany({
      data: {
        resolvedAt: now,
        resolvedByUserId: actor.userId,
        status: "RESOLVED",
      },
      where: { id: { in: tasks.map(({ id }) => id) }, status: "OPEN" },
    });
    if (resolved.count !== tasks.length) {
      throw new OperatorFollowUpError("One or more follow-up tasks changed", 409);
    }
    for (const task of tasks) {
      await this.transaction.callCenterEvent.create({
        data: {
          actorUserId: actor.userId,
          aggregateId: task.id,
          aggregateType: "TASK",
          data: {
            callId: task.callId,
            disposition,
            source: "CALLER_THREAD",
          },
          idempotencyKey: `${idempotencyKey}:task:${task.id}`,
          occurredAt: now,
          practiceId: actor.practiceId,
          type: "TASK_RESOLVED",
        },
      });
    }
  }

  private async recordDisposition(
    actor: QueueAccessActor,
    input: {
      callId: string;
      disposition: string;
      idempotencyKey: string;
      note: string | null;
      resolvedTaskCount: number;
    },
    now: Date,
  ) {
    const updated = await this.transaction.callCenterCall.update({
      data: { stateVersion: { increment: 1 } },
      select: { stateVersion: true },
      where: { id: input.callId },
    });
    await this.transaction.callCenterEvent.create({
      data: {
        actorUserId: actor.userId,
        aggregateId: input.callId,
        aggregateType: "CALL",
        data: {
          disposition: input.disposition,
          note: input.note,
          resolvedTaskCount: input.resolvedTaskCount,
        },
        idempotencyKey: `${input.idempotencyKey}:disposition`,
        occurredAt: now,
        practiceId: actor.practiceId,
        type: "CALL_DISPOSITION_SAVED",
      },
    });
    return updated.stateVersion;
  }

  private async resolveTasks(
    actor: QueueAccessActor,
    input: CanonicalCallerInput,
    disposition: string,
    now: Date,
    mutate = true,
    authorizedQueueIds = new Set<string>(),
  ) {
    if (input.queueId && !authorizedQueueIds.has(input.queueId)) {
      await this.authorizeQueue(actor, input.queueId);
      authorizedQueueIds.add(input.queueId);
    }
    const where = {
      call: {
        ...callAccess(actor, input.locationId, input.queueId),
        OR: [
          { fromPhone: { in: input.phoneVariants } },
          { toPhone: { in: input.phoneVariants } },
        ],
      },
      practiceId: actor.practiceId,
      status: "OPEN",
    } satisfies Prisma.CallCenterTaskWhereInput;
    const tasks = await this.transaction.callCenterTask.findMany({
      select: { call: { select: { queueId: true } }, callId: true, id: true },
      where,
    });
    for (const queueId of new Set(
      tasks.map(({ call }) => call.queueId).filter((value): value is string => !!value),
    )) {
      if (!authorizedQueueIds.has(queueId)) {
        await this.authorizeQueue(actor, queueId);
        authorizedQueueIds.add(queueId);
      }
    }
    if (
      !taskIdsMatch(
        tasks.map(({ id }) => id),
        input.expectedTaskIds,
      )
    ) {
      throw new OperatorFollowUpError("One or more follow-up tasks changed", 409);
    }
    if (!tasks.length) return 0;

    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_task" WHERE "id" IN (${Prisma.join(
        tasks.map(({ id }) => id),
      )}) FOR UPDATE`,
    );
    const current = await this.transaction.callCenterTask.findMany({
      select: { call: { select: { queueId: true } }, callId: true, id: true },
      where,
    });
    if (
      !taskIdsMatch(
        current.map(({ id }) => id),
        input.expectedTaskIds,
      )
    ) {
      throw new OperatorFollowUpError("One or more follow-up tasks changed", 409);
    }
    if (!mutate) return current.length;
    await this.resolveTaskRows(actor, current, disposition, input.idempotencyKey, now);
    return current.length;
  }

  async resolveCallerThread(
    actor: QueueAccessActor,
    input: CanonicalCallerInput,
    now: Date,
  ) {
    await lockCallCenterPractice(this.transaction, actor.practiceId);
    const canonicalTasksResolved = await this.resolveTasks(actor, input, "RESOLVED", now);
    return {
      canonicalTasksResolved,
      operationType: "CALLER_THREAD_RESOLUTION",
      status: "CONFIRMED",
    };
  }

  async saveDisposition(actor: QueueAccessActor, input: DispositionCallInput, now: Date) {
    await lockCallCenterPractice(this.transaction, actor.practiceId);
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "id" = ${input.callId} AND "practiceId" = ${actor.practiceId} FOR UPDATE`,
    );
    const call = await this.transaction.callCenterCall.findFirst({
      include: {
        number: {
          select: { practicePhoneNumber: { select: { locationId: true } } },
        },
      },
      where: { id: input.callId, practiceId: actor.practiceId },
    });
    if (!call?.queueId) {
      throw new OperatorFollowUpError("Canonical call not found", 404);
    }
    await resolveQueueAccess(actor, call.queueId, this.transaction);
    const locationId = call.number.practicePhoneNumber.locationId;
    if (
      !actor.hasAllLocationAccess &&
      (!locationId || !actor.allowedLocationIds.includes(locationId))
    ) {
      throw new OperatorFollowUpError("Canonical call not found", 404);
    }
    if (call.stateVersion !== input.expectedStateVersion) {
      throw new OperatorFollowUpError("Call changed; refresh and try again", 409);
    }
    if (!["COMPLETED", "VOICEMAIL", "ABANDONED", "FAILED"].includes(call.status)) {
      throw new OperatorFollowUpError("Call is not ready for disposition", 409);
    }
    const taskIds = [...new Set(input.taskIds)];
    const tasks = taskIds.length
      ? await this.transaction.callCenterTask.findMany({
          select: { id: true },
          where: {
            callId: call.id,
            id: { in: taskIds },
            practiceId: actor.practiceId,
            status: "OPEN",
          },
        })
      : [];
    if (tasks.length !== taskIds.length) {
      throw new OperatorFollowUpError("One or more follow-up tasks changed", 409);
    }
    await this.resolveTaskRows(
      actor,
      tasks.map(({ id }) => ({ callId: call.id, id })),
      input.disposition,
      input.idempotencyKey,
      now,
    );
    const stateVersion = await this.recordDisposition(
      actor,
      {
        callId: call.id,
        disposition: input.disposition,
        idempotencyKey: input.idempotencyKey,
        note: input.note,
        resolvedTaskCount: tasks.length,
      },
      now,
    );
    return {
      callId: call.id,
      operationType: "DISPOSITION",
      resolvedTaskCount: tasks.length,
      stateVersion,
      status: "CONFIRMED",
    };
  }

  async saveNote(
    actor: QueueAccessActor,
    input: CanonicalSaveOperatorNoteInput,
    now: Date,
  ) {
    await lockCallCenterPractice(this.transaction, actor.practiceId);
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "id" = ${input.callId} AND "practiceId" = ${actor.practiceId} FOR UPDATE`,
    );
    const call = await this.transaction.callCenterCall.findFirst({
      select: { id: true, queueId: true, stateVersion: true },
      where: {
        ...callAccess(actor, input.locationId, input.queueId),
        id: input.callId,
        OR: [
          { fromPhone: { in: input.phoneVariants } },
          { toPhone: { in: input.phoneVariants } },
        ],
      },
    });
    if (!call) throw new OperatorFollowUpError("Canonical call not found", 404);
    await this.authorizeQueue(actor, call.queueId ?? undefined);
    if (call.stateVersion !== input.expectedStateVersion) {
      throw new OperatorFollowUpError("Call changed; refresh and try again", 409);
    }

    const closing = CLOSING_DISPOSITIONS.has(input.disposition);
    const authorizedQueueIds = new Set(call.queueId ? [call.queueId] : []);
    await this.resolveTasks(
      actor,
      input,
      input.disposition,
      now,
      closing,
      authorizedQueueIds,
    );

    const taskId = randomUUID();
    const kind =
      input.disposition === "CALLBACK_NEEDED"
        ? "CALLBACK"
        : input.disposition === "FOLLOW_UP_REQUIRED"
          ? "FOLLOW_UP"
          : "NOTE";
    const open = kind !== "NOTE";
    const event = await this.transaction.callCenterEvent.create({
      data: {
        actorUserId: actor.userId,
        aggregateId: taskId,
        aggregateType: "TASK",
        data: {
          body: input.note,
          callId: call.id,
          disposition: input.disposition,
        },
        idempotencyKey: `${input.idempotencyKey}:task-created`,
        occurredAt: now,
        practiceId: actor.practiceId,
        type: "TASK_CREATED",
      },
      select: { revision: true },
    });
    await this.transaction.callCenterTask.create({
      data: {
        callId: call.id,
        createdAt: now,
        dedupeKey: `operator-note:${input.idempotencyKey}`,
        id: taskId,
        kind,
        note: input.note,
        practiceId: actor.practiceId,
        resolvedAt: open ? null : now,
        resolvedByUserId: open ? null : actor.userId,
        sourceEventRevision: event.revision,
        status: open ? "OPEN" : "RESOLVED",
      },
    });
    const stateVersion = await this.recordDisposition(
      actor,
      {
        callId: call.id,
        disposition: input.disposition,
        idempotencyKey: input.idempotencyKey,
        note: input.note,
        resolvedTaskCount: closing ? input.expectedTaskIds.length : 0,
      },
      now,
    );
    return {
      aggregateId: taskId,
      data: {
        callId: call.id,
        operationType: "OPERATOR_NOTE",
        resolvedTaskCount: closing ? input.expectedTaskIds.length : 0,
        stateVersion,
        status: "CONFIRMED",
        taskId,
      },
    };
  }
}

class PrismaOperatorFollowUpStore implements OperatorFollowUpStore {
  constructor(
    private readonly run = <T>(operation: (transaction: Transaction) => Promise<T>) =>
      prisma.$transaction(operation),
  ) {}

  findVoicemail(actor: QueueAccessActor, recordingId: string) {
    return prisma.callCenterVoicemail.findFirst({
      select: {
        durationSec: true,
        id: true,
        recordingUrl: true,
      },
      where: {
        callCenterCall: callAccess(actor, undefined, undefined),
        recordingId,
      },
    });
  }

  transaction<T>(operation: (transaction: OperatorFollowUpTransaction) => Promise<T>) {
    return this.run((transaction) =>
      operation(new PrismaOperatorFollowUpTransaction(transaction)),
    );
  }

  async updateVoicemail(
    id: string,
    update: { durationSec?: number; listenedAt?: Date; recordingUrl?: string },
  ) {
    await prisma.callCenterVoicemail.update({ data: update, where: { id } });
  }
}

export const prismaOperatorFollowUpStore = new PrismaOperatorFollowUpStore();
