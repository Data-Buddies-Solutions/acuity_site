import { Prisma } from "@/generated/prisma/client";
import { canonicalVoicemailRecordingDeadline } from "@/lib/call-center/domain/canonical-voicemail-lifecycle";
import { releaseAgentSessionReservation } from "@/lib/call-center/infrastructure/prisma-agent-session-reservation";
import { appendCommandOperationStatus } from "@/lib/call-center/infrastructure/prisma-command-operation-events";
import { persistCanonicalVoicemailTask } from "@/lib/call-center/infrastructure/prisma-canonical-voicemail";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
export type CanonicalVoicemailRecoveryTransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

type DueCall = { callId: string; practiceId: string };
type RecoveryOutcome = {
  callId: string;
  commandIds: string[];
  outcome: "FINALIZED" | "RECORDING_STARTED";
};

const LIVE_LEG_STATUSES = [
  "CREATED",
  "DIALING",
  "RINGING",
  "ANSWERED",
  "BRIDGED",
] as const;
const UNSETTLED_COMMAND_STATUSES = ["PENDING", "SENDING", "SENT"] as const;
const RECORDING_TIMEOUT = "VOICEMAIL_RECORDING_CALLBACK_TIMEOUT";
const RECOVERY_EVENT = "CALL_VOICEMAIL_RECOVERY_REQUIRED";

async function failRecordingCommand(
  transaction: Transaction,
  command: {
    attemptCount: number;
    id: string;
    nextAttemptAt: Date | null;
    status: string;
  } | null,
  now: Date,
) {
  if (
    !command ||
    (!UNSETTLED_COMMAND_STATUSES.includes(
      command.status as (typeof UNSETTLED_COMMAND_STATUSES)[number],
    ) &&
      !(command.status === "FAILED" && command.nextAttemptAt))
  ) {
    return;
  }
  const failed = await transaction.callCenterCommand.updateMany({
    data: {
      errorCode: RECORDING_TIMEOUT,
      nextAttemptAt: null,
      status: "FAILED",
      updatedAt: now,
    },
    where: {
      id: command.id,
      nextAttemptAt: command.nextAttemptAt,
      status: command.status as "PENDING" | "SENDING" | "SENT" | "FAILED",
    },
  });
  if (failed.count === 1) {
    await appendCommandOperationStatus(transaction, {
      attemptCount: command.attemptCount,
      commandId: command.id,
      now,
      status: "FAILED",
    });
  }
}

