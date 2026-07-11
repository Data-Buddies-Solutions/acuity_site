import { prisma } from "@/lib/prisma";

export type CanonicalProjectionStatus =
  "FAILED" | "IGNORED" | "PROCESSED" | "PROCESSING" | "RECEIVED";

export type CanonicalProjectionRecord = {
  canonicalProjectionAttemptCount: number;
  canonicalProjectionErrorCode: string | null;
  canonicalProjectionNextAttemptAt: Date | null;
  canonicalProjectionStatus: CanonicalProjectionStatus;
  eventType: string;
  id: string;
  payload: unknown;
  providerEventId: string;
  receivedAt: Date;
  updatedAt: Date;
};

export type CanonicalProjectionInboxStore = {
  claim(input: {
    eventId: string;
    maxAttempts: number;
    now: Date;
    staleBefore: Date;
  }): Promise<CanonicalProjectionRecord | null>;
  completeIgnored(input: {
    attemptCount: number;
    eventId: string;
    now: Date;
  }): Promise<boolean>;
  fail(input: {
    attemptCount: number;
    errorCode: string;
    eventId: string;
    nextAttemptAt: Date | null;
  }): Promise<boolean>;
  listRecoverable(input: {
    limit: number;
    maxAttempts: number;
    now: Date;
    staleBefore: Date;
  }): Promise<CanonicalProjectionRecord[]>;
};

const MAX_ATTEMPTS = 8;
const PROCESSING_LEASE_MS = 5 * 60_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;
const MAX_BATCH_SIZE = 25;

export function canonicalProjectionRetryAt(attemptCount: number, now: Date) {
  if (attemptCount >= MAX_ATTEMPTS) return null;
  const delay = Math.min(
    RETRY_MAX_MS,
    RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
  );
  return new Date(now.getTime() + delay);
}

export function createCanonicalProjectionInbox(
  store: CanonicalProjectionInboxStore,
  { clock = () => new Date() }: { clock?: () => Date } = {},
) {
  return {
    async claim(eventId: string) {
      const now = clock();
      return store.claim({
        eventId,
        maxAttempts: MAX_ATTEMPTS,
        now,
        staleBefore: new Date(now.getTime() - PROCESSING_LEASE_MS),
      });
    },
    completeIgnored: store.completeIgnored,
    async fail(event: CanonicalProjectionRecord, errorCode: string) {
      const now = clock();
      return store.fail({
        attemptCount: event.canonicalProjectionAttemptCount,
        errorCode: errorCode.slice(0, 100),
        eventId: event.id,
        nextAttemptAt: canonicalProjectionRetryAt(
          event.canonicalProjectionAttemptCount,
          now,
        ),
      });
    },
    async listRecoverable(limit: number) {
      const now = clock();
      return store.listRecoverable({
        limit: Math.max(1, Math.min(MAX_BATCH_SIZE, Math.trunc(limit))),
        maxAttempts: MAX_ATTEMPTS,
        now,
        staleBefore: new Date(now.getTime() - PROCESSING_LEASE_MS),
      });
    },
  };
}

const selectedFields = {
  canonicalProjectionAttemptCount: true,
  canonicalProjectionErrorCode: true,
  canonicalProjectionNextAttemptAt: true,
  canonicalProjectionStatus: true,
  eventType: true,
  id: true,
  payload: true,
  providerEventId: true,
  receivedAt: true,
  updatedAt: true,
} as const;

export const prismaCanonicalProjectionInboxStore: CanonicalProjectionInboxStore = {
  async claim({ eventId, maxAttempts, now, staleBefore }) {
    const claimed = await prisma.providerWebhookEvent.updateMany({
      data: {
        canonicalProjectionAttemptCount: { increment: 1 },
        canonicalProjectionErrorCode: null,
        canonicalProjectionNextAttemptAt: null,
        canonicalProjectedAt: null,
        canonicalProjectionStatus: "PROCESSING",
      },
      where: {
        canonicalProjectionAttemptCount: { lt: maxAttempts },
        id: eventId,
        provider: "TELNYX",
        OR: [
          { canonicalProjectionStatus: "RECEIVED" },
          {
            canonicalProjectionStatus: "FAILED",
            OR: [
              { canonicalProjectionNextAttemptAt: null },
              { canonicalProjectionNextAttemptAt: { lte: now } },
            ],
          },
          {
            canonicalProjectionStatus: "PROCESSING",
            updatedAt: { lte: staleBefore },
          },
        ],
      },
    });

    return claimed.count === 1
      ? prisma.providerWebhookEvent.findUnique({
          select: selectedFields,
          where: { id: eventId },
        })
      : null;
  },
  async completeIgnored({ attemptCount, eventId, now }) {
    const completed = await prisma.providerWebhookEvent.updateMany({
      data: {
        canonicalProjectedAt: now,
        canonicalProjectionErrorCode: null,
        canonicalProjectionNextAttemptAt: null,
        canonicalProjectionStatus: "IGNORED",
      },
      where: {
        canonicalProjectionAttemptCount: attemptCount,
        canonicalProjectionStatus: "PROCESSING",
        id: eventId,
      },
    });
    return completed.count === 1;
  },
  async fail({ attemptCount, errorCode, eventId, nextAttemptAt }) {
    const failed = await prisma.providerWebhookEvent.updateMany({
      data: {
        canonicalProjectionErrorCode: errorCode,
        canonicalProjectionNextAttemptAt: nextAttemptAt,
        canonicalProjectedAt: null,
        canonicalProjectionStatus: "FAILED",
      },
      where: {
        canonicalProjectionAttemptCount: attemptCount,
        canonicalProjectionStatus: "PROCESSING",
        id: eventId,
      },
    });
    return failed.count === 1;
  },
  listRecoverable({ limit, maxAttempts, now, staleBefore }) {
    return prisma.providerWebhookEvent.findMany({
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
      select: selectedFields,
      take: limit,
      where: {
        canonicalProjectionAttemptCount: { lt: maxAttempts },
        provider: "TELNYX",
        OR: [
          { canonicalProjectionStatus: "RECEIVED" },
          {
            canonicalProjectionStatus: "FAILED",
            OR: [
              { canonicalProjectionNextAttemptAt: null },
              { canonicalProjectionNextAttemptAt: { lte: now } },
            ],
          },
          {
            canonicalProjectionStatus: "PROCESSING",
            updatedAt: { lte: staleBefore },
          },
        ],
      },
    });
  },
};

export const canonicalProjectionInbox = createCanonicalProjectionInbox(
  prismaCanonicalProjectionInboxStore,
);
