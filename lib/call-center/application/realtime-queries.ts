import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import {
  listAccessibleQueues,
  QueueAccessError,
  type QueueAccessActor,
} from "@/lib/call-center/auth/queue-access";
import {
  ACTIVE_CANONICAL_CALL_STATUSES,
  LIVE_CANONICAL_LEG_STATUSES,
  normalizeCanonicalCallStatus,
} from "@/lib/call-center/domain/canonical-call-state";
import {
  CALL_CENTER_SCHEMA_VERSION,
  type CallCenterSnapshot,
  type CallView,
} from "@/lib/call-center/realtime-contract";
import { prisma } from "@/lib/prisma";

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
      endpoint: {
        select: {
          label: true,
          practiceId: true,
        },
      },
      endpointId: true,
      id: true,
      kind: true,
      providerCallControlId: true,
      providerCallLegId: true,
      providerCallSessionId: true,
      status: true,
    },
  },
  number: {
    select: {
      practiceId: true,
      practicePhoneNumber: {
        select: {
          locationId: true,
          location: {
            select: {
              name: true,
              practiceId: true,
            },
          },
        },
      },
    },
  },
  practiceId: true,
  queueId: true,
  receivedAt: true,
  stateVersion: true,
  status: true,
  toPhone: true,
  winningLeg: {
    select: {
      commands: {
        orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
        select: { status: true, type: true },
        take: 1,
        where: {
          OR: [
            { status: "CONFIRMED" as const, type: "START_HOLD_MUSIC" as const },
            {
              status: { in: ["SENT" as const, "CONFIRMED" as const] },
              type: "STOP_HOLD_MUSIC" as const,
            },
          ],
        },
      },
    },
  },
  winningLegId: true,
} satisfies Prisma.CallCenterCallSelect;

type SelectedCall = Prisma.CallCenterCallGetPayload<{ select: typeof callSelect }>;

export function serializeCall(call: SelectedCall, now: Date = new Date()): CallView {
  const { legs, number, practiceId, winningLeg, ...view } = call;
  const callOffice = number.practicePhoneNumber.location;
  const effectiveHoldCommand = winningLeg?.commands.find(
    (command) =>
      (command.type === "START_HOLD_MUSIC" && command.status === "CONFIRMED") ||
      (command.type === "STOP_HOLD_MUSIC" &&
        (command.status === "SENT" || command.status === "CONFIRMED")),
  );
  return {
    ...view,
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
    callOfficeLabel: callOffice?.practiceId === practiceId ? callOffice.name : null,
    onHold:
      call.status === "CONNECTED" && effectiveHoldCommand?.type === "START_HOLD_MUSIC",
    legs: legs.map(({ endpoint, ...leg }) => ({
      ...leg,
      endpointLabel: endpoint?.practiceId === practiceId ? endpoint.label : null,
    })),
    receivedAt: call.receivedAt.toISOString(),
    status: normalizeCanonicalCallStatus(call.status),
  };
}

export function queueCallScope(
  actor: QueueAccessActor,
  queueId: string,
  queueLocationIds: string[],
): {
  includes(call: SelectedCall): boolean;
  where: Prisma.CallCenterCallWhereInput;
} {
  const locationIds = queueLocationIds.length
    ? actor.hasAllLocationAccess
      ? queueLocationIds
      : queueLocationIds.filter((id) => actor.allowedLocationIds.includes(id))
    : actor.hasAllLocationAccess
      ? null
      : actor.allowedLocationIds;
  const where: Prisma.CallCenterCallWhereInput = {
    practiceId: actor.practiceId,
    queueId,
    ...(locationIds === null
      ? {}
      : queueLocationIds.length || locationIds.length
        ? {
            number: {
              practiceId: actor.practiceId,
              practicePhoneNumber: {
                location: { practiceId: actor.practiceId },
                locationId: { in: locationIds },
              },
            },
          }
        : { id: { in: [] } }),
  };

  return {
    includes(call) {
      if (call.queueId !== queueId || call.practiceId !== actor.practiceId) return false;
      if (locationIds === null) return true;

      const location = call.number.practicePhoneNumber.location;
      const locationId = call.number.practicePhoneNumber.locationId;
      return Boolean(
        call.number.practiceId === actor.practiceId &&
        location?.practiceId === actor.practiceId &&
        locationId &&
        locationIds.includes(locationId),
      );
    },
    where,
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
      { status: { in: [...ACTIVE_CANONICAL_CALL_STATUSES] } },
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
      const selectedQueue = queueCallScope(actor, queueId, queueLocationIds);
      const activeCalls = await transaction.callCenterCall.findMany({
        orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
        select: callSelect,
        take: 100,
        where: activeCallWhere(selectedQueue.where, actor),
      });
      const observedAt = clock();

      return {
        calls: activeCalls.map((call) => serializeCall(call, observedAt)),
        observedAt: observedAt.toISOString(),
        queueId: queue.id,
        selectedQueueCallIds: activeCalls
          .filter(selectedQueue.includes)
          .map(({ id }) => id),
        schemaVersion: CALL_CENTER_SCHEMA_VERSION,
      };
    },
    { ...CALL_CENTER_READ_TRANSACTION_OPTIONS },
  );
}
