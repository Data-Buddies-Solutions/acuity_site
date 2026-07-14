import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { canonicalCallAccessWhere } from "@/lib/call-center/application/portal-canonical-history";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { prisma } from "@/lib/prisma";

type Database = Pick<PrismaClient, "$transaction">;

export type ResolveCallerThreadInput = {
  actor: QueueAccessActor;
  canonicalLocationIds: string[];
  disposition: string;
  legacyMissedCallWhere: Prisma.CallCenterMissedCallWhereInput;
  legacyNoteWhere: Prisma.CallCenterNoteWhereInput;
  legacyVoicemailWhere: Prisma.CallCenterVoicemailWhereInput;
  now: Date;
  phoneVariants: string[];
  queueId?: string;
};

export async function resolveCallerThread(
  input: ResolveCallerThreadInput,
  database: Database = prisma,
) {
  return database.$transaction(async (transaction) => {
    const callAccess = canonicalCallAccessWhere(
      {
        allowedLocationIds: input.actor.allowedLocationIds,
        hasAllLocationAccess: input.actor.hasAllLocationAccess,
        practice: { id: input.actor.practiceId },
      },
      input.canonicalLocationIds,
    );
    const queueCallAccess = {
      ...callAccess,
      ...(input.queueId ? { queueId: input.queueId } : {}),
    };
    const canonicalWhere: Prisma.CallCenterTaskWhereInput = {
      call: queueCallAccess,
      OR: [
        { callerPhone: { in: input.phoneVariants } },
        {
          call: { ...queueCallAccess, fromPhone: { in: input.phoneVariants } },
          callerPhone: null,
        },
      ],
      practiceId: input.actor.practiceId,
      status: "OPEN",
    };
    const candidates = await transaction.callCenterTask.findMany({
      select: { id: true },
      where: canonicalWhere,
    });
    if (candidates.length) {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "call_center_task" WHERE "id" IN (${Prisma.join(
          candidates.map(({ id }) => id),
        )}) FOR UPDATE`,
      );
    }
    const tasks = candidates.length
      ? await transaction.callCenterTask.findMany({
          select: { callId: true, id: true },
          where: {
            ...canonicalWhere,
            id: { in: candidates.map(({ id }) => id) },
          },
        })
      : [];

    await Promise.all([
      transaction.callCenterMissedCall.updateMany({
        data: { calledBack: true, resolvedAt: input.now },
        where: {
          calledBack: false,
          fromPhone: { in: input.phoneVariants },
          practiceId: input.actor.practiceId,
          resolvedAt: null,
          ...input.legacyMissedCallWhere,
        },
      }),
      transaction.callCenterVoicemail.updateMany({
        data: { resolvedAt: input.now },
        where: {
          fromPhone: { in: input.phoneVariants },
          practiceId: input.actor.practiceId,
          resolvedAt: null,
          ...input.legacyVoicemailWhere,
        },
      }),
      transaction.callCenterNote.updateMany({
        data: { resolvedThread: true },
        where: {
          disposition: { in: ["CALLBACK_NEEDED", "FOLLOW_UP_REQUIRED"] },
          fromPhone: { in: input.phoneVariants },
          practiceId: input.actor.practiceId,
          resolvedThread: false,
          ...input.legacyNoteWhere,
        },
      }),
    ]);

    if (tasks.length) {
      const resolved = await transaction.callCenterTask.updateMany({
        data: {
          resolvedAt: input.now,
          resolvedByUserId: input.actor.userId,
          status: "RESOLVED",
        },
        where: { id: { in: tasks.map(({ id }) => id) }, status: "OPEN" },
      });
      if (resolved.count !== tasks.length) {
        throw new Error("Canonical caller tasks changed during resolution");
      }
      for (const task of tasks) {
        await transaction.callCenterEvent.create({
          data: {
            actorUserId: input.actor.userId,
            aggregateId: task.id,
            aggregateType: "TASK",
            data: {
              callId: task.callId,
              disposition: input.disposition,
              source: "CALLER_THREAD",
            },
            idempotencyKey: `caller-thread-resolved:${task.id}`,
            occurredAt: input.now,
            practiceId: input.actor.practiceId,
            type: "TASK_RESOLVED",
          },
        });
      }
    }

    return { canonicalTasksResolved: tasks.length };
  });
}
