import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { CALL_OUTBOUND_REQUESTED_EVENT } from "@/lib/call-center/application/start-outbound-call";
import { CALL_DISPOSITION_REQUESTED_EVENT } from "@/lib/call-center/application/disposition-call";
import {
  listAccessibleQueues,
  QueueAccessError,
  queueAccessKey,
  type QueueAccessActor,
  type QueueAccessIdentity,
  rehydrateQueueAccessActor,
  resolveQueueAccess,
} from "@/lib/call-center/auth/queue-access";
import { serializeAgentConnectionState } from "@/lib/call-center/domain/agent-session-wire";
import { CALL_OPERATION_STATUS_CHANGED_EVENT } from "@/lib/call-center/infrastructure/prisma-command-operation-events";
import {
  CALL_CENTER_SCHEMA_VERSION,
  type AgentSessionView,
  type CallCenterSnapshot,
  type CallView,
  type OperationalCounts,
  type OperationView,
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
const CALL_CLAIM_REQUESTED_EVENT = "CALL_CLAIM_REQUESTED";
const CALL_TRANSFER_REQUESTED_EVENT = "CALL_TRANSFER_REQUESTED";
const TERMINAL_CALL_STATUSES = ["COMPLETED", "VOICEMAIL", "ABANDONED", "FAILED"] as const;
export const CANONICAL_EVENT_BATCH_SIZE = 100;
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
  currentCallId: true,
  offeredCallId: true,
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
const eventSelect = {
  aggregateId: true,
  aggregateType: true,
  data: true,
  practiceId: true,
  revision: true,
  type: true,
} satisfies Prisma.CallCenterEventSelect;
const commandSelect = {
  callId: true,
  errorCode: true,
  id: true,
  nextAttemptAt: true,
  practiceId: true,
  status: true,
  type: true,
} satisfies Prisma.CallCenterCommandSelect;

type SelectedCall = Prisma.CallCenterCallGetPayload<{ select: typeof callSelect }>;
type SelectedSession = Prisma.CallCenterAgentSessionGetPayload<{
  select: typeof sessionSelect;
}>;
type SelectedTask = Prisma.CallCenterTaskGetPayload<{ select: typeof taskSelect }>;
type SelectedEvent = Prisma.CallCenterEventGetPayload<{ select: typeof eventSelect }>;
type SelectedCommand = Prisma.CallCenterCommandGetPayload<{
  select: typeof commandSelect;
}>;

type TransferTargetCandidate = {
  user: {
    id: string;
    name: string;
  };
};

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

function record(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : null;
}

function operationType(event: SelectedEvent): OperationView["type"] | null {
  if (event.type === CALL_DISPOSITION_REQUESTED_EVENT) return "DISPOSITION";
  if (event.type === CALL_CLAIM_REQUESTED_EVENT) return "CLAIM";
  if (event.type === CALL_OUTBOUND_REQUESTED_EVENT) return "OUTBOUND";
  if (event.type === CALL_TRANSFER_REQUESTED_EVENT) return "TRANSFER";
  if (event.type !== CALL_OPERATION_STATUS_CHANGED_EVENT) return null;
  return record(event.data)?.operationType === "TRANSFER" ? "TRANSFER" : "CLAIM";
}

function operationCommandId(event: SelectedEvent) {
  const data = record(event.data);
  return typeof data?.providerCommandId === "string" ? data.providerCommandId : null;
}

function operationRevision(event: SelectedEvent) {
  if (
    event.type === CALL_CLAIM_REQUESTED_EVENT ||
    event.type === CALL_DISPOSITION_REQUESTED_EVENT ||
    event.type === CALL_OUTBOUND_REQUESTED_EVENT ||
    event.type === CALL_TRANSFER_REQUESTED_EVENT
  ) {
    return revisionString(event.revision);
  }
  const data = record(event.data);
  return typeof data?.operationEventRevision === "string"
    ? data.operationEventRevision
    : null;
}

function operationStatus(command: SelectedCommand): OperationView["status"] {
  if (command.status === "CONFIRMED") return "CONFIRMED";
  if (command.status === "FAILED") {
    return command.nextAttemptAt ? "PENDING" : "FAILED";
  }
  if (command.status === "SENT") return "SENT";
  return "PENDING";
}

export function serializeOperation(
  event: SelectedEvent,
  commands: ReadonlyMap<string, SelectedCommand>,
): OperationView | null {
  const type = operationType(event);
  const providerCommandId = operationCommandId(event);
  const operationEventRevision = operationRevision(event);
  const command = providerCommandId ? commands.get(providerCommandId) : null;
  if ((type === "DISPOSITION" || type === "OUTBOUND") && operationEventRevision) {
    const data = record(event.data);
    const outbound =
      type === "OUTBOUND" &&
      typeof data?.agentSessionId === "string" &&
      typeof data.legId === "string"
        ? {
            targetAgentSessionId: data.agentSessionId,
            targetEndpointId:
              typeof data.endpointId === "string" ? data.endpointId : undefined,
            targetLegId: data.legId,
          }
        : null;
    if (type === "OUTBOUND" && (!outbound || !outbound.targetEndpointId)) return null;
    return {
      callId: event.aggregateId,
      errorCode: null,
      operationEventRevision,
      providerCommandId: null,
      status: "CONFIRMED",
      type,
      ...outbound,
    };
  }
  if (
    !type ||
    !providerCommandId ||
    !operationEventRevision ||
    !command ||
    command.practiceId !== event.practiceId ||
    command.callId !== event.aggregateId ||
    command.type !== "DIAL_AGENT"
  ) {
    return null;
  }

  const data = record(event.data);
  const claimAgentSessionId = data?.agentSessionId ?? data?.targetAgentSessionId;
  const claimEndpointId = data?.endpointId ?? data?.targetEndpointId;
  const claimLegId = data?.legId ?? data?.targetLegId;
  const claim =
    type === "CLAIM" &&
    typeof claimAgentSessionId === "string" &&
    typeof claimEndpointId === "string" &&
    typeof claimLegId === "string"
      ? {
          targetAgentSessionId: claimAgentSessionId,
          targetEndpointId: claimEndpointId,
          targetLegId: claimLegId,
        }
      : null;
  const transfer =
    type === "TRANSFER" &&
    typeof data?.sourceLegId === "string" &&
    typeof data.targetAgentSessionId === "string" &&
    typeof data.targetEndpointId === "string" &&
    typeof data.targetLegId === "string"
      ? {
          sourceLegId: data.sourceLegId,
          targetAgentSessionId: data.targetAgentSessionId,
          targetEndpointId: data.targetEndpointId,
          targetLegId: data.targetLegId,
          targetUserId:
            typeof data.targetUserId === "string" ? data.targetUserId : undefined,
        }
      : null;
  if (type === "CLAIM" && !claim) return null;
  if (type === "TRANSFER" && !transfer) return null;
  return {
    callId: event.aggregateId,
    errorCode: command.errorCode,
    operationEventRevision,
    providerCommandId,
    status: operationStatus(command),
    type,
    ...claim,
    ...transfer,
  };
}

export function buildCanonicalBatchItems({
  calls,
  commands = [],
  counts,
  events,
  sessions,
  tasks,
}: {
  calls: SelectedCall[];
  commands?: SelectedCommand[];
  counts: OperationalCounts;
  events: SelectedEvent[];
  sessions: SelectedSession[];
  tasks: SelectedTask[];
}): CanonicalEventBatchItem[] {
  const callById = new Map(calls.map((call) => [call.id, call]));
  const commandById = new Map(commands.map((command) => [command.id, command]));
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  return events.map((event): CanonicalEventBatchItem => {
    const base = {
      aggregateId: event.aggregateId,
      counts,
      revision: revisionString(event.revision),
      schemaVersion: CALL_CENTER_SCHEMA_VERSION,
    } as const;

    const requestedOperation = operationType(event);
    if (requestedOperation) {
      const operation = serializeOperation(event, commandById);
      return {
        projection:
          operation && callById.has(event.aggregateId)
            ? {
                ...base,
                aggregateType: "COMMAND",
                delta: { kind: "OPERATION_UPSERT", operation },
                stateVersion: 0,
              }
            : null,
        reset: false,
        revision: event.revision,
      };
    }

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
        (event.type === "AGENT_SESSION_LEASE_EXPIRED" &&
          !session?.callLegs.some(({ status }) =>
            ["ANSWERED", "BRIDGED"].includes(status),
          ));
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

export function serializeReadyTransferTargets(candidates: TransferTargetCandidate[]) {
  const sessionsByUser = new Map<string, { count: number; name: string }>();
  for (const { user } of candidates) {
    const current = sessionsByUser.get(user.id);
    sessionsByUser.set(user.id, {
      count: (current?.count ?? 0) + 1,
      name: user.name,
    });
  }
  return [...sessionsByUser]
    .filter(([, { count }]) => count === 1)
    .map(([userId, { name }]) => ({ name, userId }));
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
    if (row.status === "CONNECTED" || row.status === "WRAP_UP") active += count;
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
      const [
        highWater,
        agentSession,
        activeCalls,
        recentCalls,
        tasks,
        counts,
        readyTransferSessions,
      ] = await Promise.all([
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
        transaction.callCenterAgentSession.findMany({
          orderBy: [{ user: { name: "asc" } }, { userId: "asc" }, { id: "asc" }],
          select: { user: { select: { id: true, name: true } } },
          where: {
            audioReady: true,
            callLegs: { none: { status: { in: ["ANSWERED", "BRIDGED"] } } },
            connectionState: "READY",
            endpoint: endpointWhere(actor, queueLocationIds),
            leaseExpiresAt: { gt: now },
            microphoneReady: true,
            practiceId: actor.practiceId,
            presence: "AVAILABLE",
            userId: { not: actor.userId },
            user: {
              callCenterQueueMemberships: {
                some: { enabled: true, queueId, role: "AGENT" },
              },
            },
          },
        }),
      ]);
      const callIds = [...activeCalls, ...recentCalls].map(({ id }) => id);
      const operationEvents = callIds.length
        ? await transaction.callCenterEvent.findMany({
            orderBy: { revision: "desc" },
            select: eventSelect,
            take: 100,
            where: {
              aggregateId: { in: callIds },
              aggregateType: "CALL",
              practiceId: actor.practiceId,
              type: {
                in: [
                  CALL_CLAIM_REQUESTED_EVENT,
                  CALL_DISPOSITION_REQUESTED_EVENT,
                  CALL_OUTBOUND_REQUESTED_EVENT,
                  CALL_TRANSFER_REQUESTED_EVENT,
                ],
              },
            },
          })
        : [];
      const operationCommandIds = operationEvents
        .map(operationCommandId)
        .filter((id): id is string => Boolean(id));
      const operationCommands = operationCommandIds.length
        ? await transaction.callCenterCommand.findMany({
            select: commandSelect,
            where: {
              id: { in: operationCommandIds },
              practiceId: actor.practiceId,
            },
          })
        : [];
      const commandById = new Map(
        operationCommands.map((command) => [command.id, command]),
      );

      return {
        agentSession: agentSession ? serializeAgentSession(agentSession) : null,
        agentProfile,
        availableQueues: accessibleQueues.map(({ id, name }) => ({ id, name })),
        calls: [...activeCalls, ...recentCalls].map(serializeCall),
        counts,
        operations: operationEvents
          .map((event) => serializeOperation(event, commandById))
          .filter((operation): operation is OperationView => Boolean(operation)),
        queue: {
          id: queue.id,
          maxWaitSec: queue.maxWaitSec,
          name: queue.name,
          ringTimeoutSec: queue.ringTimeoutSec,
        },
        revision: revisionString(highWater._max.revision ?? BigInt(0)),
        schemaVersion: CALL_CENTER_SCHEMA_VERSION,
        tasks: tasks.map(serializeTask),
        transferTargets: serializeReadyTransferTargets(readyTransferSessions),
      };
    },
    { ...CALL_CENTER_READ_TRANSACTION_OPTIONS },
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
      const commandIds = events
        .map(operationCommandId)
        .filter((id): id is string => Boolean(id));
      const [calls, commands, sessions, tasks, counts] = await Promise.all([
        transaction.callCenterCall.findMany({
          select: callSelect,
          where: { ...callWhere, id: { in: callIds } },
        }),
        transaction.callCenterCommand.findMany({
          select: commandSelect,
          where: { id: { in: commandIds }, practiceId: actor.practiceId },
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
      const items = buildCanonicalBatchItems({
        calls,
        commands,
        counts,
        events,
        sessions,
        tasks,
      });

      return {
        accessKey: queueAccessKey(actor),
        items,
        scannedThrough: events.at(-1)?.revision ?? null,
      };
    },
    { ...CALL_CENTER_READ_TRANSACTION_OPTIONS },
  );
}
