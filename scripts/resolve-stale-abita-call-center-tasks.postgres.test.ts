import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Pool } from "pg";

import { PrismaClient } from "@/generated/prisma/client";

import { runStaleActionItemCleanup } from "./resolve-stale-abita-call-center-tasks";

const postgresUrl = process.env.CALL_CENTER_POSTGRES_TEST_URL ?? "";
const describePostgres = postgresUrl ? describe : describe.skip;

describePostgres("stale Abita action-item cleanup on PostgreSQL", () => {
  let pool: Pool;
  let prisma: PrismaClient;

  beforeAll(() => {
    pool = new Pool({ connectionString: postgresUrl });
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgresUrl }),
    });
  });

  afterAll(async () => {
    await Promise.all([pool.end(), prisma.$disconnect()]);
  });

  it("resolves only old passive Abita work and is idempotent", async () => {
    const key = randomUUID();
    const now = new Date("2026-07-25T12:00:00.000Z");
    const cutoff = new Date("2026-07-18T12:00:00.000Z");
    const old = new Date(cutoff.getTime() - 1);

    await prisma.practice.deleteMany({ where: { name: "Abita Eye Group" } });

    async function seedPractice(name: string) {
      const practiceId = `practice-${name}-${key}`;
      const locationId = `location-${name}-${key}`;
      const phoneId = `phone-${name}-${key}`;
      const numberId = `number-${name}-${key}`;
      const callId = `call-${name}-${key}`;
      await prisma.practice.create({ data: { id: practiceId, name } });
      await prisma.practiceLocation.create({
        data: { id: locationId, name: "Optical", practiceId },
      });
      await prisma.practicePhoneNumber.create({
        data: {
          id: phoneId,
          locationId,
          phoneNumber: `+1${randomUUID().replaceAll("-", "").slice(0, 10)}`,
          practiceId,
        },
      });
      await prisma.callCenterNumber.create({
        data: { id: numberId, practiceId, practicePhoneNumberId: phoneId },
      });
      await prisma.callCenterCall.create({
        data: {
          direction: "INBOUND",
          endedAt: old,
          fromPhone: "+15555550123",
          id: callId,
          numberId,
          practiceId,
          receivedAt: old,
          status: "ABANDONED",
          toPhone: "+15555559999",
        },
      });
      const event = await prisma.callCenterEvent.create({
        data: {
          aggregateId: callId,
          aggregateType: "CALL",
          idempotencyKey: `fixture-${key}-${name}`,
          practiceId,
          type: "CALL_FIXTURE_CREATED",
        },
      });
      return { callId, event, practiceId };
    }

    const abita = await seedPractice("Abita Eye Group");
    const other = await seedPractice(`Other Practice ${key}`);
    try {
      await prisma.callCenterVoicemail.create({
        data: {
          callCenterCallId: abita.callId,
          durationSec: 12,
          recordingId: `recording-${key}`,
          recordingUrl: "https://example.test/recording.wav",
        },
      });
      await prisma.callCenterTask.createMany({
        data: [
          {
            callId: abita.callId,
            createdAt: old,
            dedupeKey: `old-missed-${key}`,
            kind: "MISSED_CALL",
            practiceId: abita.practiceId,
            sourceEventRevision: abita.event.revision,
          },
          {
            callId: abita.callId,
            createdAt: old,
            dedupeKey: `old-voicemail-${key}`,
            kind: "VOICEMAIL",
            practiceId: abita.practiceId,
            sourceEventRevision: abita.event.revision,
          },
          ...(["CALLBACK", "FOLLOW_UP", "NOTE"] as const).map((kind) => ({
            callId: abita.callId,
            createdAt: old,
            dedupeKey: `old-${kind}-${key}`,
            kind,
            practiceId: abita.practiceId,
            sourceEventRevision: abita.event.revision,
          })),
          {
            callId: abita.callId,
            createdAt: cutoff,
            dedupeKey: `boundary-${key}`,
            kind: "MISSED_CALL",
            practiceId: abita.practiceId,
            sourceEventRevision: abita.event.revision,
          },
          {
            callId: abita.callId,
            createdAt: old,
            dedupeKey: `resolved-${key}`,
            kind: "MISSED_CALL",
            practiceId: abita.practiceId,
            resolvedAt: old,
            sourceEventRevision: abita.event.revision,
            status: "RESOLVED",
          },
          {
            callId: other.callId,
            createdAt: old,
            dedupeKey: `other-${key}`,
            kind: "MISSED_CALL",
            practiceId: other.practiceId,
            sourceEventRevision: other.event.revision,
          },
        ],
      });

      const preview = await runStaleActionItemCleanup({
        apply: false,
        now,
        pool,
      });
      const applied = await runStaleActionItemCleanup({ apply: true, now, pool });
      const replay = await runStaleActionItemCleanup({ apply: true, now, pool });

      expect(preview).toMatchObject({
        applied: false,
        callbackAndFollowUpPreserved: 2,
        candidateCount: 2,
        cutoff: cutoff.toISOString(),
      });
      expect(applied).toMatchObject({
        applied: true,
        auditEventsWritten: 2,
        resolvedCount: 2,
      });
      expect(replay).toMatchObject({
        applied: false,
        candidateCount: 0,
        resolvedCount: 0,
      });
      expect(
        await prisma.callCenterTask.count({
          where: { practiceId: abita.practiceId, status: "OPEN" },
        }),
      ).toBe(4);
      expect(
        await prisma.callCenterTask.count({
          where: { practiceId: other.practiceId, status: "OPEN" },
        }),
      ).toBe(1);
      expect(
        await prisma.callCenterCall.count({
          where: { practiceId: abita.practiceId },
        }),
      ).toBe(1);
      expect(
        await prisma.callCenterVoicemail.count({
          where: { callCenterCall: { practiceId: abita.practiceId } },
        }),
      ).toBe(1);
    } finally {
      await prisma.practice.deleteMany({
        where: { id: { in: [abita.practiceId, other.practiceId] } },
      });
    }
  });
});
