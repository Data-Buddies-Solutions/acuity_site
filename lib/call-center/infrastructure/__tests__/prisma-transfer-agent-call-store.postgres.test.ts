import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaTransferAgentCallStore } from "@/lib/call-center/infrastructure/prisma-transfer-agent-call-store";

const postgresUrl = process.env.CALL_CENTER_POSTGRES_TEST_URL ?? "";
const describePostgres = postgresUrl ? describe : describe.skip;
const now = new Date("2026-07-20T12:00:00.000Z");

describePostgres("same-location transfer target discovery on PostgreSQL", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgresUrl }),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists an available agent who belongs only to another queue", async () => {
    const key = randomUUID().replaceAll("-", "");
    const id = (prefix: string) => `${prefix}-${key}`;
    const sourceUserId = id("source-user");
    const targetUserId = id("target-user");
    const practiceId = id("practice");
    const locationId = id("location");
    const sourceQueueId = id("source-queue");
    const targetQueueId = id("target-queue");
    const sourceEndpointId = id("source-endpoint");
    const targetEndpointId = id("target-endpoint");
    const callId = id("call");
    const sourceLegId = id("source-leg");

    await prisma.user.createMany({
      data: [
        { email: `${sourceUserId}@example.test`, id: sourceUserId, name: "Source" },
        { email: `${targetUserId}@example.test`, id: targetUserId, name: "Target" },
      ],
    });
    await prisma.practice.create({
      data: {
        id: practiceId,
        name: `Cross-queue transfer ${key}`,
        locations: { create: { id: locationId, name: "Shared location" } },
        memberships: {
          createMany: {
            data: [{ userId: sourceUserId }, { userId: targetUserId }],
          },
        },
      },
    });
    await prisma.callCenterQueue.createMany({
      data: [
        { id: sourceQueueId, name: "Source queue", practiceId },
        { id: targetQueueId, name: "Target queue", practiceId },
      ],
    });
    await prisma.callCenterQueueLocation.createMany({
      data: [
        { locationId, queueId: sourceQueueId },
        { locationId, queueId: targetQueueId },
      ],
    });
    await prisma.callCenterQueueMember.createMany({
      data: [
        { queueId: sourceQueueId, userId: sourceUserId },
        { queueId: targetQueueId, userId: targetUserId },
      ],
    });
    await prisma.practicePhoneNumber.create({
      data: {
        id: id("phone"),
        locationId,
        phoneNumber: `+1${key.slice(0, 10)}`,
        practiceId,
      },
    });
    await prisma.callCenterNumber.create({
      data: {
        id: id("number"),
        inboundQueueId: sourceQueueId,
        practiceId,
        practicePhoneNumberId: id("phone"),
      },
    });
    await prisma.callCenterEndpoint.createMany({
      data: [
        {
          id: sourceEndpointId,
          label: "Source",
          locationId,
          practiceId,
          providerCredentialId: id("source-credential"),
          sipUsername: `source-${key}`,
          userId: sourceUserId,
        },
        {
          id: targetEndpointId,
          label: "Target",
          locationId,
          practiceId,
          providerCredentialId: id("target-credential"),
          sipUsername: `target-${key}`,
          userId: targetUserId,
        },
      ],
    });
    await prisma.callCenterAgentSession.createMany({
      data: [
        {
          audioReady: true,
          browserSessionId: id("source-browser"),
          connectionState: "READY",
          endpointId: sourceEndpointId,
          leaseExpiresAt: new Date(now.getTime() + 60_000),
          microphoneReady: true,
          practiceId,
          presence: "BUSY",
          userId: sourceUserId,
        },
        {
          audioReady: true,
          browserSessionId: id("target-browser"),
          connectionState: "READY",
          endpointId: targetEndpointId,
          leaseExpiresAt: new Date(now.getTime() + 60_000),
          microphoneReady: true,
          practiceId,
          presence: "AVAILABLE",
          userId: targetUserId,
        },
      ],
    });
    await prisma.callCenterCall.create({
      data: {
        direction: "OUTBOUND",
        fromPhone: "+17865550101",
        id: callId,
        numberId: id("number"),
        practiceId,
        queueId: sourceQueueId,
        receivedAt: now,
        status: "CONNECTED",
        toPhone: "+17865550102",
      },
    });
    const sourceSession = await prisma.callCenterAgentSession.findFirstOrThrow({
      where: { endpointId: sourceEndpointId },
    });
    await prisma.callCenterCallLeg.create({
      data: {
        agentSessionId: sourceSession.id,
        answeredAt: now,
        bridgedAt: now,
        callId,
        endpointId: sourceEndpointId,
        id: sourceLegId,
        kind: "AGENT",
        providerCallControlId: id("source-control"),
        startedAt: now,
        status: "BRIDGED",
      },
    });
    await prisma.callCenterCall.update({
      data: { winningLegId: sourceLegId },
      where: { id: callId },
    });

    try {
      const store = new PrismaTransferAgentCallStore((operation) =>
        prisma.$transaction(operation),
      );
      await expect(
        store.listTargets(
          {
            allowedLocationIds: [locationId],
            hasAllLocationAccess: false,
            practiceId,
            userId: sourceUserId,
          },
          { callId, clientInstanceId: id("source-browser") },
          now,
        ),
      ).resolves.toEqual([{ endpointId: targetEndpointId, label: "Target" }]);
    } finally {
      await prisma.practice.delete({ where: { id: practiceId } });
      await prisma.user.deleteMany({
        where: { id: { in: [sourceUserId, targetUserId] } },
      });
    }
  });
});
