import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import {
  listAccessibleQueues,
  queueAccessKey,
  type QueueAccessActor,
  type QueueAccessIdentity,
  rehydrateQueueAccessActor,
  resolveQueueAccess,
} from "@/lib/call-center/auth/queue-access";
import { serializeAgentConnectionState } from "@/lib/call-center/domain/agent-session-wire";
import {
  CALL_CENTER_SCHEMA_VERSION,
  type AgentSessionView,
  type CallCenterSnapshot,
  type CallView,
  type OperationalCounts,
  type ProjectionEvent,
  type TaskView,
} from "@/lib/call-center/realtime-contract";
import { revisionString } from "@/lib/call-center/realtime";
import { prisma } from "@/lib/prisma";

const ACTIVE_CALL_STATUSES = [
  "RECEIVED",
  "QUEUED",
  "RINGING",
  "CONNECTED",
  "WRAP_UP",
] as const;
const TERMINAL_CALL_STATUSES = ["COMPLETED", "VOICEMAIL", "ABANDONED", "FAILED"] as const;
export const CANONICAL_EVENT_BATCH_SIZE = 100;

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
  id: true,
  kind: true,
  status: true,
} satisfies Prisma.CallCenterTaskSelect;
const eventSelect = {
  aggregateId: true,
  aggregateType: true,
  data: true,
  revision: true,
  type: true,
} satisfies Prisma.CallCenterEventSelect;

type SelectedCall = Prisma.CallCenterCallGetPayload<{ select: typeof callSelect }>;
type SelectedSession = Prisma.CallCenterAgentSessionGetPayload<{
  select: typeof sessionSelect;
}>;
type SelectedTask = Prisma.CallCenterTaskGetPayload<{ select: typeof taskSelect }>;
type SelectedEvent = Prisma.CallCenterEventGetPayload<{ select: typeof eventSelect }>;

export type CanonicalEventBatchItem = {
  projection: ProjectionEvent | null;
  reset: boolean;
  revision: bigint;
};

export type CanonicalEventBatch = {
  accessKey: string;
  items: CanonicalEventBatchItem[];
  scannedThrough: bigint | null;
};

export function buildCanonicalBatchItems({
  calls,
  counts,
  events,
  sessions,
  tasks,
}: {
  calls: SelectedCall[];
  counts: OperationalCounts;
  events: SelectedEvent[];
  sessions: SelectedSession[];
  tasks: SelectedTask[];
}): CanonicalEventBatchItem[] {
  const callById = new Map(calls.map((call) => [call.id, call]));
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  return events.map((event): CanonicalEventBatchItem => {
    const base = {
      aggregateId: event.aggregateId,
      counts,
      revision: revisionString(event.revision),
      schemaVersion: CALL_CENTER_SCHEMA_VERSION,
    } as const;

    if (event.aggregateType === "CALL") {
      const call = callById.get(event.aggregateId);
      return {
        projection: call
          ? {
              ...base,
              aggregateType: "CALL",
              delta: { call: serializeCall(call), kind: "CALL_UPSERT" },
              stateVersion: call.stateVersion,
            }
          : null,
        reset: false,
        revision: event.revision,
      };
    }

    if (event.aggregateType === "AGENT_SESSION") {
      const session = sessionById.get(event.aggregateId);
      const removed =
        event.type === "AGENT_SESSION_RELEASED" ||
        event.type === "AGENT_SESSION_LEASE_EXPIRED";
      return {
        projection: session
          ? {
              ...base,
              aggregateType: "AGENT_SESSION",
              delta: removed
                ? { kind: "AGENT_SESSION_REMOVE", sessionId: session.id }
                : {
                    kind: "AGENT_SESSION_UPSERT",
                    session: serializeAgentSession(session),
                  },
              stateVersion: session.stateVersion,
            }
          : null,
        reset: false,
        revision: event.revision,
      };
    }

    if (event.aggregateType === "TASK") {
      const task = taskById.get(event.aggregateId);
      return {
        projection: task
          ? {
              ...base,
              aggregateType: "TASK",
              delta:
                task.status === "RESOLVED"
                  ? { kind: "TASK_REMOVE", taskId: task.id }
                  : { kind: "TASK_UPSERT", task: serializeTask(task) },
              stateVersion: 0,
            }
          : null,
        reset: false,
        revision: event.revision,
      };
    }

    return {
      projection: null,
      reset: event.aggregateType === "CONFIGURATION",
      revision: event.revision,
    };
  });
}

export function serializeCall(call: SelectedCall): CallView {
  return {
    ...call,
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    legs: call.legs,
    receivedAt: call.receivedAt.toISOString(),
  };
}

export function serializeAgentSession(session: SelectedSession): AgentSessionView {
  const { browserSessionId, connectionState, leaseExpiresAt, ...safe } = session;
  return {
    ...safe,
    clientInstanceId: browserSessionId,
    connectionState: serializeAgentConnectionState(connectionState),
    leaseExpiresAt: leaseExpiresAt.toISOString(),
  };
}

export function serializeTask(task: SelectedTask): TaskView {
  return task;
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
    connectionState: { not: "CLOSED" },
    endpointId: { in: endpointIds },
    leaseExpiresAt: { gt: now },
    practiceId: actor.practiceId,
    presence: { not: "OFFLINE" },
    userId: actor.userId,
  };
}

