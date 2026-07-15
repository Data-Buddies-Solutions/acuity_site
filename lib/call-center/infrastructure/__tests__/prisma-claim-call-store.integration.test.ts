import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PrismaPg } from "@prisma/adapter-pg";

import { createClaimCallHandler } from "@/app/api/portal/call-center/calls/[callId]/claim/handler";
import { PrismaClient } from "@/generated/prisma/client";
import { claimCall } from "@/lib/call-center/application/claim-call";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { promoteAgentSessionOffer } from "@/lib/call-center/infrastructure/prisma-agent-session-reservation";

import { PrismaClaimCallStore } from "../prisma-claim-call-store";

const connectionString = process.env.CALL_CENTER_CONCURRENCY_TEST_DATABASE_URL;
const databaseIt = connectionString ? it : it.skip;

function client() {
  if (!connectionString) throw new Error("Concurrency test database is unavailable");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

function request(browserSessionId: string, idempotencyKey: string) {
  return new Request("https://example.test/api/portal/call-center/calls/call/claim", {
    body: JSON.stringify({
      clientInstanceId: browserSessionId,
      expectedSessionStateVersion: 1,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    method: "POST",
  });
}

describe("PostgreSQL canonical claim concurrency", () => {
  const setup = connectionString ? client() : null;
  const firstDatabase = connectionString ? client() : null;
  const secondDatabase = connectionString ? client() : null;
  const suffix = crypto.randomUUID();
  const ids = {
    call: `call-${suffix}`,
    firstEndpoint: `endpoint-1-${suffix}`,
    firstLeg: `leg-1-${suffix}`,
    firstSession: `session-1-${suffix}`,
    firstUser: `user-1-${suffix}`,
    location: `location-${suffix}`,
    number: `number-${suffix}`,
    phone: `phone-${suffix}`,
    practice: `practice-${suffix}`,
    queue: `queue-${suffix}`,
    secondEndpoint: `endpoint-2-${suffix}`,
    secondLeg: `leg-2-${suffix}`,
    secondSession: `session-2-${suffix}`,
    secondUser: `user-2-${suffix}`,
  };

  beforeAll(async () => {
    if (!setup) return;
    await setup.practice.create({ data: { id: ids.practice, name: "Claim race" } });
    await setup.practiceLocation.create({
      data: { id: ids.location, name: "Main", practiceId: ids.practice },
    });
    await setup.user.createMany({
      data: [
        { email: `${ids.firstUser}@example.test`, id: ids.firstUser, name: "First" },
        { email: `${ids.secondUser}@example.test`, id: ids.secondUser, name: "Second" },
      ],
    });
    await setup.practiceMembership.createMany({
      data: [
        { practiceId: ids.practice, userId: ids.firstUser },
        { practiceId: ids.practice, userId: ids.secondUser },
      ],
    });
    await setup.callCenterQueue.create({
      data: { id: ids.queue, name: "Front desk", practiceId: ids.practice },
    });
    await setup.callCenterQueueLocation.create({
      data: { locationId: ids.location, queueId: ids.queue },
    });
    await setup.callCenterQueueMember.createMany({
      data: [
        { queueId: ids.queue, userId: ids.firstUser },
        { queueId: ids.queue, userId: ids.secondUser },
      ],
    });
    await setup.practicePhoneNumber.create({
      data: {
        id: ids.phone,
        locationId: ids.location,
        phoneNumber: `+1${suffix.replaceAll("-", "").slice(0, 10)}`,
        practiceId: ids.practice,
      },
    });
    await setup.callCenterNumber.create({
      data: {
        id: ids.number,
        inboundEnabled: true,
        inboundQueueId: ids.queue,
        practiceId: ids.practice,
        practicePhoneNumberId: ids.phone,
      },
    });
    await setup.callCenterCall.create({
      data: {
        direction: "INBOUND",
        effectOwner: "CANONICAL",
        fromPhone: "+13525550000",
        id: ids.call,
        numberId: ids.number,
        practiceId: ids.practice,
        queueId: ids.queue,
        status: "QUEUED",
        toPhone: "+13525550001",
      },
    });

    for (const operator of [
      {
        endpointId: ids.firstEndpoint,
        legId: ids.firstLeg,
        sessionId: ids.firstSession,
        userId: ids.firstUser,
      },
      {
        endpointId: ids.secondEndpoint,
        legId: ids.secondLeg,
        sessionId: ids.secondSession,
        userId: ids.secondUser,
      },
    ]) {
      await setup.callCenterEndpoint.create({
        data: {
          enabled: true,
          id: operator.endpointId,
          label: operator.userId,
          locationId: ids.location,
          practiceId: ids.practice,
          providerCredentialId: `credential-${operator.userId}`,
          sipUsername: `sip-${operator.userId}`,
          userId: operator.userId,
        },
      });
      await setup.callCenterAgentSession.create({
        data: {
          audioReady: true,
          browserSessionId: operator.sessionId,
          connectionState: "READY",
          endpointId: operator.endpointId,
          id: operator.sessionId,
          leaseExpiresAt: new Date(Date.now() + 60_000),
          microphoneReady: true,
          offeredCallId: ids.call,
          practiceId: ids.practice,
          presence: "AVAILABLE",
          stateVersion: 1,
          userId: operator.userId,
        },
      });
      await setup.callCenterCallLeg.create({
        data: {
          agentSessionId: operator.sessionId,
          callId: ids.call,
          endpointId: operator.endpointId,
          id: operator.legId,
          kind: "AGENT",
          status: "RINGING",
        },
      });
      await setup.callCenterCommand.create({
        data: {
          arguments: {
            agentSessionId: operator.sessionId,
            endpointId: operator.endpointId,
          },
          callId: ids.call,
          idempotencyKey: `route:${operator.sessionId}`,
          legId: operator.legId,
          practiceId: ids.practice,
          type: "DIAL_AGENT",
        },
      });
    }
  });

  afterAll(async () => {
    if (!setup || !firstDatabase || !secondDatabase) return;
    await setup.practice.delete({ where: { id: ids.practice } });
    await setup.user.deleteMany({
      where: { id: { in: [ids.firstUser, ids.secondUser] } },
    });
    await Promise.all([
      setup.$disconnect(),
      firstDatabase.$disconnect(),
      secondDatabase.$disconnect(),
    ]);
  });

  databaseIt(
    "commits one winner and releases one loser across concurrent requests",
    async () => {
      if (!setup || !firstDatabase || !secondDatabase) return;
      const actors: [QueueAccessActor, QueueAccessActor] = [
        {
          allowedLocationIds: [],
          hasAllLocationAccess: true,
          practiceId: ids.practice,
          userId: ids.firstUser,
        },
        {
          allowedLocationIds: [],
          hasAllLocationAccess: true,
          practiceId: ids.practice,
          userId: ids.secondUser,
        },
      ];
      const scheduled: string[] = [];
      const handlers = [firstDatabase, secondDatabase].map((database, index) => {
        const store = new PrismaClaimCallStore((operation) =>
          database.$transaction(operation),
        );
        return createClaimCallHandler({
          claim: (_store, actor, input) => claimCall(store, actor, input),
          getActor: async () => actors[index]!,
          scheduleCommand: (commandId) => scheduled.push(commandId),
        });
      });

      const responses = await Promise.all([
        handlers[0]!(request(ids.firstSession, `take-1-${suffix}`), {
          params: Promise.resolve({ callId: ids.call }),
        }),
        handlers[1]!(request(ids.secondSession, `take-2-${suffix}`), {
          params: Promise.resolve({ callId: ids.call }),
        }),
      ]);
      const bodies = await Promise.all(responses.map((response) => response.json()));
      const winner = bodies.find((body) => body.status !== "ALREADY_CLAIMED");
      const loser = bodies.find((body) => body.status === "ALREADY_CLAIMED");

      expect(responses.map(({ status }) => status).sort()).toEqual([202, 409]);
      expect(winner).toBeDefined();
      expect(loser).toMatchObject({
        code: "CALL_ALREADY_CLAIMED",
        legId: null,
        providerCommandId: null,
      });
      expect(scheduled).toEqual([winner.providerCommandId]);
      expect(
        await setup.callCenterEvent.count({
          where: {
            aggregateId: ids.call,
            practiceId: ids.practice,
            type: "CALL_CLAIMED",
          },
        }),
      ).toBe(1);
      expect(
        await setup.callCenterCommand.count({
          where: { callId: ids.call, practiceId: ids.practice },
        }),
      ).toBe(2);

      const sessions = await setup.callCenterAgentSession.findMany({
        orderBy: { id: "asc" },
        select: { currentCallId: true, id: true, offeredCallId: true, presence: true },
        where: { practiceId: ids.practice },
      });
      const winningSession = sessions.find(({ id }) => id === winner.agentSessionId)!;
      const losingSession = sessions.find(({ id }) => id === loser.agentSessionId)!;
      expect(winningSession).toMatchObject({
        currentCallId: null,
        offeredCallId: ids.call,
        presence: "AVAILABLE",
      });
      expect(losingSession).toMatchObject({
        currentCallId: null,
        offeredCallId: null,
        presence: "AVAILABLE",
      });

      await setup.$transaction((transaction) =>
        promoteAgentSessionOffer(transaction, {
          agentSessionId: winner.agentSessionId,
          callId: ids.call,
          idempotencyKey: `provider:${ids.call}:winner`,
          now: new Date(),
        }),
      );
      const promoted = await setup.callCenterAgentSession.findMany({
        orderBy: { id: "asc" },
        select: { currentCallId: true, id: true, offeredCallId: true },
        where: { practiceId: ids.practice },
      });
      expect(promoted.filter(({ currentCallId }) => currentCallId === ids.call)).toEqual([
        { currentCallId: ids.call, id: winner.agentSessionId, offeredCallId: null },
      ]);

      const winnerIndex = winner.agentSessionId === ids.firstSession ? 0 : 1;
      const retry = await handlers[winnerIndex]!(
        request(
          winner.agentSessionId,
          winnerIndex === 0 ? `take-1-${suffix}` : `take-2-${suffix}`,
        ),
        { params: Promise.resolve({ callId: ids.call }) },
      );
      expect(retry.status).toBe(200);
      expect(
        await setup.callCenterCommand.count({
          where: { callId: ids.call, practiceId: ids.practice },
        }),
      ).toBe(2);
    },
  );
});
