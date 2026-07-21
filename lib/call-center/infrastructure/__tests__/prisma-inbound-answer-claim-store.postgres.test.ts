import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { PrismaClient } from "@/generated/prisma/client";
import { claimInboundAnswer } from "@/lib/call-center/application/claim-inbound-answer";
import { callCenter } from "@/lib/call-center/call-center";
import { reconcileActiveInboundCallInTransaction } from "@/lib/call-center/infrastructure/prisma-active-inbound-lifecycle-store";
import { PrismaInboundAnswerClaimStore } from "@/lib/call-center/infrastructure/prisma-inbound-answer-claim-store";
import type { TelnyxVoiceWebhookEnvelope } from "@/lib/call-center/infrastructure/telnyx-voice-envelope";

const postgresUrl = process.env.CALL_CENTER_POSTGRES_TEST_URL ?? "";
const describePostgres = postgresUrl ? describe : describe.skip;

function agentEnvelope(input: {
  callId: string;
  endpointId: string;
  eventType: "call.answered" | "call.bridged" | "call.hangup";
  legId: string;
  occurredAt: Date;
  providerCallControlId: string;
  providerCallLegId: string;
  providerCallSessionId: string;
  providerEventId: string;
}): TelnyxVoiceWebhookEnvelope {
  const clientState = Buffer.from(
    JSON.stringify({
      callId: input.callId,
      endpointId: input.endpointId,
      internalAgentLeg: true,
      legId: input.legId,
    }),
  ).toString("base64");
  const body = {
    data: {
      event_type: input.eventType,
      id: input.providerEventId,
      occurred_at: input.occurredAt.toISOString(),
      payload: {
        call_control_id: input.providerCallControlId,
        call_leg_id: input.providerCallLegId,
        call_session_id: input.providerCallSessionId,
        client_state: clientState,
        direction: "outgoing",
      },
    },
  };
  return {
    body,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    providerEventId: input.providerEventId,
  };
}

