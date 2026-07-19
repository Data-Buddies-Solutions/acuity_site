import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { PrismaClient } from "@/generated/prisma/client";
import { callCenter } from "@/lib/call-center/call-center";
import type { TelnyxVoiceWebhookEnvelope } from "@/lib/call-center/infrastructure/telnyx-voice-envelope";

const postgresUrl = process.env.CALL_CENTER_POSTGRES_TEST_URL ?? "";
const describePostgres = postgresUrl ? describe : describe.skip;

function phoneNumbers(key: string) {
  const digits = String(Number.parseInt(key.slice(0, 8), 16)).padStart(10, "0");
  return {
    callerPhone: `+1${digits.slice(0, 9)}1`,
    practicePhone: `+1${digits.slice(0, 9)}2`,
  };
}

function envelope({
  eventType,
  key,
  payload = {},
  providerEventId,
  providerSessionId,
}: {
  eventType: string;
  key: string;
  payload?: Record<string, unknown>;
  providerEventId: string;
  providerSessionId: string;
}): TelnyxVoiceWebhookEnvelope {
  const occurredAt = new Date("2026-07-19T12:00:00.000Z");
  const { callerPhone, practicePhone } = phoneNumbers(key);
  const body = {
    data: {
      event_type: eventType,
      id: providerEventId,
      occurred_at: occurredAt.toISOString(),
      payload: {
        call_control_id: `control-${key}`,
        call_leg_id: `leg-${key}`,
        call_session_id: providerSessionId,
        direction: "incoming",
        from: callerPhone,
        to: practicePhone,
        ...payload,
      },
    },
  };
  return { body, eventType, occurredAt, providerEventId };
}