async function recoverLockedCall(
  transaction: Transaction,
  due: DueCall,
  now: Date,
): Promise<RecoveryOutcome | null> {
  const call = await transaction.callCenterCall.findFirst({
    select: {
      deadlineAt: true,
      endedAt: true,
      fromPhone: true,
      id: true,
      legs: {
        select: {
          agentSessionId: true,
          id: true,
          kind: true,
          providerCallControlId: true,
          status: true,
        },
      },
      practiceId: true,
    },
    where: {
      deadlineAt: { lte: now },
      direction: "INBOUND",
      effectOwner: "CANONICAL",
      id: due.callId,
      practiceId: due.practiceId,
      status: "VOICEMAIL",
    },
  });
  if (!call) return null;

  const commands = await transaction.callCenterCommand.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      attemptCount: true,
      id: true,
      nextAttemptAt: true,
      status: true,
      type: true,
    },
    where: {
      callId: call.id,
      type: { in: ["PLAY_VOICEMAIL_GREETING", "START_RECORDING"] },
    },
  });
  const greeting = commands.find(({ type }) => type === "PLAY_VOICEMAIL_GREETING");
  const recording = commands.find(({ type }) => type === "START_RECORDING");
  const customerLeg = call.legs.find(({ kind }) => kind === "CUSTOMER");
  const customerIsLive = Boolean(
    customerLeg &&
    LIVE_LEG_STATUSES.includes(
      customerLeg.status as (typeof LIVE_LEG_STATUSES)[number],
    ) &&
    customerLeg.providerCallControlId,
  );

  if (
    !recording &&
    greeting &&
    ["SENT", "CONFIRMED"].includes(greeting.status) &&
    customerLeg &&
    customerIsLive
  ) {
    const command = await transaction.callCenterCommand.upsert({
      create: {
        arguments: {},
        callId: call.id,
        dependsOnCommandId: greeting.id,
        idempotencyKey: `voicemail-recording:${greeting.id}`,
        legId: customerLeg.id,
        practiceId: call.practiceId,
        type: "START_RECORDING",
      },
      select: { id: true },
      update: {},
      where: {
        practiceId_type_idempotencyKey: {
          idempotencyKey: `voicemail-recording:${greeting.id}`,
          practiceId: call.practiceId,
          type: "START_RECORDING",
        },
      },
    });
    const advanced = await transaction.callCenterCall.updateMany({
      data: {
        deadlineAt: canonicalVoicemailRecordingDeadline(now),
        stateVersion: { increment: 1 },
      },
      where: { deadlineAt: call.deadlineAt, id: call.id, status: "VOICEMAIL" },
    });
    if (advanced.count !== 1) return null;
    await transaction.callCenterEvent.upsert({
      create: {
        aggregateId: call.id,
        aggregateType: "CALL",
        data: { commandId: command.id, reason: "GREETING_CALLBACK_TIMEOUT" },
        idempotencyKey: `voicemail-greeting-recovery:${call.id}`,
        occurredAt: now,
        practiceId: call.practiceId,
        type: "CALL_VOICEMAIL_RECORDING_RECOVERED",
      },
      select: { revision: true },
      update: {},
      where: {
        practiceId_type_idempotencyKey: {
          idempotencyKey: `voicemail-greeting-recovery:${call.id}`,
          practiceId: call.practiceId,
          type: "CALL_VOICEMAIL_RECORDING_RECOVERED",
        },
      },
    });
    return { callId: call.id, commandIds: [command.id], outcome: "RECORDING_STARTED" };
  }

  await failRecordingCommand(transaction, recording ?? null, now);
  const commandIds: string[] = [];
  if (customerLeg && customerIsLive) {
    const hangup = await transaction.callCenterCommand.upsert({
      create: {
        arguments: {},
        callId: call.id,
        idempotencyKey: `voicemail-recovery-hangup:${call.id}`,
        legId: customerLeg.id,
        practiceId: call.practiceId,
        type: "HANGUP_LEG",
      },
      select: { id: true },
      update: {},
      where: {
        practiceId_type_idempotencyKey: {
          idempotencyKey: `voicemail-recovery-hangup:${call.id}`,
          practiceId: call.practiceId,
          type: "HANGUP_LEG",
        },
      },
    });
    commandIds.push(hangup.id);
  }

  const finalized = await transaction.callCenterCall.updateMany({
    data: {
      deadlineAt: null,
      endedAt: call.endedAt ?? now,
      stateVersion: { increment: 1 },
    },
    where: { deadlineAt: call.deadlineAt, id: call.id, status: "VOICEMAIL" },
  });
  if (finalized.count !== 1) return null;

  const agentLegs = call.legs.filter(
    ({ kind, status }) =>
      kind === "AGENT" &&
      LIVE_LEG_STATUSES.includes(status as (typeof LIVE_LEG_STATUSES)[number]),
  );
  if (agentLegs.length > 0) {
    await transaction.callCenterCallLeg.updateMany({
      data: { endedAt: now, errorCode: RECORDING_TIMEOUT, status: "FAILED" },
      where: { id: { in: agentLegs.map(({ id }) => id) } },
    });
  }
  for (const sessionId of new Set(
    agentLegs
      .map(({ agentSessionId }) => agentSessionId)
      .filter((id): id is string => Boolean(id)),
  )) {
    await releaseAgentSessionReservation(transaction, {
      agentSessionId: sessionId,
      callId: call.id,
      idempotencyKey: `voicemail-recovery:${call.id}:${sessionId}`,
      now,
      reason: RECORDING_TIMEOUT,
    });
  }

  const event = await transaction.callCenterEvent.upsert({
    create: {
      aggregateId: call.id,
      aggregateType: "CALL",
      data: { errorCode: RECORDING_TIMEOUT },
      idempotencyKey: `voicemail-recovery-required:${call.id}`,
      occurredAt: now,
      practiceId: call.practiceId,
      type: RECOVERY_EVENT,
    },
    select: { revision: true },
    update: {},
    where: {
      practiceId_type_idempotencyKey: {
        idempotencyKey: `voicemail-recovery-required:${call.id}`,
        practiceId: call.practiceId,
        type: RECOVERY_EVENT,
      },
    },
  });
  await persistCanonicalVoicemailTask(transaction, {
    callId: call.id,
    callerPhone: call.fromPhone,
    practiceId: call.practiceId,
    sourceEventRevision: event.revision,
  });
  return { callId: call.id, commandIds, outcome: "FINALIZED" };
}

export class PrismaCanonicalVoicemailRecovery {
  constructor(
    private readonly runTransaction: CanonicalVoicemailRecoveryTransactionRunner = (
      operation,
    ) => prisma.$transaction(operation),
  ) {}

  async recoverDue(now: Date, limit: number) {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const outcomes: RecoveryOutcome[] = [];
    while (outcomes.length < boundedLimit) {
      const outcome = await this.runTransaction(async (transaction) => {
        const [due] = await transaction.$queryRaw<DueCall[]>(Prisma.sql`
          SELECT call."id" AS "callId", call."practiceId"
          FROM "call_center_call" AS call
          WHERE call."direction" = CAST('INBOUND' AS "CallCenterCallDirection")
            AND call."effectOwner" = CAST('CANONICAL' AS "CallCenterEffectOwner")
            AND call."status" = CAST('VOICEMAIL' AS "CallCenterCallStatus")
            AND call."deadlineAt" <= ${now}
          ORDER BY call."deadlineAt" ASC, call."id" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);
        return due ? recoverLockedCall(transaction, due, now) : null;
      });
      if (!outcome) break;
      outcomes.push(outcome);
    }
    return {
      callIds: outcomes.map(({ callId }) => callId),
      commandIds: outcomes.flatMap(({ commandIds }) => commandIds),
      finalized: outcomes.filter(({ outcome }) => outcome === "FINALIZED").length,
      recordingStarted: outcomes.filter(({ outcome }) => outcome === "RECORDING_STARTED")
        .length,
      selected: outcomes.length,
    };
  }
}

export const prismaCanonicalVoicemailRecovery = new PrismaCanonicalVoicemailRecovery();
