import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import {
  listAccessibleQueues,
  QueueAccessError,
  type QueueAccessActor,
} from "@/lib/call-center/auth/queue-access";
import {
  normalizeAgentPresence,
  serializeAgentConnectionState,
} from "@/lib/call-center/domain/agent-session-wire";
import { normalizeCanonicalCallStatus } from "@/lib/call-center/domain/canonical-call-state";
import {
  CALL_CENTER_SCHEMA_VERSION,
  type AgentSessionView,
  type CallCenterSnapshot,
  type CallView,
  type OperationalCounts,
  type TaskView,
} from "@/lib/call-center/realtime-contract";
import { prisma } from "@/lib/prisma";

const ACTIVE_CALL_STATUSES = ["RECEIVED", "QUEUED", "RINGING", "CONNECTED"] as const;
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

const sessionSelect = {
  audioReady: true,
  browserSessionId: true,
  callLegs: {
    select: { status: true },
    where: { status: { in: ["ANSWERED", "BRIDGED"] as const } },
  },
  connectionState: true,
  endpointId: true,
  id: true,
  leaseExpiresAt: true,
  microphoneReady: true,
  presence: true,
  stateVersion: true,
} satisfies Prisma.CallCenterAgentSessionSelect;

const taskSelect = {
  callId: true,
  call: { select: { direction: true, fromPhone: true, toPhone: true } },
  createdAt: true,
  id: true,
  kind: true,
  status: true,
} satisfies Prisma.CallCenterTaskSelect;
type SelectedCall = Prisma.CallCenterCallGetPayload<{ select: typeof callSelect }>;
type SelectedSession = Prisma.CallCenterAgentSessionGetPayload<{
  select: typeof sessionSelect;
}>;
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

export function serializeAgentSession(session: SelectedSession): AgentSessionView {
  const {
    browserSessionId,
    callLegs: _,
    connectionState,
    leaseExpiresAt,
    ...safe
  } = session;
  return {
    ...safe,
    clientInstanceId: browserSessionId,
    connectionState: serializeAgentConnectionState(connectionState),
    leaseExpiresAt: leaseExpiresAt.toISOString(),
    presence: normalizeAgentPresence(session.presence),
  };
}

export function serializeTask(task: SelectedTask): TaskView {
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

function endpointWhere(
  actor: QueueAccessActor,
  queueLocationIds: string[],
): Prisma.CallCenterEndpointWhereInput {
  const locationIds = accessibleQueueLocationIds(actor, queueLocationIds);
  return {
    enabled: true,
    practiceId: actor.practiceId,
    ...(queueLocationIds.length
      ? { locationId: { in: locationIds } }
      : actor.hasAllLocationAccess
        ? {}
        : actor.allowedLocationIds.length
          ? { locationId: { in: actor.allowedLocationIds } }
          : { id: { in: [] } }),
  };
}

export function localAgentSessionWhere(
  actor: QueueAccessActor,
  endpointIds: string[],
  clientInstanceId: string,
  now: Date,
): Prisma.CallCenterAgentSessionWhereInput {
  return {
    browserSessionId: clientInstanceId,
    endpointId: { in: endpointIds },
    OR: [
      { callLegs: { some: { status: { in: ["ANSWERED", "BRIDGED"] } } } },
      {
        connectionState: { not: "CLOSED" },
        leaseExpiresAt: { gt: now },
        presence: { not: "OFFLINE" },
      },
    ],
    practiceId: actor.practiceId,
    userId: actor.userId,
  };
}

async function readOperationalCounts(
  transaction: Prisma.TransactionClient,
  callWhere: Prisma.CallCenterCallWhereInput,
  practiceId: string,
): Promise<OperationalCounts> {
  const taskWhere = { call: callWhere, practiceId, status: "OPEN" } as const;
  const [callCounts, openTasks] = await Promise.all([
    transaction.callCenterCall.groupBy({
      _count: { _all: true },
      by: ["direction", "status"],
      where: callWhere,
    }),
    transaction.callCenterTask.count({ where: taskWhere }),
  ]);

  let active = 0;
  let recent = 0;
  let waiting = 0;
  for (const row of callCounts) {
    const count = row._count._all;
    if (row.status === "CONNECTED") active += count;
    if (
      row.direction === "INBOUND" &&
      (row.status === "RECEIVED" || row.status === "QUEUED" || row.status === "RINGING")
    ) {
      waiting += count;
    }
    if (
      TERMINAL_CALL_STATUSES.includes(
        row.status as (typeof TERMINAL_CALL_STATUSES)[number],
      )
    ) {
      recent += count;
    }
  }
  return { active, openTasks, recent, waiting };
}

export async function readCallCenterSnapshot(
  actor: QueueAccessActor,
  queueId: string,
  clientInstanceId: string,
  now = new Date(),
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
        where: { ...endpointWhere(actor, queueLocationIds), userId: actor.userId },
      });
      const endpointIds = agentProfile ? [agentProfile.id] : [];
      const [agentSession, activeCalls, recentCalls, tasks, counts] = await Promise.all([
        transaction.callCenterAgentSession.findFirst({
          orderBy: [{ lastHeartbeatAt: "desc" }, { id: "asc" }],
          select: sessionSelect,
          where: localAgentSessionWhere(actor, endpointIds, clientInstanceId, now),
        }),
        transaction.callCenterCall.findMany({
          orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
          select: callSelect,
          take: 100,
          where: { ...callWhere, status: { in: [...ACTIVE_CALL_STATUSES] } },
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
        readOperationalCounts(transaction, callWhere, actor.practiceId),
      ]);

      return {
        agentSession: agentSession ? serializeAgentSession(agentSession) : null,
        agentProfile,
        availableQueues: accessibleQueues.map(({ id, name }) => ({ id, name })),
        calls: [...activeCalls, ...recentCalls].map(serializeCall),
        counts,
        queue: { id: queue.id, name: queue.name },
        schemaVersion: CALL_CENTER_SCHEMA_VERSION,
        tasks: tasks.map(serializeTask),
      };
    },
    { ...CALL_CENTER_READ_TRANSACTION_OPTIONS },
  );
}
