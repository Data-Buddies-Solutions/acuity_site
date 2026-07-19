import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import {
  listAccessibleQueues,
  QueueAccessError,
  type QueueAccessActor,
} from "@/lib/call-center/auth/queue-access";
import { normalizeCanonicalCallStatus } from "@/lib/call-center/domain/canonical-call-state";
import {
  CALL_CENTER_SCHEMA_VERSION,
  type CallCenterSnapshot,
  type CallView,
  type TaskView,
} from "@/lib/call-center/realtime-contract";
import { prisma } from "@/lib/prisma";

const ACTIVE_CALL_STATUSES = ["RECEIVED", "QUEUED", "RINGING", "CONNECTED"] as const;
const LIVE_AGENT_LEG_STATUSES = [
  "CREATED",
  "DIALING",
  "RINGING",
  "ANSWERED",
  "BRIDGED",
] as const;
const TERMINAL_CALL_STATUSES = ["COMPLETED", "VOICEMAIL", "ABANDONED", "FAILED"] as const;
export const CALL_CENTER_READ_TRANSACTION_OPTIONS = {
  isolationLevel: "RepeatableRead" as const,
  maxWait: 2_000,
  timeout: 10_000,
};

const callSelect = {
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

const taskSelect = {
  callId: true,
  call: { select: { direction: true, fromPhone: true, toPhone: true } },
  createdAt: true,
  id: true,
  kind: true,
  status: true,
} satisfies Prisma.CallCenterTaskSelect;
type SelectedCall = Prisma.CallCenterCallGetPayload<{ select: typeof callSelect }>;
type SelectedTask = Prisma.CallCenterTaskGetPayload<{ select: typeof taskSelect }>;

export function serializeCall(call: SelectedCall): CallView {
  return {
    ...call,
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    legs: call.legs,
    receivedAt: call.receivedAt.toISOString(),
    status: normalizeCanonicalCallStatus(call.status),
  };
}

function serializeTask(task: SelectedTask): TaskView {
  const { call, ...view } = task;
  return {
    ...view,
    callerPhone: call.direction === "OUTBOUND" ? call.toPhone : call.fromPhone,
    createdAt: task.createdAt.toISOString(),
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

export function agentEndpointWhere(
  actor: QueueAccessActor,
): Prisma.CallCenterEndpointWhereInput {
  return {
    enabled: true,
    practiceId: actor.practiceId,
    ...(actor.hasAllLocationAccess
      ? {}
      : actor.allowedLocationIds.length
        ? { locationId: { in: actor.allowedLocationIds } }
        : { id: { in: [] } }),
  };
}

function readOpenTaskCount(
  transaction: Prisma.TransactionClient,
  callWhere: Prisma.CallCenterCallWhereInput,
  practiceId: string,
): Promise<number> {
  const taskWhere = { call: callWhere, practiceId, status: "OPEN" } as const;
  return transaction.callCenterTask.count({ where: taskWhere });
}

export function activeCallWhere(
  callWhere: Prisma.CallCenterCallWhereInput,
  practiceId: string,
  agentEndpointId: string | null,
): Prisma.CallCenterCallWhereInput {
  const scope = agentEndpointId
    ? {
        OR: [
          callWhere,
          {
            legs: {
              some: {
                endpointId: agentEndpointId,
                kind: "AGENT" as const,
                status: { in: [...LIVE_AGENT_LEG_STATUSES] },
              },
            },
            practiceId,
          },
        ],
      }
    : callWhere;
  return { AND: [scope, { status: { in: [...ACTIVE_CALL_STATUSES] } }] };
}

export async function readCallCenterSnapshot(
  actor: QueueAccessActor,
  queueId: string,
  database: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<CallCenterSnapshot> {
  return database.$transaction(
    async (transaction) => {
      const accessibleQueues = await listAccessibleQueues(actor, transaction);
      const queue = accessibleQueues.find(({ id }) => id === queueId);
      if (!queue) throw new QueueAccessError();
      const queueLocationIds = queue.locations.map(({ locationId }) => locationId);
      const callWhere = queueCallWhere(actor, queueId, queueLocationIds);
      const agentProfile = await transaction.callCenterEndpoint.findFirst({
        select: { enabled: true, id: true, label: true, locationId: true },
        where: { ...agentEndpointWhere(actor), userId: actor.userId },
      });
      const activeWhere = activeCallWhere(
        callWhere,
        actor.practiceId,
        agentProfile?.id ?? null,
      );
      const [activeCalls, recentCalls, tasks, openTaskCount] = await Promise.all([
        transaction.callCenterCall.findMany({
          orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
          select: callSelect,
          take: 100,
          where: activeWhere,
        }),
        transaction.callCenterCall.findMany({
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          select: callSelect,
          take: 50,
          where: { ...callWhere, status: { in: [...TERMINAL_CALL_STATUSES] } },
        }),
        transaction.callCenterTask.findMany({
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: taskSelect,
          take: 100,
          where: { call: callWhere, practiceId: actor.practiceId, status: "OPEN" },
        }),
        readOpenTaskCount(transaction, callWhere, actor.practiceId),
      ]);

      return {
        agentProfile,
        calls: [...activeCalls, ...recentCalls].map(serializeCall),
        openTaskCount,
        queueId: queue.id,
        schemaVersion: CALL_CENTER_SCHEMA_VERSION,
        tasks: tasks.map(serializeTask),
      };
    },
    { ...CALL_CENTER_READ_TRANSACTION_OPTIONS },
  );
}
