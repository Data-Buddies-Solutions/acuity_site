import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import {
  listAccessibleQueues,
  QueueAccessError,
  type QueueAccessActor,
} from "@/lib/call-center/auth/queue-access";
import {
  ACTIVE_CANONICAL_CALL_STATUSES,
  LIVE_CANONICAL_LEG_STATUSES,
  UNBRIDGED_LIVE_CANONICAL_LEG_STATUSES,
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
  direction: true,
  endedAt: true,
  fromPhone: true,
  id: true,
  legs: {
    orderBy: [{ startedAt: "asc" as const }, { id: "asc" as const }],
    select: {
      agentSessionId: true,
      commands: {
        orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
        select: { arguments: true, status: true, type: true },
        take: 1,
        where: { type: "TRANSFER_AGENT" as const },
      },
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
  winningLegId: true,
} satisfies Prisma.CallCenterCallSelect;

type SelectedCall = Prisma.CallCenterCallGetPayload<{ select: typeof callSelect }>;

function transferSourceLegId(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sourceLegId = (value as Record<string, unknown>).sourceLegId;
  return typeof sourceLegId === "string" && sourceLegId ? sourceLegId : null;
}

function isCanonicalTransferInProgress(call: SelectedCall) {
  if (call.status !== "CONNECTED" || !call.winningLegId) return false;
  const targetLegs = call.legs.filter(
    (leg) =>
      leg.kind === "AGENT" &&
      UNBRIDGED_LIVE_CANONICAL_LEG_STATUSES.includes(leg.status as never) &&
      leg.commands?.some(
        (command) =>
          command.type === "TRANSFER_AGENT" &&
          ["PENDING", "SENDING", "SENT", "CONFIRMED"].includes(command.status) &&
          transferSourceLegId(command.arguments) === call.winningLegId,
      ),
  );
  return targetLegs.length === 1;
}

export function serializeCall(call: SelectedCall, now: Date = new Date()): CallView {
  const { commands, legs, number, practiceId, ...view } = call;
  const callOffice = number.practicePhoneNumber.location;
  const effectiveHoldCommand = commands.find(
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
    legs: legs.map(({ commands: _commands, endpoint, ...leg }) => ({
      ...leg,
      endpointLabel: endpoint?.practiceId === practiceId ? endpoint.label : null,
    })),
    receivedAt: call.receivedAt.toISOString(),
    status: normalizeCanonicalCallStatus(call.status),
    transferring: isCanonicalTransferInProgress(call),
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
      { status: { in: [...ACTIVE_CANONICAL_CALL_STATUSES] } },
    ],
  };
}

function isSelectedQueueCall(
  call: SelectedCall,
  actor: QueueAccessActor,
  queueId: string,
  queueLocationIds: string[],
) {
  if (call.queueId !== queueId || call.practiceId !== actor.practiceId) return false;
  if (queueLocationIds.length === 0 && actor.hasAllLocationAccess) return true;

  const location = call.number.practicePhoneNumber.location;
  const locationId = call.number.practicePhoneNumber.locationId;
  const visibleLocationIds = accessibleQueueLocationIds(actor, queueLocationIds);
  const allowedLocationIds = queueLocationIds.length
    ? visibleLocationIds
    : actor.allowedLocationIds;
  return Boolean(
    call.number.practiceId === actor.practiceId &&
    location?.practiceId === actor.practiceId &&
    locationId &&
    allowedLocationIds.includes(locationId),
  );
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
        selectedQueueCallIds: activeCalls
          .filter((call) => isSelectedQueueCall(call, actor, queue.id, queueLocationIds))
          .map(({ id }) => id),
        schemaVersion: CALL_CENTER_SCHEMA_VERSION,
      };
    },
    { ...CALL_CENTER_READ_TRANSACTION_OPTIONS },
  );
}
