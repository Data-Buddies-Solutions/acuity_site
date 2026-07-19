import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Pool } from "pg";

import { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { ProviderWebhookRecord } from "@/lib/call-center/infrastructure/provider-webhook-inbox";
import {
  collectCallCenterConfigurationReferences,
  type ValidatedCallCenterConfiguration,
} from "@/lib/call-center/application/configuration";
import {
  type ConfigurationTransactionRunner,
  PrismaCallCenterConfigurationRepository,
  readCallCenterConfiguration,
} from "@/lib/call-center/infrastructure/prisma-configuration-repository";
import {
  admitTelnyxEvent,
  TelnyxEventAdmissionError,
} from "@/lib/call-center/infrastructure/prisma-telnyx-event-admission";
const postgresUrl = process.env.CALL_CENTER_POSTGRES_TEST_URL ?? "";
const describePostgres = postgresUrl ? describe : describe.skip;

async function waitForAdvisoryLockWait(pool: Pool) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query<{ waiting: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND NOT granted
      ) AS waiting
    `);
    if (waiting.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("admission did not wait for the practice lock");
}

describePostgres("call-center practice lock on PostgreSQL", () => {
  let adminPrisma: PrismaClient;
  let admissionPrisma: PrismaClient;
  let configurationPrisma: PrismaClient;
  let pool: Pool;

  beforeAll(() => {
    adminPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgresUrl }),
    });
    admissionPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgresUrl }),
    });
    configurationPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgresUrl }),
    });
    pool = new Pool({ connectionString: postgresUrl });
  });

  afterAll(async () => {
    await pool.end();
    await Promise.all([
      adminPrisma.$disconnect(),
      admissionPrisma.$disconnect(),
      configurationPrisma.$disconnect(),
    ]);
  });

  it("commits one coherent configuration across production mutation and admission", async () => {
    const key = randomUUID();
    const practiceId = `practice-${key}`;
    const userId = `user-${key}`;
    const locationId = `location-${key}`;
    const phoneId = `phone-${key}`;
    const numberId = `number-${key}`;
    const oldQueueId = `queue-old-${key}`;
    const newQueueId = `queue-new-${key}`;
    const endpointId = `endpoint-${key}`;
    const inboxId = `inbox-${key}`;
    const providerSessionId = `provider-session-${key}`;
    const practicePhone = "+17865550101";
    const callerPhone = "+17865550102";
    const occurredAt = new Date("2026-07-19T12:00:00.000Z");

    await adminPrisma.user.create({
      data: { email: `${key}@example.test`, id: userId, name: "Issue 175 Agent" },
    });
    await adminPrisma.practice.create({
      data: { id: practiceId, name: "Issue 175 Practice" },
    });
    await adminPrisma.practiceLocation.create({
      data: { id: locationId, name: "Issue 175 Location", practiceId },
    });
    await adminPrisma.practicePhoneNumber.create({
      data: { id: phoneId, locationId, phoneNumber: practicePhone, practiceId },
    });
    await adminPrisma.practiceMembership.create({
      data: { practiceId, userId },
    });
    await adminPrisma.callCenterQueue.createMany({
      data: [
        { enabled: true, id: oldQueueId, name: "Old route", practiceId },
        { enabled: false, id: newQueueId, name: "New route", practiceId },
      ],
    });
    await adminPrisma.callCenterQueueLocation.createMany({
      data: [
        { locationId, queueId: oldQueueId },
        { locationId, queueId: newQueueId },
      ],
    });
    await adminPrisma.callCenterQueueMember.createMany({
      data: [
        { queueId: oldQueueId, userId },
        { queueId: newQueueId, userId },
      ],
    });
    await adminPrisma.callCenterEndpoint.create({
      data: {
        id: endpointId,
        label: "Issue 175 endpoint",
        locationId,
        practiceId,
        providerCredentialId: `credential-${key}`,
        sipUsername: `issue-175-${key}`,
        userId,
      },
    });
    await adminPrisma.callCenterNumber.create({
      data: {
        enabled: true,
        id: numberId,
        inboundEnabled: true,
        inboundQueueId: oldQueueId,
        practiceId,
        practicePhoneNumberId: phoneId,
      },
    });

    const event: ProviderWebhookRecord = {
      attemptCount: 1,
      directHandoffTokenHash: null,
      errorCode: null,
      eventType: "call.initiated",
      id: inboxId,
      nextAttemptAt: null,
      payload: {
        data: {
          event_type: "call.initiated",
          id: `provider-event-${key}`,
          occurred_at: occurredAt.toISOString(),
          payload: {
            call_control_id: `control-${key}`,
            call_leg_id: `leg-${key}`,
            call_session_id: providerSessionId,
            direction: "incoming",
            from: callerPhone,
            to: practicePhone,
          },
        },
      },
      processedAt: null,
      processingStatus: "PROCESSING",
      providerCallSessionId: providerSessionId,
      providerEventId: `provider-event-${key}`,
      receivedAt: occurredAt,
      updatedAt: occurredAt,
    };
    await adminPrisma.providerWebhookEvent.create({
      data: {
        attemptCount: event.attemptCount,
        eventType: event.eventType,
        id: event.id,
        payload: event.payload as Prisma.InputJsonValue,
        processingStatus: event.processingStatus,
        provider: "TELNYX",
        providerCallSessionId: event.providerCallSessionId,
        providerEventId: event.providerEventId,
      },
    });

    const nextConfiguration: ValidatedCallCenterConfiguration = {
      defaultOutboundNumberId: null,
      endpoints: [
        {
          enabled: true,
          id: endpointId,
          label: "Issue 175 endpoint",
          locationId,
          providerCredentialId: `credential-${key}`,
          sipUsername: `issue-175-${key}`,
          userId,
        },
      ],
      numbers: [
        {
          enabled: true,
          id: numberId,
          inboundEnabled: true,
          inboundQueueId: newQueueId,
          outboundEnabled: false,
          practicePhoneNumberId: phoneId,
          providerNumberId: null,
        },
      ],
      practiceId,
      queues: [
        {
          enabled: false,
          id: oldQueueId,
          locationIds: [locationId],
          members: [{ enabled: true, role: "AGENT", userId }],
          name: "Old route",
          voicemailEnabled: true,
          voicemailGreeting: "Please leave a message after the beep.",
        },
        {
          enabled: true,
          id: newQueueId,
          locationIds: [locationId],
          members: [{ enabled: true, role: "AGENT", userId }],
          name: "New route",
          voicemailEnabled: true,
          voicemailGreeting: "Please leave a message after the beep.",
        },
      ],
    };
    const current = await readCallCenterConfiguration(practiceId, adminPrisma);
    expect(current).not.toBeNull();

    let releaseConfiguration = () => {};
    const continueConfiguration = new Promise<void>((resolve) => {
      releaseConfiguration = resolve;
    });
    let practiceLocked = () => {};
    const configurationHasLock = new Promise<void>((resolve) => {
      practiceLocked = resolve;
    });
    const runner: ConfigurationTransactionRunner = (operation) =>
      configurationPrisma.$transaction((transaction) => operation(transaction), {
        isolationLevel: "ReadCommitted",
        maxWait: 5_000,
        timeout: 30_000,
      });
    const repository = new PrismaCallCenterConfigurationRepository(runner);
    let configurationWrite: Promise<unknown> = Promise.resolve();
    let admission: Promise<unknown> = Promise.resolve();

    try {
      configurationWrite = repository.transaction(async (transaction) => {
        const context = await transaction.loadValidationContextForUpdate(
          practiceId,
          collectCallCenterConfigurationReferences(nextConfiguration),
        );
        practiceLocked();
        await continueConfiguration;
        await transaction.persistValidatedSnapshot(nextConfiguration, {
          actorUserId: null,
          previousVersion: context.configurationVersion,
        });
      });
      await Promise.race([
        configurationHasLock,
        configurationWrite.then(() => {
          throw new Error("configuration transaction completed before taking its lock");
        }),
      ]);

      const admissionResult = admitTelnyxEvent(event, admissionPrisma).then(
        (outcome) => ({ error: null, outcome }),
        (error: unknown) => ({ error, outcome: null }),
      );
      admission = admissionResult;

      await waitForAdvisoryLockWait(pool);
      releaseConfiguration();
      await configurationWrite;

      const result = await admissionResult;
      expect(result.error).toBeInstanceOf(TelnyxEventAdmissionError);
      expect(result.error).toMatchObject({ code: "TELNYX_EVENT_QUEUE_DISABLED" });
      expect(result.outcome).toBeNull();
      expect(await adminPrisma.callCenterCall.count({ where: { practiceId } })).toBe(0);
      expect(
        await adminPrisma.callCenterCallLeg.count({ where: { call: { practiceId } } }),
      ).toBe(0);
      expect(
        await adminPrisma.providerWebhookEvent.findUnique({
          select: { providerCallSessionId: true },
          where: { id: inboxId },
        }),
      ).toEqual({ providerCallSessionId: providerSessionId });
      expect(await readCallCenterConfiguration(practiceId, adminPrisma)).toMatchObject({
        configuration: {
          numbers: [{ id: numberId, inboundQueueId: newQueueId }],
          queues: expect.arrayContaining([
            expect.objectContaining({ enabled: true, id: newQueueId }),
          ]),
        },
      });
    } finally {
      releaseConfiguration();
      await Promise.allSettled([configurationWrite, admission]);
      await adminPrisma.providerWebhookEvent.deleteMany({ where: { id: inboxId } });
      await adminPrisma.practice.deleteMany({ where: { id: practiceId } });
      await adminPrisma.user.deleteMany({ where: { id: userId } });
    }
  });
});
