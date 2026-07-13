import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type {
  AgentSessionCredentialActor,
  AgentSessionCredentialInput,
  AgentSessionCredentialStore,
} from "@/lib/call-center/application/agent-session-credentials";
import { prisma } from "@/lib/prisma";

type Database = Pick<PrismaClient, "$transaction">;

const NONTERMINAL_CALL_STATUSES = [
  "RECEIVED",
  "QUEUED",
  "RINGING",
  "CONNECTED",
  "WRAP_UP",
] as const;

function queueLocationWhere(locationId: string | null) {
  return locationId
    ? {
        OR: [
          { queue: { locations: { none: {} } } },
          { queue: { locations: { some: { locationId } } } },
        ],
      }
    : { queue: { locations: { none: {} } } };
}

export class PrismaAgentSessionCredentialStore implements AgentSessionCredentialStore {
  constructor(private readonly database: Database = prisma) {}

  resolve(
    actor: AgentSessionCredentialActor,
    input: AgentSessionCredentialInput,
    now: Date,
  ) {
    return this.database.$transaction(async (transaction) => {
      const session = await transaction.callCenterAgentSession.findFirst({
        select: {
          endpoint: {
            select: {
              locationId: true,
              providerCredentialId: true,
              user: { select: { name: true } },
            },
          },
        },
        where: {
          browserSessionId: input.clientInstanceId,
          connectionState: { not: "CLOSED" },
          endpoint: {
            enabled: true,
            locationId: actor.hasAllLocationAccess
              ? undefined
              : { in: actor.allowedLocationIds },
            practiceId: actor.practiceId,
            providerCredentialId: { not: null },
            userId: actor.userId,
          },
          id: input.sessionId,
          leaseExpiresAt: { gt: now },
          practiceId: actor.practiceId,
          presence: { not: "OFFLINE" },
          userId: actor.userId,
          ...(input.activationEnabled
            ? {}
            : {
                OR: [
                  {
                    currentCall: {
                      is: {
                        effectOwner: "CANONICAL",
                        status: { in: [...NONTERMINAL_CALL_STATUSES] },
                      },
                    },
                  },
                  {
                    offeredCall: {
                      is: {
                        effectOwner: "CANONICAL",
                        status: { in: [...NONTERMINAL_CALL_STATUSES] },
                      },
                    },
                  },
                ],
              }),
        },
      });
      const endpoint = session?.endpoint;
      if (!endpoint?.providerCredentialId) return null;

      const membership = await transaction.callCenterQueueMember.findFirst({
        select: { id: true },
        where: {
          enabled: true,
          role: "AGENT",
          queue: { enabled: true, practiceId: actor.practiceId },
          userId: actor.userId,
          ...queueLocationWhere(endpoint.locationId),
        } satisfies Prisma.CallCenterQueueMemberWhereInput,
      });
      return membership
        ? {
            agentLabel: endpoint.user?.name ?? "Call center agent",
            providerCredentialId: endpoint.providerCredentialId,
          }
        : null;
    });
  }
}

export const prismaAgentSessionCredentialStore = new PrismaAgentSessionCredentialStore();
