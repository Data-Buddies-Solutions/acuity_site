import { Prisma } from "@/generated/prisma/client";
import type {
  ActiveInboundReconciliationInput,
  ActiveInboundReconciliationResult,
  ActiveInboundReconciliationSuccess,
  ActiveInboundReconciliationStore,
} from "@/lib/call-center/application/reconcile-active-inbound";
import { ACTIVE_INBOUND_ROUTING_EVENT } from "@/lib/call-center/application/active-inbound-routing";
import {
  decideActiveInboundLifecycle,
  type ActiveInboundLifecycleDecision,
  type ActiveInboundLifecycleIntent,
} from "@/lib/call-center/domain/active-inbound-lifecycle";
import { canonicalVoicemailGreetingDeadline } from "@/lib/call-center/domain/canonical-voicemail-lifecycle";
import { persistCanonicalUnansweredTask } from "@/lib/call-center/infrastructure/prisma-canonical-voicemail";
import { routeActiveInboundCallInTransaction } from "@/lib/call-center/infrastructure/prisma-active-inbound-routing-store";
import { settleCanonicalCallLegs } from "@/lib/call-center/infrastructure/prisma-call-resource-settlement";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
type TransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

const ACTIVE_STATUSES = ["RECEIVED", "QUEUED", "RINGING", "CONNECTED"] as const;
const LIVE_LEG_STATUSES = [
  "CREATED",
  "DIALING",
  "RINGING",
  "ANSWERED",
  "BRIDGED",
] as const;
const LIFECYCLE_EVENT = "CALL_ACTIVE_LIFECYCLE_RECONCILED";
const OVERFLOW_EVENT = "CALL_ACTIVE_OVERFLOWED";

type RouteQueueRound = typeof routeActiveInboundCallInTransaction;
type SettleAgentLegs = typeof settleCanonicalCallLegs;
type DueCall = { callId: string; practiceId: string };

type LifecycleCall = NonNullable<Awaited<ReturnType<typeof loadLifecycleCall>>>;

function eventQueueIds(data: Prisma.JsonValue) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const value = data as Record<string, Prisma.JsonValue>;
  return [value.fromQueueId, value.queueId].filter(
    (id): id is string => typeof id === "string",
  );
}

async function loadLifecycleCall(
  transaction: Transaction,
  practiceId: string,
  callId: string,
) {
  return transaction.callCenterCall.findFirst({
    select: {
      answeredAt: true,
      deadlineAt: true,
      direction: true,
      effectOwner: true,
      id: true,
      legs: {
        select: {
          commands: {
            orderBy: { createdAt: "desc" },
            select: { arguments: true },
            take: 1,
            where: { type: "DIAL_AGENT" },
          },
          id: true,
          kind: true,
          status: true,
        },
      },
      practiceId: true,
      queue: {
        select: {
          id: true,
          maxWaitSec: true,
          overflowQueue: {
            select: {
              enabled: true,
              id: true,
              practiceId: true,
            },
          },
          overflowQueueId: true,
          ringTimeoutSec: true,
          voicemailEnabled: true,
          voicemailGreeting: true,
        },
      },
      queueDeadlineAt: true,
      queueId: true,
      stateVersion: true,
      status: true,
      winningLegId: true,
    },
    where: { id: callId, practiceId },
  });
}

async function visitedQueueIds(transaction: Transaction, call: LifecycleCall) {
  const events = await transaction.callCenterEvent.findMany({
    select: { data: true },
    where: {
      aggregateId: call.id,
      aggregateType: "CALL",
      practiceId: call.practiceId,
      type: OVERFLOW_EVENT,
    },
  });
  return [call.queueId, ...events.flatMap(({ data }) => eventQueueIds(data))].filter(
    (id): id is string => Boolean(id),
  );
}

async function routingPrerequisite(transaction: Transaction, call: LifecycleCall) {
  const event = await transaction.callCenterEvent.findFirst({
    orderBy: { revision: "desc" },
    select: { data: true },
    where: {
      aggregateId: call.id,
      aggregateType: "CALL",
      practiceId: call.practiceId,
      type: ACTIVE_INBOUND_ROUTING_EVENT,
    },
  });
  if (!event?.data || typeof event.data !== "object" || Array.isArray(event.data)) {
    return undefined;
  }

  const data = event.data as Record<string, Prisma.JsonValue>;
  if (
    typeof data.answerCommandId !== "string" ||
    typeof data.startRingbackCommandId !== "string"
  ) {
    return undefined;
  }
  return {
    answerCommandId: data.answerCommandId,
    startRingbackCommandId: data.startRingbackCommandId,
  };
}

