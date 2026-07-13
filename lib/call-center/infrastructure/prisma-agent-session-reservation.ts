import { Prisma } from "@/generated/prisma/client";

type Transaction = Prisma.TransactionClient;

async function lockAgentSession(transaction: Transaction, agentSessionId: string) {
  const target = await transaction.callCenterAgentSession.findUnique({
    select: { endpointId: true },
    where: { id: agentSessionId },
  });
  if (!target) return false;
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_endpoint" WHERE "id" = ${target.endpointId} FOR UPDATE`,
  );
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_agent_session" WHERE "id" = ${agentSessionId} FOR UPDATE`,
  );
  return true;
}

export async function promoteAgentSessionOffer(
  transaction: Transaction,
  input: {
    agentSessionId: string;
    callId: string;
    idempotencyKey: string;
    now: Date;
  },
) {
  if (!(await lockAgentSession(transaction, input.agentSessionId))) return null;
  const session = await transaction.callCenterAgentSession.findUnique({
    select: {
      currentCallId: true,
      id: true,
      offeredCallId: true,
      practiceId: true,
      presence: true,
      stateVersion: true,
    },
    where: { id: input.agentSessionId },
  });
  if (!session) return null;
  if (
    session.currentCallId === input.callId &&
    session.offeredCallId === null &&
    session.presence === "BUSY"
  ) {
    return session;
  }
  if (session.currentCallId !== null || session.offeredCallId !== input.callId) {
    return null;
  }

  const updated = await transaction.callCenterAgentSession.update({
    data: {
      currentCallId: input.callId,
      offeredCallId: null,
      presence: "BUSY",
      readyAt: null,
      stateVersion: { increment: 1 },
    },
    select: { stateVersion: true },
    where: { id: session.id },
  });
  await transaction.callCenterEvent.create({
    data: {
      aggregateId: session.id,
      aggregateType: "AGENT_SESSION",
      data: {
        callId: input.callId,
        presence: "BUSY",
        stateVersion: updated.stateVersion,
      },
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.now,
      practiceId: session.practiceId,
      type: "AGENT_SESSION_BUSY",
    },
  });
  return updated;
}

export async function releaseAgentSessionReservation(
  transaction: Transaction,
  input: {
    actorUserId?: string | null;
    agentSessionId: string;
    callId: string;
    idempotencyKey: string;
    now: Date;
    reason: string;
  },
) {
  if (!(await lockAgentSession(transaction, input.agentSessionId))) return null;
  const session = await transaction.callCenterAgentSession.findUnique({
    select: {
      audioReady: true,
      connectionState: true,
      currentCallId: true,
      id: true,
      leaseExpiresAt: true,
      microphoneReady: true,
      offeredCallId: true,
      practiceId: true,
      presence: true,
      readyAt: true,
      stateVersion: true,
    },
    where: { id: input.agentSessionId },
  });
  if (
    !session ||
    (session.currentCallId !== input.callId && session.offeredCallId !== input.callId)
  ) {
    return null;
  }

  const ready =
    session.connectionState === "READY" &&
    session.microphoneReady &&
    session.audioReady &&
    session.leaseExpiresAt > input.now;
  const presence = !ready
    ? "PAUSED"
    : session.presence === "BUSY" || session.offeredCallId === input.callId
      ? "AVAILABLE"
      : session.presence;
  const updated = await transaction.callCenterAgentSession.update({
    data: {
      currentCallId:
        session.currentCallId === input.callId ? null : session.currentCallId,
      offeredCallId:
        session.offeredCallId === input.callId ? null : session.offeredCallId,
      presence,
      readyAt: presence === "AVAILABLE" ? (session.readyAt ?? input.now) : null,
      stateVersion: { increment: 1 },
    },
    select: { stateVersion: true },
    where: { id: session.id },
  });
  await transaction.callCenterEvent.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      aggregateId: session.id,
      aggregateType: "AGENT_SESSION",
      data: {
        callId: input.callId,
        presence,
        reason: input.reason,
        stateVersion: updated.stateVersion,
      },
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.now,
      practiceId: session.practiceId,
      type: "AGENT_SESSION_CALL_RELEASED",
    },
  });
  return updated;
}
