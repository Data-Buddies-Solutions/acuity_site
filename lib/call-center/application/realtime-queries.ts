import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import {
  listAccessibleQueues,
  QueueAccessError,
  type QueueAccessActor,
} from "@/lib/call-center/auth/queue-access";
import {
  LIVE_CANONICAL_LEG_STATUSES,
  normalizeCanonicalCallStatus,
} from "@/lib/call-center/domain/canonical-call-state";
import {
  CALL_CENTER_SCHEMA_VERSION,
  type CallCenterSnapshot,
  type CallView,
} from "@/lib/call-center/realtime-contract";
import { prisma } from "@/lib/prisma";

const ACTIVE_CALL_STATUSES = ["RECEIVED", "QUEUED", "RINGING", "CONNECTED"] as const;
export const CALL_CENTER_READ_TRANSACTION_OPTIONS = {
  isolationLevel: "RepeatableRead" as const,
  maxWait: 2_000,
  timeout: 10_000,
};

const callSelect = {
  answerReservation: {
    select: {
      agentSessionId: true,
      expiresAt: true,
      legId: true,
      status: true,
    },
  },
  answeredAt: true,
  callerName: true,
  direction: true,
  endedAt: true,
  fromPhone: true,
  id: true,
  legs: {
    orderBy: [{ startedAt: "asc" as const }, { id: "asc" as const }],
    select: {
      agentSessionId: true,
      endpointId: true,
      id: true,
      kind: true,
      providerCallControlId: true,
      providerCallLegId: true,
      providerCallSessionId: true,
      status: true,
    },
  },
  queueId: true,
  receivedAt: true,
  stateVersion: true,
  status: true,
  toPhone: true,
  winningLegId: true,
} satisfies Prisma.CallCenterCallSelect;

type SelectedCall = Prisma.CallCenterCallGetPayload<{ select: typeof callSelect }>;

export function serializeCall(call: SelectedCall, now: Date = new Date()): CallView {
  return {
    ...call,
    answerReservation:
      call.answerReservation &&
      (call.answerReservation.status === "BRIDGED" ||
        (["ACCEPTED", "ANSWERED"].includes(call.answerReservation.status) &&
          call.answerReservation.expiresAt > now))
        ? {
            ...call.answerReservation,
            expiresAt: call.answerReservation.expiresAt.toISOString(),
            status: call.answerReservation.status as "ACCEPTED" | "ANSWERED" | "BRIDGED",
          }
        : null,
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    legs: call.legs,
    receivedAt: call.receivedAt.toISOString(),
    status: normalizeCanonicalCallStatus(call.status),
  };
}

function accessibleQueueLocationIds(actor: QueueAccessActor, queueLocationIds: string[]) {
  return actor.hasAllLocationAccess
    ? queueLocationIds
    : queueLocationIds.filter((id) => actor.allowedLocationIds.includes(id));
}

export function queueCallWhere(
  actor: QueueAccessActor,
  queueId: string,
  queueLocationIds: string[],
): Prisma.CallCenterCallWhereInput {
  const locationIds = accessibleQueueLocationIds(actor, queueLocationIds);
  return {
    practiceId: actor.practiceId,
    queueId,
    ...(queueLocationIds.length
      ? {
          number: {
            practiceId: actor.practiceId,
            practicePhoneNumber: {
              location: { practiceId: actor.practiceId },
              locationId: { in: locationIds },
            },
          },
        }
      : actor.hasAllLocationAccess
        ? {}
        : actor.allowedLocationIds.length
          ? {
              number: {
                practiceId: actor.practiceId,
                practicePhoneNumber: {
                  location: { practiceId: actor.practiceId },
                  locationId: { in: actor.allowedLocationIds },
                },
              },
            }
          : { id: { in: [] } }),
  };
}

export function activeCallWhere(
  callWhere: Prisma.CallCenterCallWhereInput,
  actor: Pick<QueueAccessActor, "practiceId" | "userId">,
): Prisma.CallCenterCallWhereInput {
  return {
    AND: [
      {
        OR: [
          callWhere,
          {
            legs: {
              some: {
                agentSession: {
                  practiceId: actor.practiceId,
                  userId: actor.userId,
                },
                kind: "AGENT",
                status: { in: [...LIVE_CANONICAL_LEG_STATUSES] },
              },
            },
            practiceId: actor.practiceId,
          },
        ],
      },
      { status: { in: [...ACTIVE_CALL_STATUSES] } },
    ],
  };
}

export async function readCallCenterSnapshot(
  actor: QueueAccessActor,
  queueId: string,
  database: Pick<PrismaClient, "$transaction"> = prisma,
  clock: () => Date = () => new Date(),
): Promise<CallCenterSnapshot> {
  return database.$transaction(
    async (transaction) => {
      const accessibleQueues = await listAccessibleQueues(actor, transaction);
      const queue = accessibleQueues.find(({ id }) => id === queueId);
      if (!queue) throw new QueueAccessError();
      const queueLocationIds = queue.locations.map(({ locationId }) => locationId);
      const callWhere = queueCallWhere(actor, queueId, queueLocationIds);
      const activeCalls = await transaction.callCenterCall.findMany({
        orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
        select: callSelect,
        take: 100,
        where: activeCallWhere(callWhere, actor),
      });
      const observedAt = clock();

      return {
        calls: activeCalls.map((call) => serializeCall(call, observedAt)),
        observedAt: observedAt.toISOString(),
        queueId: queue.id,
        schemaVersion: CALL_CENTER_SCHEMA_VERSION,
      };
    },
    { ...CALL_CENTER_READ_TRANSACTION_OPTIONS },
  );
}
