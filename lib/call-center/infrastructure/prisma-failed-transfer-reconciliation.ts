import { Prisma } from "@/generated/prisma/client";

type Transaction = Prisma.TransactionClient;
type SettleCompletedCall = (
  transaction: Transaction,
  input: {
    callId: string;
    includeCustomerLegs: true;
    now: Date;
    reason: string;
  },
) => Promise<string[]>;

function sourceLegId(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).sourceLegId;
  return typeof id === "string" && id ? id : null;
}

/**
 * Completes a call when its source hung up while a transfer was pending and the
 * transfer subsequently failed. Callers already hold the canonical call lock.
 */
export async function reconcileFailedTransferWithEndedSource(
  transaction: Transaction,
  input: { commandId: string; now: Date },
  settleCompletedCall: SettleCompletedCall,
) {
  const command = await transaction.callCenterCommand.findUnique({
    select: {
      arguments: true,
      callId: true,
      practiceId: true,
      status: true,
      type: true,
    },
    where: { id: input.commandId },
  });
  const sourceId = command ? sourceLegId(command.arguments) : null;
  if (
    !command ||
    command.type !== "TRANSFER_AGENT" ||
    command.status !== "FAILED" ||
    !sourceId
  ) {
    return { commandIds: [], completed: false };
  }

  const call = await transaction.callCenterCall.findFirst({
    select: {
      id: true,
      direction: true,
      status: true,
      winningLegId: true,
      legs: {
        select: { endedAt: true, status: true },
        take: 1,
        where: { id: sourceId },
      },
    },
    where: { id: command.callId, practiceId: command.practiceId },
  });
  const source = call?.legs[0];
  if (
    !call ||
    call.status !== "CONNECTED" ||
    (call.winningLegId !== sourceId &&
      !(call.direction === "OUTBOUND" && call.winningLegId === null)) ||
    !source ||
    !["ENDED", "FAILED"].includes(source.status)
  ) {
    return { commandIds: [], completed: false };
  }

  const completed = await transaction.callCenterCall.updateMany({
    data: {
      endedAt: source.endedAt ?? input.now,
      stateVersion: { increment: 1 },
      status: "COMPLETED",
    },
    where: {
      id: call.id,
      status: "CONNECTED",
      ...(call.direction === "OUTBOUND"
        ? { OR: [{ winningLegId: sourceId }, { winningLegId: null }] }
        : { winningLegId: sourceId }),
    },
  });
  if (completed.count !== 1) return { commandIds: [], completed: false };

  const commandIds = await settleCompletedCall(transaction, {
    callId: call.id,
    includeCustomerLegs: true,
    now: input.now,
    reason: "TRANSFER_FAILED_AFTER_SOURCE_ENDED",
  });
  return { commandIds, completed: true };
}
