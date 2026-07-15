import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { canonicalCallAccessWhere } from "@/lib/call-center/application/portal-canonical-history";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { prisma } from "@/lib/prisma";

type Database = Pick<PrismaClient, "$transaction">;
type Transaction = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "callCenterEvent" | "callCenterTask"
>;

export type ResolveCallerThreadInput = {
  actor: QueueAccessActor;
  disposition: string;
  locationIds: string[];
  now: Date;
  phoneVariants: string[];
  queueId?: string;
};

export async function resolveCallerThread(
  input: ResolveCallerThreadInput,
  database: Database = prisma,
) {
  return database.$transaction((transaction) =>
    resolveCallerThreadInTransaction(input, transaction),
  );
}

export async function resolveCallerThreadInTransaction(
  input: ResolveCallerThreadInput,
  transaction: Transaction,
) {
  const callAccess = {
    ...canonicalCallAccessWhere(
      {
        allowedLocationIds: input.actor.allowedLocationIds,
        hasAllLocationAccess: input.actor.hasAllLocationAccess,
        practice: { id: input.actor.practiceId },
      },
      input.locationIds,
    ),
    ...(input.queueId ? { queueId: input.queueId } : {}),
  } satisfies Prisma.CallCenterCallWhereInput;
  const where = {
    call: {
      ...callAccess,
      OR: [
        { fromPhone: { in: input.phoneVariants } },
        { toPhone: { in: input.phoneVariants } },
      ],
    },
    practiceId: input.actor.practiceId,
    status: "OPEN",
  } satisfies Prisma.CallCenterTaskWhereInput;
  const tasks = await transaction.callCenterTask.findMany({
    select: { callId: true, id: true },
    where,
  });
  if (!tasks.length) return { canonicalTasksResolved: 0 };

  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_task" WHERE "id" IN (${Prisma.join(
      tasks.map(({ id }) => id),
    )}) FOR UPDATE`,
  );
  const resolved = await transaction.callCenterTask.updateMany({
    data: {
      resolvedAt: input.now,
      resolvedByUserId: input.actor.userId,
      status: "RESOLVED",
    },
    where: { id: { in: tasks.map(({ id }) => id) }, status: "OPEN" },
  });
  if (resolved.count !== tasks.length) {
    throw new Error("Caller tasks changed during resolution");
  }
  await Promise.all(
    tasks.map((task) =>
      transaction.callCenterEvent.create({
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
      }),
    ),
  );
  return { canonicalTasksResolved: tasks.length };
}