function commandType(intent: ActiveInboundLifecycleIntent) {
  if (intent.type === "START_VOICEMAIL") return "PLAY_VOICEMAIL_GREETING" as const;
  if (intent.type === "STOP_PLAYBACK" || intent.type === "HANGUP_LEG") {
    return intent.type;
  }
  return null;
}

function replacementSourceLegId(commands: readonly { arguments: Prisma.JsonValue }[]) {
  const value = commands[0]?.arguments;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const replacesLegId = (value as Record<string, Prisma.JsonValue>).replacesLegId;
  return typeof replacesLegId === "string" && replacesLegId.length > 0
    ? replacesLegId
    : null;
}

async function persistCommand(
  transaction: Transaction,
  call: LifecycleCall,
  intent: ActiveInboundLifecycleIntent,
  ringbackCommandId: string | null,
  stopPlaybackCommandId: string | null,
) {
  const type = commandType(intent);
  if (!type) return null;
  if (intent.type !== "START_VOICEMAIL" && !("legId" in intent)) return null;

  const customerLeg = call.legs.find((leg) => leg.kind === "CUSTOMER");
  const legId = intent.type === "START_VOICEMAIL" ? customerLeg?.id : intent.legId;
  if (!legId) return null;

  return transaction.callCenterCommand.upsert({
    create: {
      arguments:
        intent.type === "START_VOICEMAIL"
          ? { greeting: call.queue?.voicemailGreeting ?? "" }
          : {},
      callId: call.id,
      dependsOnCommandId:
        intent.type === "START_VOICEMAIL"
          ? stopPlaybackCommandId
          : intent.type === "STOP_PLAYBACK"
            ? ringbackCommandId
            : intent.type === "HANGUP_LEG" && legId === customerLeg?.id
              ? stopPlaybackCommandId
              : undefined,
      idempotencyKey: intent.idempotencyKey,
      legId,
      practiceId: call.practiceId,
      type,
    },
    select: { id: true, type: true },
    update: {},
    where: {
      practiceId_type_idempotencyKey: {
        idempotencyKey: intent.idempotencyKey,
        practiceId: call.practiceId,
        type,
      },
    },
  });
}

function reconciliationKey(
  call: LifecycleCall,
  decision: ActiveInboundLifecycleDecision,
) {
  switch (decision.disposition) {
    case "CONNECTED":
      return `${call.id}:connected:${decision.winningLegId}`;
    case "OVERFLOW": {
      const overflow = decision.intents.find(
        (intent) => intent.type === "ROUTE_OVERFLOW_QUEUE",
      );
      return `${call.id}:overflow:${call.queueId}:${overflow?.queueId ?? "missing"}`;
    }
    case "VOICEMAIL":
      return `${call.id}:voicemail:${call.queueId}`;
    case "ABANDONED":
      return `${call.id}:abandoned`;
    case "WAITING_FOR_AGENT":
      return `${call.id}:waiting:${call.queueId}`;
  }
}

async function persistEvent(
  transaction: Transaction,
  call: LifecycleCall,
  decision: ActiveInboundLifecycleDecision,
  now: Date,
) {
  const idempotencyKey = reconciliationKey(call, decision);
  return transaction.callCenterEvent.upsert({
    create: {
      aggregateId: call.id,
      aggregateType: "CALL",
      data: {
        disposition: decision.disposition,
        queueId: call.queueId,
        winningLegId: decision.winningLegId,
      },
      idempotencyKey,
      occurredAt: now,
      practiceId: call.practiceId,
      type: LIFECYCLE_EVENT,
    },
    select: { revision: true },
    update: {},
    where: {
      practiceId_type_idempotencyKey: {
        idempotencyKey,
        practiceId: call.practiceId,
        type: LIFECYCLE_EVENT,
      },
    },
  });
}

