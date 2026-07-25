import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { PrismaClient } from "@/generated/prisma/client";
import {
  listCanonicalNeedsActionThreadPage,
  readCanonicalCallerTimeline,
  readCanonicalNeedsAction,
} from "@/lib/call-center/application/portal-canonical-history";

const postgresUrl = process.env.CALL_CENTER_POSTGRES_TEST_URL ?? "";
const describePostgres = postgresUrl ? describe : describe.skip;

describePostgres("canonical caller-thread reads on PostgreSQL", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgresUrl }),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("groups before counting and paginating the requested thread page", async () => {
    const key = randomUUID();
    const practiceId = `practice-${key}`;
    const locationId = `location-${key}`;
    const phoneId = `phone-${key}`;
    const numberId = `number-${key}`;
    const queueId = `queue-${key}`;
    const baseTime = new Date("2026-07-25T12:00:00.000Z");

    await prisma.practice.create({
      data: { id: practiceId, name: `Caller threads ${key}` },
    });
    try {
      await prisma.practiceLocation.create({
        data: { id: locationId, name: "Optical", practiceId },
      });
      await prisma.practicePhoneNumber.create({
        data: {
          id: phoneId,
          locationId,
          phoneNumber: `+1${key.replaceAll("-", "").slice(0, 10)}`,
          practiceId,
        },
      });
      await prisma.callCenterQueue.create({
        data: { id: queueId, name: "Main", practiceId },
      });
      await prisma.callCenterNumber.create({
        data: {
          id: numberId,
          practiceId,
          practicePhoneNumberId: phoneId,
        },
      });
      const event = await prisma.callCenterEvent.create({
        data: {
          aggregateId: `fixture-${key}`,
          aggregateType: "CALL",
          idempotencyKey: `fixture-${key}`,
          practiceId,
          type: "CALL_FIXTURE_CREATED",
        },
      });
      const callers = [
        "+15555550000",
        "(555) 555-0000",
        ...Array.from(
          { length: 15 },
          (_, index) => `+1555555${(index + 1).toString().padStart(4, "0")}`,
        ),
      ];
      await prisma.callCenterCall.createMany({
        data: callers.map((fromPhone, index) => ({
          direction: "INBOUND" as const,
          endedAt: new Date(baseTime.getTime() - index * 60_000),
          fromPhone,
          id: `call-${key}-${index}`,
          numberId,
          practiceId,
          queueId,
          receivedAt: new Date(baseTime.getTime() - index * 60_000),
          status: "ABANDONED" as const,
          toPhone: "+15555559999",
        })),
      });
      await prisma.callCenterTask.createMany({
        data: [
          ...Array.from({ length: 5 }, (_, index) => ({
            callId: `call-${key}-${index < 3 ? 0 : 1}`,
            createdAt: new Date(baseTime.getTime() - index * 1_000),
            dedupeKey: `repeat-${key}-${index}`,
            kind: "MISSED_CALL" as const,
            practiceId,
            sourceEventRevision: event.revision,
          })),
          ...callers.slice(2).map((_fromPhone, index) => ({
            callId: `call-${key}-${index + 2}`,
            createdAt: new Date(baseTime.getTime() - (index + 2) * 60_000),
            dedupeKey: `single-${key}-${index}`,
            kind: "MISSED_CALL" as const,
            practiceId,
            sourceEventRevision: event.revision,
          })),
        ],
      });

      const context = {
        allowedLocationIds: [locationId],
        hasAllLocationAccess: false,
        practice: {
          brandAccentColor: null,
          brandLogoAlt: null,
          brandLogoUrl: null,
          brandMarkUrl: null,
          brandPrimaryColor: null,
          id: practiceId,
          name: "Caller threads",
        },
      };
      const page = await listCanonicalNeedsActionThreadPage(
        context,
        { locationIds: [locationId], page: 1, pageSize: 15, queueId },
        prisma,
      );
      const result = await readCanonicalNeedsAction(
        { locationIds: [locationId], page: 1, pageSize: 15, queueId },
        {
          database: prisma,
          getContext: async () => context as never,
        },
      );
      const timeline = await readCanonicalCallerTimeline(
        callers[2]!,
        { locationIds: [locationId], page: 1, pageSize: 25, range: "all" },
        {
          database: prisma,
          getContext: async () => context as never,
        },
      );

      expect(page.total).toBe(16);
      expect(page.threads).toHaveLength(15);
      expect(result?.total).toBe(16);
      expect(result?.groups).toHaveLength(15);
      expect(result?.groups[0]).toMatchObject({
        fromPhone: callers[0],
        missedCount: 5,
      });
      expect(timeline?.totals.totalItems).toBe(1);
      expect(timeline?.items).toHaveLength(1);
      expect(timeline?.openTaskCount).toBe(5);
      expect(timeline?.openCycleToken).toMatch(/^v1:5:[a-f0-9]{32}$/);
      expect(timeline).not.toHaveProperty("openTaskIds");
    } finally {
      await prisma.practice.delete({ where: { id: practiceId } });
    }
  });
});
