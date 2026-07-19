import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

export type QueueAccessActor = {
  allowedLocationIds: string[];
  hasAllLocationAccess: boolean;
  practiceId: string;
  userId: string;
};

type QueueDatabase = Pick<PrismaClient, "callCenterQueue">;

export class QueueAccessError extends Error {
  readonly status = 404;

  constructor() {
    super("Call center queue not found");
    this.name = "QueueAccessError";
  }
}

export function queueAccessWhere(
  actor: QueueAccessActor,
): Prisma.CallCenterQueueWhereInput {
  return {
    enabled: true,
    members: {
      some: {
        enabled: true,
        userId: actor.userId,
      },
    },
    practiceId: actor.practiceId,
    ...(actor.hasAllLocationAccess
      ? {}
      : {
          OR: [
            { locations: { none: {} } },
            {
              locations: {
                some: {
                  location: { practiceId: actor.practiceId },
                  locationId: { in: actor.allowedLocationIds },
                },
              },
            },
          ],
        }),
  };
}

const queueAccessSelect = {
  id: true,
  locations: { select: { locationId: true } },
  name: true,
} satisfies Prisma.CallCenterQueueSelect;

export async function resolveQueueAccess(
  actor: QueueAccessActor,
  queueId: string,
  database: QueueDatabase = prisma,
) {
  const queue = await database.callCenterQueue.findFirst({
    select: queueAccessSelect,
    where: { id: queueId, ...queueAccessWhere(actor) },
  });

  if (!queue) throw new QueueAccessError();
  return queue;
}

export async function listAccessibleQueues(
  actor: QueueAccessActor,
  database: QueueDatabase = prisma,
) {
  return database.callCenterQueue.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: queueAccessSelect,
    where: queueAccessWhere(actor),
  });
}