async function persistState(
  transaction: Transaction,
  call: LifecycleCall,
  decision: ActiveInboundLifecycleDecision,
  now: Date,
) {
  const common = { stateVersion: { increment: 1 } } as const;
  switch (decision.disposition) {
    case "CONNECTED":
      if (
        call.winningLegId === decision.winningLegId &&
        call.status === "CONNECTED" &&
        (decision.pendingReplacementLegIds.length > 0
          ? call.deadlineAt?.getTime() === decision.deadlineAt.getTime()
          : !call.deadlineAt)
      ) {
        return;
      }
      await transaction.callCenterCall.update({
        data: {
          ...common,
          answeredAt: call.answeredAt ?? now,
          deadlineAt:
            decision.pendingReplacementLegIds.length > 0 ? decision.deadlineAt : null,
          status: "CONNECTED",
          winningLegId: call.winningLegId ?? decision.winningLegId,
        },
        where: { id: call.id },
      });
      return;
    case "OVERFLOW": {
      const overflow = decision.intents.find(
        (intent) => intent.type === "ROUTE_OVERFLOW_QUEUE",
      );
      if (!overflow) return;
      await transaction.callCenterCall.update({
        data: {
          ...common,
          deadlineAt: null,
          queueDeadlineAt: decision.queueDeadlineAt,
          queueId: overflow.queueId,
          status: "QUEUED",
        },
        where: { id: call.id },
      });
      return;
    }
    case "VOICEMAIL":
      await transaction.callCenterCall.update({
        data: {
          ...common,
          deadlineAt: canonicalVoicemailGreetingDeadline(
            now,
            call.queue?.voicemailGreeting ?? "",
          ),
          status: "VOICEMAIL",
          voicemailStartedAt: now,
        },
        where: { id: call.id },
      });
      return;
    case "ABANDONED":
      await transaction.callCenterCall.update({
        data: {
          ...common,
          deadlineAt: null,
          endedAt: now,
          status: "ABANDONED",
        },
        where: { id: call.id },
      });
      return;
    case "WAITING_FOR_AGENT":
      if (call.deadlineAt && call.queueDeadlineAt) return;
      await transaction.callCenterCall.update({
        data: {
          ...common,
          deadlineAt: decision.deadlineAt,
          queueDeadlineAt: decision.queueDeadlineAt,
          status: decision.status,
        },
        where: { id: call.id },
      });
  }
}

async function persistMissedCallTask(
  transaction: Transaction,
  call: LifecycleCall,
  decision: ActiveInboundLifecycleDecision,
  sourceEventRevision: bigint,
) {
  const intent = decision.intents.find((candidate) => candidate.type === "CREATE_TASK");
  if (!intent) return;

  await persistCanonicalUnansweredTask(transaction, {
    callId: call.id,
    dedupeKey: intent.idempotencyKey,
    kind: intent.kind,
    practiceId: call.practiceId,
    sourceEventRevision,
  });
}