describePostgres("server Call Center provider-event lifecycle on PostgreSQL", () => {
  let adminPrisma: PrismaClient;

  beforeAll(() => {
    adminPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgresUrl }),
    });
  });

  afterAll(async () => {
    await adminPrisma.$disconnect();
  });

  async function fixture() {
    const key = randomUUID().replaceAll("-", "");
    const practiceId = `practice-${key}`;
    const locationId = `location-${key}`;
    const phoneId = `phone-${key}`;
    const numberId = `number-${key}`;
    const queueId = `queue-${key}`;
    const { practicePhone } = phoneNumbers(key);

    await adminPrisma.practice.create({
      data: { id: practiceId, name: `Provider event ${key}` },
    });
    await adminPrisma.practiceLocation.create({
      data: { id: locationId, name: "Provider event location", practiceId },
    });
    await adminPrisma.practicePhoneNumber.create({
      data: { id: phoneId, locationId, phoneNumber: practicePhone, practiceId },
    });
    await adminPrisma.callCenterQueue.create({
      data: { id: queueId, name: "Provider event queue", practiceId },
    });
    await adminPrisma.callCenterQueueLocation.create({
      data: { locationId, queueId },
    });
    await adminPrisma.callCenterNumber.create({
      data: {
        enabled: true,
        id: numberId,
        inboundEnabled: true,
        inboundQueueId: queueId,
        practiceId,
        practicePhoneNumberId: phoneId,
      },
    });

    return {
      async cleanup() {
        await adminPrisma.providerWebhookEvent.deleteMany({
          where: { providerEventId: { startsWith: `provider-${key}-` } },
        });
        await adminPrisma.practice.deleteMany({ where: { id: practiceId } });
      },
      key,
      practiceId,
    };
  }

  it("persists one complete lifecycle and one projection for concurrent duplicates", async () => {
    const current = await fixture();
    const providerSessionId = `session-${current.key}`;
    const initiated = envelope({
      eventType: "call.initiated",
      key: current.key,
      providerEventId: `provider-${current.key}-initiated`,
      providerSessionId,
    });

    try {
      const deliveries = await Promise.allSettled([
        callCenter.applyProviderEvent(initiated),
        callCenter.applyProviderEvent(initiated),
      ]);
      expect(
        deliveries.some(
          (delivery) =>
            delivery.status === "fulfilled" && delivery.value.outcome === "PROCESSED",
        ),
      ).toBe(true);
      for (const delivery of deliveries) {
        if (delivery.status === "fulfilled") {
          expect(delivery.value.outcome).toBe("PROCESSED");
        } else {
          expect(delivery.reason).toMatchObject({ status: 503 });
        }
      }
      await expect(callCenter.applyProviderEvent(initiated)).resolves.toMatchObject({
        duplicate: true,
        outcome: "PROCESSED",
      });

      const call = await adminPrisma.callCenterCall.findFirstOrThrow({
        include: { commands: true, legs: true },
        where: { practiceId: current.practiceId },
      });
      expect(call.legs).toHaveLength(1);
      expect(call.commands.length).toBeGreaterThan(0);
      expect(
        await adminPrisma.callCenterEvent.count({
          where: {
            idempotencyKey: `telnyx:${initiated.providerEventId}`,
            practiceId: current.practiceId,
          },
        }),
      ).toBe(1);
      expect(
        await adminPrisma.providerWebhookEvent.findUniqueOrThrow({
          where: {
            provider_providerEventId: {
              provider: "TELNYX",
              providerEventId: initiated.providerEventId,
            },
          },
        }),
      ).toMatchObject({ attemptCount: 1, processingStatus: "PROCESSED" });

      const voicemail = envelope({
        eventType: "calls.voicemail.completed",
        key: current.key,
        payload: {
          call_control_id: undefined,
          call_leg_id: undefined,
          duration_secs: 12.4,
          recording_id: `recording-${current.key}`,
          recording_urls: {
            mp3: `https://example.test/${current.key}/voicemail.mp3`,
          },
        },
        providerEventId: `provider-${current.key}-voicemail`,
        providerSessionId,
      });
      await expect(callCenter.applyProviderEvent(voicemail)).resolves.toMatchObject({
        outcome: "PROCESSED",
      });
      expect(
        await adminPrisma.callCenterVoicemail.count({
          where: { callCenterCallId: call.id },
        }),
      ).toBe(1);
      expect(await adminPrisma.callCenterTask.count({ where: { callId: call.id } })).toBe(
        1,
      );
    } finally {
      await current.cleanup();
    }
  });

  it("converges reordered callbacks and rolls back a failed projection", async () => {
    const current = await fixture();
    const providerSessionId = `session-${current.key}`;

    try {
      const hangup = envelope({
        eventType: "call.hangup",
        key: current.key,
        providerEventId: `provider-${current.key}-hangup`,
        providerSessionId,
      });
      await expect(callCenter.applyProviderEvent(hangup)).resolves.toMatchObject({
        outcome: "PROCESSED",
      });
      await expect(
        callCenter.applyProviderEvent(
          envelope({
            eventType: "call.initiated",
            key: current.key,
            providerEventId: `provider-${current.key}-initiated`,
            providerSessionId,
          }),
        ),
      ).resolves.toMatchObject({ outcome: "PROCESSED" });

      const call = await adminPrisma.callCenterCall.findFirstOrThrow({
        include: { legs: true },
        where: { practiceId: current.practiceId },
      });
      expect(call.legs).toHaveLength(1);

      const unsupported = envelope({
        eventType: "call.transcription",
        key: current.key,
        providerEventId: `provider-${current.key}-unsupported`,
        providerSessionId,
      });
      await expect(callCenter.applyProviderEvent(unsupported)).resolves.toMatchObject({
        outcome: "IGNORED",
      });

      const eventCount = await adminPrisma.callCenterEvent.count({
        where: { practiceId: current.practiceId },
      });
      const failed = envelope({
        eventType: "call.speak.ended",
        key: current.key,
        payload: {
          client_state: Buffer.from(
            JSON.stringify({
              callId: call.id,
              canonicalCommand: true,
              commandId: `missing-command-${current.key}`,
              legId: call.legs[0]!.id,
            }),
          ).toString("base64"),
        },
        providerEventId: `provider-${current.key}-failed`,
        providerSessionId,
      });
      await expect(callCenter.applyProviderEvent(failed)).resolves.toMatchObject({
        outcome: "FAILED",
      });
      expect(
        await adminPrisma.callCenterEvent.count({
          where: { practiceId: current.practiceId },
        }),
      ).toBe(eventCount);
      expect(
        await adminPrisma.providerWebhookEvent.findUniqueOrThrow({
          where: {
            provider_providerEventId: {
              provider: "TELNYX",
              providerEventId: failed.providerEventId,
            },
          },
        }),
      ).toMatchObject({
        attemptCount: 1,
        processingStatus: "FAILED",
      });
    } finally {
      await current.cleanup();
    }
  });
});