async function readOperationalCounts(
  transaction: Prisma.TransactionClient,
  callWhere: Prisma.CallCenterCallWhereInput,
  practiceId: string,
): Promise<OperationalCounts> {
  const taskWhere = { call: callWhere, practiceId, status: "OPEN" } as const;
  const [active, waiting, recent, openTasks] = await Promise.all([
    transaction.callCenterCall.count({
      where: { ...callWhere, status: { in: ["CONNECTED", "WRAP_UP"] } },
    }),
    transaction.callCenterCall.count({
      where: {
        ...callWhere,
        status: { in: ["RECEIVED", "QUEUED", "RINGING"] },
      },
    }),
    transaction.callCenterCall.count({
      where: { ...callWhere, status: { in: [...TERMINAL_CALL_STATUSES] } },
    }),
    transaction.callCenterTask.count({ where: taskWhere }),
  ]);
  return { active, openTasks, recent, waiting };
}

export async function readCallCenterSnapshot(
  actor: QueueAccessActor,
  queueId: string,
  clientInstanceId: string,
  now = new Date(),
): Promise<CallCenterSnapshot> {
  return prisma.$transaction(
    async (transaction) => {
      const queue = await resolveQueueAccess(actor, queueId, transaction);
      const queueLocationIds = queue.locations.map(({ locationId }) => locationId);
      const callWhere = queueCallWhere(actor, queueId, queueLocationIds);
      const accessibleQueues = await listAccessibleQueues(actor, transaction);
      const endpoints = await transaction.callCenterEndpoint.findMany({
        orderBy: [{ label: "asc" }, { id: "asc" }],
        select: { enabled: true, id: true, label: true, locationId: true },
        where: endpointWhere(actor, queueLocationIds),
      });
      const endpointIds = endpoints.map(({ id }) => id);
      const [highWater, agentSession, activeCalls, recentCalls, tasks, counts] =
        await Promise.all([
          transaction.callCenterEvent.aggregate({ _max: { revision: true } }),
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
        availableQueues: accessibleQueues.map(({ id, name }) => ({ id, name })),
        calls: [...activeCalls, ...recentCalls].map(serializeCall),
        counts,
        endpoints,
        operations: null,
        queue: {
          id: queue.id,
          maxWaitSec: queue.maxWaitSec,
          name: queue.name,
          ringTimeoutSec: queue.ringTimeoutSec,
          routingMode: queue.routingMode,
        },
        revision: revisionString(highWater._max.revision ?? BigInt(0)),
        schemaVersion: CALL_CENTER_SCHEMA_VERSION,
        tasks: tasks.map(serializeTask),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

export async function readEventBounds() {
  const bounds = await prisma.callCenterEvent.aggregate({
    _max: { revision: true },
    _min: { revision: true },
  });
  return {
    latestRevision: bounds._max.revision ?? BigInt(0),
    retentionFloor: bounds._min.revision,
  };
}

export async function readCanonicalEventBatch(
  identity: QueueAccessIdentity,
  queueId: string,
  clientInstanceId: string,
  cursor: bigint,
  database: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<CanonicalEventBatch> {
  return database.$transaction(
    async (transaction) => {
      const actor = await rehydrateQueueAccessActor(identity, transaction);
      const queue = await resolveQueueAccess(actor, queueId, transaction);
      const queueLocationIds = queue.locations.map(({ locationId }) => locationId);
      const callWhere = queueCallWhere(actor, queueId, queueLocationIds);
      const endpointScope = endpointWhere(actor, queueLocationIds);
      const events = await transaction.callCenterEvent.findMany({
        orderBy: { revision: "asc" },
        select: eventSelect,
        take: CANONICAL_EVENT_BATCH_SIZE,
        where: { practiceId: actor.practiceId, revision: { gt: cursor } },
      });
      if (!events.length) {
        return { accessKey: queueAccessKey(actor), items: [], scannedThrough: null };
      }

      const callIds = events
        .filter(({ aggregateType }) => aggregateType === "CALL")
        .map(({ aggregateId }) => aggregateId);
      const sessionIds = events
        .filter(({ aggregateType }) => aggregateType === "AGENT_SESSION")
        .map(({ aggregateId }) => aggregateId);
      const taskIds = events
        .filter(({ aggregateType }) => aggregateType === "TASK")
        .map(({ aggregateId }) => aggregateId);
      const [calls, sessions, tasks, counts] = await Promise.all([
        transaction.callCenterCall.findMany({
          select: callSelect,
          where: { ...callWhere, id: { in: callIds } },
        }),
        transaction.callCenterAgentSession.findMany({
          select: sessionSelect,
          where: {
            endpoint: endpointScope,
            browserSessionId: clientInstanceId,
            id: { in: sessionIds },
            practiceId: actor.practiceId,
            userId: actor.userId,
          },
        }),
        transaction.callCenterTask.findMany({
          select: taskSelect,
          where: {
            call: callWhere,
            id: { in: taskIds },
            practiceId: actor.practiceId,
          },
        }),
        readOperationalCounts(transaction, callWhere, actor.practiceId),
      ]);
      const items = buildCanonicalBatchItems({ calls, counts, events, sessions, tasks });

      return {
        accessKey: queueAccessKey(actor),
        items,
        scannedThrough: events.at(-1)?.revision ?? null,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