async function reconcileLockedCall(
  transaction: Transaction,
  input: ActiveInboundReconciliationInput,
  now: Date,
  routeQueueRound: RouteQueueRound,
  settleAgentLegs: SettleAgentLegs,
): Promise<ActiveInboundReconciliationSuccess> {
  const call = await loadLifecycleCall(transaction, input.practiceId, input.callId);
  // CANONICAL ownership is the durable admission decision. Mutable activation
  // switches may stop new admission, but must not strand an admitted call.
  if (
    !call ||
    call.direction !== "INBOUND" ||
    call.effectOwner !== "CANONICAL" ||
    !ACTIVE_STATUSES.includes(call.status as (typeof ACTIVE_STATUSES)[number]) ||
    !call.queue
  ) {
    return { callId: input.callId, commandIds: [], decision: null, status: "SKIPPED" };
  }

  const customerLeg = call.legs.find((leg) => leg.kind === "CUSTOMER");
  if (!customerLeg) {
    return { callId: input.callId, commandIds: [], decision: null, status: "SKIPPED" };
  }

  const overflowQueue = call.queue.overflowQueue;
  const validOverflowQueueId =
    overflowQueue?.enabled && overflowQueue.practiceId === call.practiceId
      ? overflowQueue.id
      : null;
  const visited = await visitedQueueIds(transaction, call);
  const decision = decideActiveInboundLifecycle({
    agentLegs: call.legs
      .filter((leg) => leg.kind === "AGENT")
      .map((leg) => ({
        id: leg.id,
        replacesLegId: replacementSourceLegId(leg.commands),
        status: leg.status,
      })),
    callId: call.id,
    customerLegId: customerLeg.id,
    deadlineAt: call.deadlineAt,
    // This runs only after a routing round has committed. If no live leg
    // remains, that round has no agent left to answer and must fall through.
    eligibleAgentCount: 0,
    now,
    processedBridgeLegId: input.processedBridgeLegId,
    queue: {
      id: call.queue.id,
      maxWaitSec: call.queue.maxWaitSec,
      overflowQueueId: validOverflowQueueId,
      ringTimeoutSec: call.queue.ringTimeoutSec,
      voicemailEnabled: call.queue.voicemailEnabled,
    },
    queueDeadlineAt: call.queueDeadlineAt,
    visitedQueueIds: visited,
    winningLegId: call.winningLegId,
  });

  const commandIds: string[] = [];
  const agentLegIds = new Set(
    call.legs.filter((leg) => leg.kind === "AGENT").map(({ id }) => id),
  );
  const releasedAgentLegs = decision.intents.filter(
    (intent): intent is Extract<ActiveInboundLifecycleIntent, { type: "HANGUP_LEG" }> =>
      intent.type === "HANGUP_LEG" && agentLegIds.has(intent.legId),
  );
  if (releasedAgentLegs.length > 0) {
    commandIds.push(
      ...(await settleAgentLegs(transaction, {
        callId: call.id,
        hangupIdempotencyKeys: Object.fromEntries(
          releasedAgentLegs.map((intent) => [intent.legId, intent.idempotencyKey]),
        ),
        legIds: releasedAgentLegs.map(({ legId }) => legId),
        now,
        reason:
          decision.disposition === "CONNECTED" ? "NON_WINNING_LEG" : "OFFER_TIMEOUT",
        terminalLegStatus: decision.disposition === "CONNECTED" ? "ENDED" : "FAILED",
      })),
    );
  }
  const prerequisite = await routingPrerequisite(transaction, call);
  const ringbackCommandId = prerequisite?.startRingbackCommandId ?? null;
  let stopPlaybackCommandId: string | null = null;
  for (const intent of decision.intents) {
    if (intent.type === "HANGUP_LEG" && agentLegIds.has(intent.legId)) continue;
    const command = await persistCommand(
      transaction,
      call,
      intent,
      ringbackCommandId,
      stopPlaybackCommandId,
    );
    if (!command) continue;
    commandIds.push(command.id);
    if (command.type === "STOP_PLAYBACK") stopPlaybackCommandId = command.id;
  }

  await persistState(transaction, call, decision, now);
  const event = await persistEvent(transaction, call, decision, now);
  await persistMissedCallTask(transaction, call, decision, event.revision);

  if (decision.disposition === "OVERFLOW") {
    const overflow = decision.intents.find(
      (intent) => intent.type === "ROUTE_OVERFLOW_QUEUE",
    );
    if (overflow) {
      await transaction.callCenterEvent.upsert({
        create: {
          aggregateId: call.id,
          aggregateType: "CALL",
          data: { fromQueueId: call.queue.id, queueId: overflow.queueId },
          idempotencyKey: `${call.id}:${call.queue.id}:${overflow.queueId}`,
          occurredAt: now,
          practiceId: call.practiceId,
          type: OVERFLOW_EVENT,
        },
        update: {},
        where: {
          practiceId_type_idempotencyKey: {
            idempotencyKey: `${call.id}:${call.queue.id}:${overflow.queueId}`,
            practiceId: call.practiceId,
            type: OVERFLOW_EVENT,
          },
        },
      });
      const routed = await routeQueueRound(
        transaction,
        {
          callId: call.id,
          practiceId: call.practiceId,
          prerequisite,
          routingKey: `overflow:${call.id}:${call.queue.id}:${overflow.queueId}`,
        },
        now,
      );
      if (!("status" in routed)) {
        commandIds.push(...routed.commandIds);
        if (routed.routed.length === 0) {
          const fallback = await reconcileLockedCall(
            transaction,
            { ...input, processedBridgeLegId: null },
            now,
            routeQueueRound,
            settleAgentLegs,
          );
          return {
            ...fallback,
            commandIds: [...commandIds, ...fallback.commandIds],
          };
        }
      }
    }
  }

  return { callId: call.id, commandIds, decision, status: "APPLIED" };
}

