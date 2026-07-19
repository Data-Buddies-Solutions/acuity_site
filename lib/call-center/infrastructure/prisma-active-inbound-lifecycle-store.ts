import { Prisma } from "@/generated/prisma/client";
import type {
  ActiveInboundReconciliationInput,
  ActiveInboundReconciliationSuccess,
} from "@/lib/call-center/application/reconcile-active-inbound";
import { ACTIVE_INBOUND_ROUTING_EVENT } from "@/lib/call-center/application/active-inbound-routing";
import {
  decideActiveInboundLifecycle,
  type ActiveInboundLifecycleDecision,
  type ActiveInboundLifecycleIntent,
} from "@/lib/call-center/domain/active-inbound-lifecycle";
import { canonicalVoicemailGreetingDeadline } from "@/lib/call-center/domain/canonical-voicemail-lifecycle";
import { persistCanonicalUnansweredTask } from "@/lib/call-center/infrastructure/prisma-canonical-voicemail";
import { settleCanonicalCallLegs } from "@/lib/call-center/infrastructure/prisma-call-resource-settlement";

type Transaction = Prisma.TransactionClient;

const ACTIVE_STATUSES = ["RECEIVED", "QUEUED", "RINGING", "CONNECTED"] as const;
const LIVE_LEG_STATUSES = [
  "CREATED",
  "DIALING",
  "RINGING",
  "ANSWERED",
  "BRIDGED",
] as const;
const LIFECYCLE_EVENT = "CALL_ACTIVE_LIFECYCLE_RECONCILED";

type SettleAgentLegs = typeof settleCanonicalCallLegs;

type LifecycleCall = NonNullable<Awaited<ReturnType<typeof loadLifecycleCall>>>;

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
      id: true,
      legs: {
        select: {
          id: true,
          kind: true,
          status: true,
        },
      },
      practiceId: true,
      queue: {
        select: {
          id: true,
          voicemailEnabled: true,
          voicemailGreeting: true,
        },
      },
      queueId: true,
      stateVersion: true,
      status: true,
      winningLegId: true,
    },
    where: { id: callId, practiceId },
  });
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
  const ringback = await transaction.callCenterCommand.findUnique({
    select: { status: true },
    where: { id: data.startRingbackCommandId },
  });
  return {
    answerCommandId: data.answerCommandId,
    startRingbackCommandId:
      ringback?.status === "FAILED" ? null : data.startRingbackCommandId,
  };
}

function commandType(intent: ActiveInboundLifecycleIntent) {
  if (intent.type === "START_VOICEMAIL") return "PLAY_VOICEMAIL_GREETING" as const;
  if (intent.type === "STOP_PLAYBACK" || intent.type === "HANGUP_LEG") {
    return intent.type;
  }
  return null;
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
        !call.deadlineAt
      ) {
        return;
      }
      await transaction.callCenterCall.update({
        data: {
          ...common,
          answeredAt: call.answeredAt ?? now,
          deadlineAt: null,
          status: "CONNECTED",
          winningLegId: call.winningLegId ?? decision.winningLegId,
        },
        where: { id: call.id },
      });
      return;
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
      if (call.deadlineAt) return;
      await transaction.callCenterCall.update({
        data: {
          ...common,
          deadlineAt: decision.deadlineAt,
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
  settleAgentLegs: SettleAgentLegs,
): Promise<ActiveInboundReconciliationSuccess> {
  const call = await loadLifecycleCall(transaction, input.practiceId, input.callId);
  if (
    !call ||
    call.direction !== "INBOUND" ||
    !ACTIVE_STATUSES.includes(call.status as (typeof ACTIVE_STATUSES)[number]) ||
    !call.queue
  ) {
    return { callId: input.callId, commandIds: [], decision: null, status: "SKIPPED" };
  }

  const customerLeg = call.legs.find((leg) => leg.kind === "CUSTOMER");
  if (!customerLeg) {
    return { callId: input.callId, commandIds: [], decision: null, status: "SKIPPED" };
  }

  const decision = decideActiveInboundLifecycle({
    agentLegs: call.legs
      .filter((leg) => leg.kind === "AGENT")
      .map((leg) => ({ id: leg.id, status: leg.status })),
    callId: call.id,
    customerLegId: customerLeg.id,
    deadlineAt: call.deadlineAt,
    now,
    processedBridgeLegId: input.processedBridgeLegId,
    queue: {
      id: call.queue.id,
      voicemailEnabled: call.queue.voicemailEnabled,
    },
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

  return { callId: call.id, commandIds, decision, status: "APPLIED" };
}

/** Reconciles one call inside the projector or planner's existing transaction. */
export async function reconcileActiveInboundCallInTransaction(
  transaction: Transaction,
  input: ActiveInboundReconciliationInput,
  now: Date,
  settleAgentLegs: SettleAgentLegs = settleCanonicalCallLegs,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "practiceId" = ${input.practiceId} AND "id" = ${input.callId} FOR UPDATE`,
  );
  return reconcileLockedCall(transaction, input, now, settleAgentLegs);
}
