import { Prisma } from "@/generated/prisma/client";

type Transaction = Prisma.TransactionClient;

const LIVE_AGENT_LEG_STATUSES = [
  "CREATED",
  "DIALING",
  "RINGING",
  "ANSWERED",
  "BRIDGED",
] as const;

/** Clears the transfer deadline once no live replacement still owns it. */
export async function clearSettledTransferDeadline(
  transaction: Transaction,
  callId: string,
) {
  const call = await transaction.callCenterCall.findUnique({
    select: { deadlineAt: true, status: true, winningLegId: true },
    where: { id: callId },
  });
  if (call?.status !== "CONNECTED" || !call.deadlineAt || !call.winningLegId) {
    return false;
  }

  const replacement = await transaction.callCenterCallLeg.findFirst({
    select: { id: true },
    where: {
      callId,
      commands: {
        some: {
          arguments: { equals: call.winningLegId, path: ["replacesLegId"] },
          type: "DIAL_AGENT",
        },
      },
      kind: "AGENT",
      status: { in: [...LIVE_AGENT_LEG_STATUSES] },
    },
  });
  if (replacement) return false;

  const updated = await transaction.callCenterCall.updateMany({
    data: { deadlineAt: null, stateVersion: { increment: 1 } },
    where: {
      deadlineAt: call.deadlineAt,
      id: callId,
      status: "CONNECTED",
      winningLegId: call.winningLegId,
    },
  });
  return updated.count === 1;
}