export class PrismaActiveInboundLifecycleStore implements ActiveInboundReconciliationStore {
  constructor(
    private readonly runTransaction: TransactionRunner = (operation) =>
      prisma.$transaction(operation),
    private readonly routeQueueRound: RouteQueueRound = routeActiveInboundCallInTransaction,
    private readonly settleAgentLegs: SettleAgentLegs = settleCanonicalCallLegs,
  ) {}

  reconcile(input: ActiveInboundReconciliationInput, now: Date) {
    return this.runTransaction(async (transaction) => {
      return reconcileActiveInboundCallInTransaction(
        transaction,
        input,
        now,
        this.routeQueueRound,
        this.settleAgentLegs,
      );
    });
  }

  async reconcileDue({ limit, now }: { limit: number; now: Date }) {
    const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
    const attemptedCallIds: string[] = [];
    const results: ActiveInboundReconciliationResult[] = [];

    while (results.length < boundedLimit) {
      const attempt: { selectedCall: DueCall | null } = { selectedCall: null };
      try {
        const result = await this.runTransaction(async (transaction) => {
          const excluded =
            attemptedCallIds.length === 0
              ? Prisma.sql``
              : Prisma.sql`AND call."id" NOT IN (${Prisma.join(attemptedCallIds)})`;
          const [call] = await transaction.$queryRaw<DueCall[]>(Prisma.sql`
            SELECT call."id" AS "callId", call."practiceId"
            FROM "call_center_call" AS call
            WHERE call."direction" = CAST('INBOUND' AS "CallCenterCallDirection")
              AND call."effectOwner" = CAST('CANONICAL' AS "CallCenterEffectOwner")
              AND (
                call."status" IN (
                  CAST('RECEIVED' AS "CallCenterCallStatus"),
                  CAST('QUEUED' AS "CallCenterCallStatus"),
                  CAST('RINGING' AS "CallCenterCallStatus")
                )
                OR (
                  call."status" = CAST('CONNECTED' AS "CallCenterCallStatus")
                  AND call."winningLegId" IS NOT NULL
                  AND EXISTS (
                    SELECT 1
                    FROM "call_center_call_leg" AS leg
                    JOIN "call_center_command" AS command
                      ON command."legId" = leg."id"
                    WHERE leg."callId" = call."id"
                      AND leg."status" IN (
                        CAST('CREATED' AS "CallCenterLegStatus"),
                        CAST('DIALING' AS "CallCenterLegStatus"),
                        CAST('RINGING' AS "CallCenterLegStatus"),
                        CAST('ANSWERED' AS "CallCenterLegStatus")
                      )
                      AND command."type" = CAST('DIAL_AGENT' AS "CallCenterCommandType")
                      AND command."arguments" ->> 'replacesLegId' = call."winningLegId"
                  )
                )
              )
              AND call."deadlineAt" <= ${now}
              ${excluded}
            ORDER BY call."deadlineAt" ASC, call."receivedAt" ASC, call."id" ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          `);
          if (!call) return null;

          attempt.selectedCall = call;
          return reconcileLockedCall(
            transaction,
            { ...call, processedBridgeLegId: null },
            now,
            this.routeQueueRound,
            this.settleAgentLegs,
          );
        });
        if (!result) break;

        attemptedCallIds.push(result.callId);
        results.push(result);
      } catch {
        const selectedCall = attempt.selectedCall;
        if (!selectedCall) throw new Error("ACTIVE_INBOUND_RECOVERY_SELECTION_FAILED");

        attemptedCallIds.push(selectedCall.callId);
        results.push({
          callId: selectedCall.callId,
          commandIds: [],
          decision: null,
          errorCode: "ACTIVE_INBOUND_RECONCILIATION_FAILED",
          status: "FAILED",
        });
      }
    }

    return results;
  }
}

export const prismaActiveInboundLifecycleStore = new PrismaActiveInboundLifecycleStore();

/** Reconciles one call inside the projector or planner's existing transaction. */
export async function reconcileActiveInboundCallInTransaction(
  transaction: Transaction,
  input: ActiveInboundReconciliationInput,
  now: Date,
  routeQueueRound: RouteQueueRound = routeActiveInboundCallInTransaction,
  settleAgentLegs: SettleAgentLegs = settleCanonicalCallLegs,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "practiceId" = ${input.practiceId} AND "id" = ${input.callId} FOR UPDATE`,
  );
  return reconcileLockedCall(transaction, input, now, routeQueueRound, settleAgentLegs);
}