describePostgres("inbound Answer claims on PostgreSQL", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgresUrl }),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("serializes competing Answer claims to one durable reservation", async () => {
    const key = randomUUID().replaceAll("-", "");
    const id = (prefix: string) => `${prefix}-${key}`;
    const userIds = [id("user-1"), id("user-2")];
    const endpointIds = [id("endpoint-1"), id("endpoint-2")];
    const sessionIds = [id("session-1"), id("session-2")];
    const legIds = [id("leg-1"), id("leg-2")];
    const providerControlIds = [id("control-1"), id("control-2")];
    const providerLegIds = [id("provider-leg-1"), id("provider-leg-2")];
    const providerSessionIds = [id("provider-session-1"), id("provider-session-2")];
    const practiceId = id("practice");
    const locationId = id("location");
    const queueId = id("queue");
    const phoneId = id("phone");
    const numberId = id("number");
    const callId = id("call");
    const now = new Date();
    const phone = `+1${[...key]
      .map((value) => value.charCodeAt(0) % 10)
      .slice(0, 10)
      .join("")}`;

    await prisma.user.createMany({
      data: userIds.map((userId, index) => ({
        email: `${userId}@example.test`,
        id: userId,
        name: `Answer agent ${index + 1}`,
      })),
    });
    await prisma.practice.create({
      data: {
        id: practiceId,
        memberships: { createMany: { data: userIds.map((userId) => ({ userId })) } },
        name: `Answer race ${key}`,
      },
    });
    await prisma.practiceLocation.create({
      data: { id: locationId, name: "Answer location", practiceId },
    });
    await prisma.practicePhoneNumber.create({
      data: { id: phoneId, locationId, phoneNumber: phone, practiceId },
    });
    await prisma.callCenterQueue.create({
      data: { id: queueId, name: "Answer queue", practiceId },
    });
    await prisma.callCenterQueueLocation.create({
      data: { locationId, queueId },
    });
    await prisma.callCenterQueueMember.createMany({
      data: userIds.map((userId) => ({ queueId, userId })),
    });
    await prisma.callCenterNumber.create({
      data: {
        id: numberId,
        inboundQueueId: queueId,
        practiceId,
        practicePhoneNumberId: phoneId,
      },
    });
    await prisma.callCenterEndpoint.createMany({
      data: endpointIds.map((endpointId, index) => ({
        id: endpointId,
        label: `Answer endpoint ${index + 1}`,
        locationId,
        practiceId,
        providerCredentialId: id(`credential-${index + 1}`),
        sipUsername: `answer-${index + 1}-${key}`,
        userId: userIds[index]!,
      })),
    });
    await prisma.callCenterAgentSession.createMany({
      data: sessionIds.map((sessionId, index) => ({
        audioReady: true,
        browserSessionId: id(`browser-${index + 1}`),
        connectionState: "READY",
        endpointId: endpointIds[index]!,
        id: sessionId,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        microphoneReady: true,
        practiceId,
        presence: "AVAILABLE",
        userId: userIds[index]!,
      })),
    });
    await prisma.callCenterCall.create({
      data: {
        deadlineAt: new Date(now.getTime() + 1_000),
        direction: "INBOUND",
        fromPhone: "+17865550100",
        hardDeadlineAt: new Date(now.getTime() + 60_000),
        id: callId,
        numberId,
        practiceId,
        queueId,
        receivedAt: now,
        status: "RINGING",
        toPhone: phone,
      },
    });
    await prisma.callCenterCallLeg.createMany({
      data: [
        {
          answeredAt: now,
          callId,
          id: id("customer-leg"),
          kind: "CUSTOMER",
          providerCallControlId: id("customer-control"),
          status: "ANSWERED",
        },
        ...legIds.map((legId, index) => ({
          agentSessionId: sessionIds[index]!,
          callId,
          endpointId: endpointIds[index]!,
          id: legId,
          kind: "AGENT" as const,
          providerCallControlId: providerControlIds[index]!,
          providerCallLegId: providerLegIds[index]!,
          providerCallSessionId: providerSessionIds[index]!,
          status: "RINGING" as const,
        })),
      ],
    });

    try {
      const store = new PrismaInboundAnswerClaimStore((work) =>
        prisma.$transaction(work),
      );
      const results = await Promise.all(
        userIds.map((userId, index) =>
          claimInboundAnswer(
            store,
            {
              allowedLocationIds: [locationId],
              hasAllLocationAccess: false,
              practiceId,
              userId,
            },
            {
              callId,
              idempotencyKey: id(`answer-${index + 1}`),
              legId: legIds[index]!,
              sessionId: sessionIds[index]!,
            },
            now,
          ),
        ),
      );

      expect(results.filter(({ status }) => status === "ACCEPTED")).toHaveLength(1);
      expect(results.filter(({ status }) => status === "REJECTED")).toHaveLength(1);
      expect(await prisma.callCenterAnswerReservation.count({ where: { callId } })).toBe(
        1,
      );

      const accepted = results.find(({ status }) => status === "ACCEPTED");
      if (!accepted || accepted.status !== "ACCEPTED") {
        throw new Error("Answer race did not produce one accepted claim");
      }
      const acceptedIndex = legIds.indexOf(accepted.reservation.legId);
      if (acceptedIndex < 0) throw new Error("Accepted leg was not in the fixture");
      const providerEvent = (
        eventType: "call.answered" | "call.bridged" | "call.hangup",
        occurredAt: Date,
      ) =>
        agentEnvelope({
          callId,
          endpointId: endpointIds[acceptedIndex]!,
          eventType,
          legId: accepted.reservation.legId,
          occurredAt,
          providerCallControlId: providerControlIds[acceptedIndex]!,
          providerCallLegId: providerLegIds[acceptedIndex]!,
          providerCallSessionId: providerSessionIds[acceptedIndex]!,
          providerEventId: id(`provider-${eventType.split(".")[1]}`),
        });

      const deadlineResult = await prisma.$transaction((transaction) =>
        reconcileActiveInboundCallInTransaction(
          transaction,
          { callId, practiceId, processedBridgeLegId: null },
          new Date(now.getTime() + 1_000),
        ),
      );
      expect(deadlineResult).toMatchObject({
        commandIds: [],
        decision: {
          disposition: "WAITING_FOR_AGENT",
          protectedLegId: accepted.reservation.legId,
        },
        status: "APPLIED",
      });
      expect(
        await prisma.callCenterCall.findUniqueOrThrow({ where: { id: callId } }),
      ).toMatchObject({ status: "RINGING", voicemailStartedAt: null });

      await expect(
        callCenter.applyProviderEvent(
          providerEvent("call.answered", new Date(now.getTime() + 2_000)),
        ),
      ).resolves.toMatchObject({
        outcome: "PROCESSED",
        projection: {
          callId,
          callStatus: "RINGING",
          legId: accepted.reservation.legId,
          legStatus: "ANSWERED",
        },
      });
      expect(
        await prisma.callCenterCall.findUniqueOrThrow({ where: { id: callId } }),
      ).toMatchObject({ status: "RINGING", voicemailStartedAt: null });
      expect(await prisma.callCenterTask.count({ where: { callId } })).toBe(0);

      await expect(
        callCenter.applyProviderEvent(
          providerEvent("call.bridged", new Date(now.getTime() + 3_000)),
        ),
      ).resolves.toMatchObject({
        outcome: "PROCESSED",
        projection: {
          callId,
          callStatus: "CONNECTED",
          legId: accepted.reservation.legId,
          legStatus: "BRIDGED",
        },
      });
      const connected = await prisma.callCenterCall.findUniqueOrThrow({
        include: { commands: true, legs: true },
        where: { id: callId },
      });
      expect(connected).toMatchObject({
        status: "CONNECTED",
        voicemailStartedAt: null,
        winningLegId: accepted.reservation.legId,
      });
      expect(connected.commands.map(({ type }) => type)).not.toContain(
        "PLAY_VOICEMAIL_GREETING",
      );
      expect(connected.legs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            errorCode: "NON_WINNING_LEG",
            id: legIds[1 - acceptedIndex],
            status: "ENDED",
          }),
        ]),
      );

      await expect(
        callCenter.applyProviderEvent(
          providerEvent("call.hangup", new Date(now.getTime() + 4_000)),
        ),
      ).resolves.toMatchObject({
        outcome: "PROCESSED",
        projection: {
          callId,
          callStatus: "COMPLETED",
          legId: accepted.reservation.legId,
          legStatus: "ENDED",
        },
      });
      expect(
        await prisma.callCenterCall.findUniqueOrThrow({
          include: { legs: true },
          where: { id: callId },
        }),
      ).toMatchObject({
        status: "COMPLETED",
        voicemailStartedAt: null,
        winningLegId: accepted.reservation.legId,
      });
      expect(await prisma.callCenterTask.count({ where: { callId } })).toBe(0);
      expect(
        await prisma.callCenterVoicemail.count({ where: { callCenterCallId: callId } }),
      ).toBe(0);
      expect(
        await prisma.callCenterAnswerReservation.findUniqueOrThrow({
          where: { callId },
        }),
      ).toMatchObject({ status: "RELEASED" });
    } finally {
      await prisma.practice.delete({ where: { id: practiceId } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });
});
