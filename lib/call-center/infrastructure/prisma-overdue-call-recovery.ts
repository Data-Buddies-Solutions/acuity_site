import { Prisma } from "@/generated/prisma/client";
import type { DueActiveCall } from "@/lib/call-center/application/drain-active-calls";
import { reconcileActiveInboundCallInTransaction } from "@/lib/call-center/infrastructure/prisma-active-inbound-lifecycle-store";
import { persistCanonicalUnansweredTask } from "@/lib/call-center/infrastructure/prisma-canonical-voicemail";
import { lockCallCenterPractice } from "@/lib/call-center/infrastructure/prisma-call-center-practice-lock";
import { settleCanonicalCallLegs } from "@/lib/call-center/infrastructure/prisma-call-resource-settlement";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
type SettleCallLegs = typeof settleCanonicalCallLegs;
const RECOVERABLE_STATUSES = ["RECEIVED", "QUEUED", "RINGING", "VOICEMAIL"] as const;

function isDue(
  call: { deadlineAt: Date | null; hardDeadlineAt: Date | null },
  now: Date,
) {
  return [call.deadlineAt, call.hardDeadlineAt].some(
    (deadline) => deadline !== null && deadline <= now,
  );
}

export async function recoverDueOutboundCallInTransaction(
  transaction: Transaction,
  input: DueActiveCall,
  now: Date,
  settleCallLegs: SettleCallLegs = settleCanonicalCallLegs,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "practiceId" = ${input.practiceId} AND "id" = ${input.callId} FOR UPDATE`,
  );
  const call = await transaction.callCenterCall.findFirst({
    select: {
      deadlineAt: true,
      direction: true,
      hardDeadlineAt: true,
      id: true,
      practiceId: true,
      status: true,
    },
    where: { id: input.callId, practiceId: input.practiceId },
  });
  if (
    !call ||
    call.direction !== "OUTBOUND" ||
    !["RECEIVED", "QUEUED", "RINGING"].includes(call.status) ||
    !isDue(call, now)
  ) {
    return { status: "SKIPPED" as const };
  }

  const commandIds = await settleCallLegs(transaction, {
    callId: call.id,
    includeCustomerLegs: true,
    now,
    reason: "OUTBOUND_DEADLINE_EXPIRED",
    terminalLegStatus: "FAILED",
  });
  await transaction.callCenterCall.update({
    data: {
      deadlineAt: null,
      endedAt: now,
      stateVersion: { increment: 1 },
      status: "FAILED",
    },
    where: { id: call.id },
  });
  await transaction.callCenterEvent.upsert({
    create: {
      aggregateId: call.id,
      aggregateType: "CALL",
      data: { commandIds, previousStatus: call.status },
      idempotencyKey: call.id,
      occurredAt: now,
      practiceId: call.practiceId,
      type: "CALL_OUTBOUND_DEADLINE_EXPIRED",
    },
    update: {},
    where: {
      practiceId_type_idempotencyKey: {
        idempotencyKey: call.id,
        practiceId: call.practiceId,
        type: "CALL_OUTBOUND_DEADLINE_EXPIRED",
      },
    },
  });
  return { status: "APPLIED" as const };
}

export async function forceTerminalDueInboundCallInTransaction(
  transaction: Transaction,
  input: DueActiveCall,
  now: Date,
  reason: "INBOUND_RECOVERY_UNRECOVERABLE" | "VOICEMAIL_DEADLINE_EXPIRED",
  settleCallLegs: SettleCallLegs = settleCanonicalCallLegs,
) {
  const call = await transaction.callCenterCall.findFirst({
    select: {
      deadlineAt: true,
      direction: true,
      hardDeadlineAt: true,
      id: true,
      practiceId: true,
      status: true,
    },
    where: { id: input.callId, practiceId: input.practiceId },
  });
  if (
    !call ||
    call.direction !== "INBOUND" ||
    !RECOVERABLE_STATUSES.includes(
      call.status as (typeof RECOVERABLE_STATUSES)[number],
    ) ||
    !isDue(call, now)
  ) {
    return { status: "SKIPPED" as const };
  }

  const commandIds = await settleCallLegs(transaction, {
    callId: call.id,
    includeCustomerLegs: true,
    now,
    reason,
    terminalLegStatus: "FAILED",
  });
  await transaction.callCenterCall.update({
    data: {
      deadlineAt: null,
      endedAt: now,
      hardDeadlineAt: null,
      stateVersion: { increment: 1 },
      status: reason === "VOICEMAIL_DEADLINE_EXPIRED" ? "ABANDONED" : "FAILED",
    },
    where: { id: call.id },
  });
  const event = await transaction.callCenterEvent.upsert({
    create: {
      aggregateId: call.id,
      aggregateType: "CALL",
      data: { commandIds, previousStatus: call.status, reason },
      idempotencyKey: call.id,
      occurredAt: now,
      practiceId: call.practiceId,
      type:
        reason === "VOICEMAIL_DEADLINE_EXPIRED"
          ? "CALL_VOICEMAIL_DEADLINE_EXPIRED"
          : "CALL_INBOUND_RECOVERY_FORCED_TERMINAL",
    },
    update: {},
    where: {
      practiceId_type_idempotencyKey: {
        idempotencyKey: call.id,
        practiceId: call.practiceId,
        type:
          reason === "VOICEMAIL_DEADLINE_EXPIRED"
            ? "CALL_VOICEMAIL_DEADLINE_EXPIRED"
            : "CALL_INBOUND_RECOVERY_FORCED_TERMINAL",
      },
    },
  });
  await persistCanonicalUnansweredTask(transaction, {
    callId: call.id,
    dedupeKey:
      reason === "VOICEMAIL_DEADLINE_EXPIRED"
        ? `voicemail:${call.id}`
        : `active:${call.id}:task:missed-call`,
    kind: "MISSED_CALL",
    practiceId: call.practiceId,
    sourceEventRevision: event.revision,
  });
  return { status: "APPLIED" as const };
}

export const prismaOverdueCallBacklog = {
  async listDue(limit: number, now: Date) {
    const calls = await prisma.callCenterCall.findMany({
      orderBy: [{ updatedAt: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
      select: { direction: true, id: true, practiceId: true, status: true },
      take: limit,
      where: {
        OR: [{ deadlineAt: { lte: now } }, { hardDeadlineAt: { lte: now } }],
        status: { in: [...RECOVERABLE_STATUSES] },
      },
    });
    return calls.map(({ direction, id, practiceId, status }) => ({
      callId: id,
      direction,
      practiceId,
      status: status as DueActiveCall["status"],
    }));
  },
  async recordFailure(call: DueActiveCall, now: Date) {
    await prisma.callCenterCall.updateMany({
      data: { updatedAt: now },
      where: {
        id: call.callId,
        practiceId: call.practiceId,
        status: { in: [...RECOVERABLE_STATUSES] },
      },
    });
  },
};

export function recoverDueActiveCall(input: DueActiveCall, now: Date) {
  return prisma.$transaction(async (transaction) => {
    await lockCallCenterPractice(transaction, input.practiceId);
    if (input.direction === "OUTBOUND") {
      return recoverDueOutboundCallInTransaction(transaction, input, now);
    }
    if (input.status === "VOICEMAIL") {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "practiceId" = ${input.practiceId} AND "id" = ${input.callId} FOR UPDATE`,
      );
      return forceTerminalDueInboundCallInTransaction(
        transaction,
        input,
        now,
        "VOICEMAIL_DEADLINE_EXPIRED",
      );
    }
    const result = await reconcileActiveInboundCallInTransaction(
      transaction,
      { ...input, processedBridgeLegId: null },
      now,
    );
    if (result.status === "APPLIED") return result;
    return forceTerminalDueInboundCallInTransaction(
      transaction,
      input,
      now,
      "INBOUND_RECOVERY_UNRECOVERABLE",
    );
  });
}
