import { Prisma } from "@/generated/prisma/client";

type Transaction = Prisma.TransactionClient;

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
  const target = await transaction.callCenterAgentSession.findUnique({
    select: { endpointId: true },
    where: { id: input.agentSessionId },
  });
  if (!target) return null;
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_endpoint" WHERE "id" = ${target.endpointId} FOR UPDATE`,
  );
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_agent_session" WHERE "id" = ${input.agentSessionId} FOR UPDATE`,
  );
  const session = await transaction.callCenterAgentSession.findUnique({
    select: {
      audioReady: true,
      connectionState: true,
      currentCallId: true,
      id: true,
      leaseExpiresAt: true,
      microphoneReady: true,
      practiceId: true,
      presence: true,
      stateVersion: true,
    },
    where: { id: input.agentSessionId },
  });
  if (!session || session.currentCallId !== input.callId) return null;

  const ready =
    session.connectionState === "READY" &&
    session.microphoneReady &&
    session.audioReady &&
    session.leaseExpiresAt > input.now;
  const presence =
    session.presence === "BUSY" ? (ready ? "AVAILABLE" : "PAUSED") : session.presence;
  const updated = await transaction.callCenterAgentSession.update({
    data: {
      currentCallId: null,
      presence,
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
