import { randomUUID } from "crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type {
  AgentSessionActor,
  AgentSessionEndpoint,
  AgentSessionEvent,
  AgentSessionRecord,
  AgentSessionStore,
  AgentSessionTransaction,
  AgentSessionUpdate,
} from "@/lib/call-center/application/agent-sessions";
import { prisma } from "@/lib/prisma";

const sessionSelect = {
  audioReady: true,
  browserSessionId: true,
  connectionState: true,
  currentCallId: true,
  endpointId: true,
  id: true,
  lastHeartbeatAt: true,
  leaseExpiresAt: true,
  microphoneReady: true,
  practiceId: true,
  presence: true,
  readyAt: true,
  stateVersion: true,
  userId: true,
} satisfies Prisma.CallCenterAgentSessionSelect;

type PersistedAgentSession = Prisma.CallCenterAgentSessionGetPayload<{
  select: typeof sessionSelect;
}>;

function toAgentSessionRecord(session: PersistedAgentSession): AgentSessionRecord {
  const { browserSessionId, ...record } = session;
  return { ...record, clientInstanceId: browserSessionId };
}

type Database = Pick<PrismaClient, "$transaction">;
type TransactionClient = Prisma.TransactionClient;

class PrismaAgentSessionTransaction implements AgentSessionTransaction {
  constructor(private readonly transaction: TransactionClient) {}

  async appendEvent(event: AgentSessionEvent) {
    await this.transaction.callCenterEvent.create({
      data: {
        actorUserId: event.actorUserId,
        aggregateId: event.aggregateId,
        aggregateType: "AGENT_SESSION",
        data: event.data,
        occurredAt: event.occurredAt,
        practiceId: event.practiceId,
        type: event.type,
      },
    });
  }

  async closeExpiredSessions(endpointId: string, now: Date) {
    const expired = await this.transaction.callCenterAgentSession.findMany({
      select: sessionSelect,
      where: {
        connectionState: { not: "CLOSED" },
        endpointId,
        leaseExpiresAt: { lte: now },
        presence: { not: "OFFLINE" },
      },
    });

    const closed = await Promise.all(
      expired.map((session) =>
        this.transaction.callCenterAgentSession.update({
          data: {
            audioReady: false,
            connectionState: "CLOSED",
            lastHeartbeatAt: now,
            leaseExpiresAt: now,
            microphoneReady: false,
            presence: "OFFLINE",
            readyAt: null,
            stateVersion: { increment: 1 },
          },
          select: sessionSelect,
          where: { id: session.id },
        }),
      ),
    );

    return closed.map(toAgentSessionRecord);
  }

  async createSession(input: AgentSessionRecord) {
    const { clientInstanceId, ...data } = input;
    const session = await this.transaction.callCenterAgentSession.create({
      data: { ...data, browserSessionId: clientInstanceId },
      select: sessionSelect,
    });
    return toAgentSessionRecord(session);
  }

  async findActiveSession(endpointId: string) {
    const session = await this.transaction.callCenterAgentSession.findFirst({
      select: sessionSelect,
      where: {
        connectionState: { not: "CLOSED" },
        endpointId,
        presence: { not: "OFFLINE" },
      },
    });
    return session ? toAgentSessionRecord(session) : null;
  }

  async findSession(endpointId: string, clientInstanceId: string) {
    const session = await this.transaction.callCenterAgentSession.findUnique({
      select: sessionSelect,
      where: {
        endpointId_browserSessionId: {
          browserSessionId: clientInstanceId,
          endpointId,
        },
      },
    });
    return session ? toAgentSessionRecord(session) : null;
  }

  async getAccessibleEndpoint(actor: AgentSessionActor, endpointId: string) {
    const endpoint = await this.transaction.callCenterEndpoint.findFirst({
      select: {
        id: true,
        label: true,
        locationId: true,
        providerCredentialId: true,
      },
      where: {
        enabled: true,
        id: endpointId,
        locationId: actor.hasAllLocationAccess
          ? undefined
          : { in: actor.allowedLocationIds },
        practiceId: actor.practiceId,
        providerCredentialId: { not: null },
        sipUsername: { not: null },
      },
    });

    return endpoint as AgentSessionEndpoint | null;
  }

  async hasQueueAccess(actor: AgentSessionActor, endpoint: AgentSessionEndpoint) {
    const locationWhere: Prisma.CallCenterQueueMemberWhereInput = endpoint.locationId
      ? {
          OR: [
            { queue: { locations: { none: {} } } },
            { queue: { locations: { some: { locationId: endpoint.locationId } } } },
          ],
        }
      : { queue: { locations: { none: {} } } };
    const membership = await this.transaction.callCenterQueueMember.findFirst({
      select: { id: true },
      where: {
        enabled: true,
        queue: {
          enabled: true,
          practiceId: actor.practiceId,
        },
        userId: actor.userId,
        ...locationWhere,
      },
    });

    return Boolean(membership);
  }

  async updateSession(id: string, update: AgentSessionUpdate) {
    const session = await this.transaction.callCenterAgentSession.update({
      data: update,
      select: sessionSelect,
      where: { id },
    });
    return toAgentSessionRecord(session);
  }
}

export class PrismaAgentSessionStore implements AgentSessionStore {
  constructor(private readonly database: Database = prisma) {}

  createId() {
    return randomUUID();
  }

  withEndpointLock<T>(
    endpointId: string,
    work: (transaction: AgentSessionTransaction) => Promise<T>,
  ) {
    return this.database.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "call_center_endpoint" WHERE "id" = ${endpointId} FOR UPDATE`,
      );
      return work(new PrismaAgentSessionTransaction(transaction));
    });
  }
}

export const prismaAgentSessionStore = new PrismaAgentSessionStore();
