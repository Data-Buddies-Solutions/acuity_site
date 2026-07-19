import { Prisma } from "@/generated/prisma/client";
import {
  BrowserLifecycleError,
  type BrowserLifecycleEvent,
  type BrowserLifecycleStore,
} from "@/lib/call-center/application/record-browser-lifecycle";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { prisma } from "@/lib/prisma";

const BROWSER_LIFECYCLE_EVENT = "BROWSER_LIFECYCLE";

export class PrismaBrowserLifecycleStore implements BrowserLifecycleStore {
  async save(
    actor: QueueAccessActor,
    events: readonly BrowserLifecycleEvent[],
  ): Promise<number> {
    return prisma.$transaction(async (transaction) => {
      const rows: Prisma.CallCenterEventCreateManyInput[] = [];
      for (const event of events) {
        const session = await transaction.callCenterAgentSession.findFirst({
          select: { endpointId: true, id: true },
          where: {
            browserSessionId: event.browserClientInstanceId,
            id: event.agentSessionId,
            practiceId: actor.practiceId,
            userId: actor.userId,
          },
        });
        if (!session) {
          throw new BrowserLifecycleError("Browser lifecycle session is not owned", 403);
        }
        if (Boolean(event.callId) !== Boolean(event.callLegId)) {
          throw new BrowserLifecycleError(
            "Browser lifecycle call correlation is incomplete",
            400,
          );
        }
        if (event.callId && event.callLegId) {
          const call = await transaction.callCenterCall.findFirst({
            select: { id: true },
            where: {
              id: event.callId,
              legs: {
                some: {
                  agentSessionId: session.id,
                  endpointId: session.endpointId,
                  id: event.callLegId,
                  kind: "AGENT",
                },
              },
              practiceId: actor.practiceId,
            },
          });
          if (!call) {
            throw new BrowserLifecycleError("Browser lifecycle call is not owned", 403);
          }
        }

        rows.push({
          actorUserId: actor.userId,
          aggregateId: event.callId ?? session.id,
          aggregateType: event.callId ? "CALL" : "AGENT_SESSION",
          data: {
            ...event,
            endpointId: session.endpointId,
          } as Prisma.InputJsonValue,
          idempotencyKey: `${event.browserClientInstanceId}:${event.eventId}`,
          occurredAt: new Date(event.occurredAt),
          practiceId: actor.practiceId,
          type: BROWSER_LIFECYCLE_EVENT,
        });
      }
      const result = await transaction.callCenterEvent.createMany({
        data: rows,
        skipDuplicates: true,
      });
      return result.count;
    });
  }
}

export const prismaBrowserLifecycleStore = new PrismaBrowserLifecycleStore();
