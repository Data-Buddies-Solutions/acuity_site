import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

import type { TelnyxVoiceWebhookEnvelope } from "./telnyx-voice-envelope";

export type ProviderWebhookStatus =
  "FAILED" | "IGNORED" | "PROCESSED" | "PROCESSING" | "RECEIVED";

export type ProviderWebhookRecord = {
  attemptCount: number;
  errorCode: string | null;
  eventType: string;
  id: string;
  nextAttemptAt: Date | null;
  payload: unknown;
  processedAt: Date | null;
  processingStatus: ProviderWebhookStatus;
  providerEventId: string;
  updatedAt: Date;
};

export type ProviderWebhookClaimDecision =
  "CLAIM" | "DUPLICATE" | "EXHAUSTED" | "PROCESSING" | "RETRY_SCHEDULED";

export type ProviderWebhookInboxStore = {
  claim(input: {
    eventId: string;
    maxAttempts: number;
    now: Date;
    staleBefore: Date;
  }): Promise<ProviderWebhookRecord | null>;
  complete(input: {
    attemptCount: number;
    eventId: string;
    now: Date;
    status: "IGNORED" | "PROCESSED";
  }): Promise<boolean>;
  fail(input: {
    attemptCount: number;
    errorCode: string;
    eventId: string;
    nextAttemptAt: Date;
  }): Promise<boolean>;
  receive(envelope: TelnyxVoiceWebhookEnvelope): Promise<ProviderWebhookRecord>;
};

export type ProviderWebhookInbox = ReturnType<typeof createProviderWebhookInbox>;

const MAX_ATTEMPTS = 8;
const PROCESSING_LEASE_MS = 5 * 60_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

export function decideProviderWebhookClaim(
  event: Pick<
    ProviderWebhookRecord,
    "attemptCount" | "nextAttemptAt" | "processingStatus" | "updatedAt"
  >,
  now: Date,
  {
    maxAttempts = MAX_ATTEMPTS,
    processingLeaseMs = PROCESSING_LEASE_MS,
  }: { maxAttempts?: number; processingLeaseMs?: number } = {},
): ProviderWebhookClaimDecision {
  if (event.processingStatus === "PROCESSED" || event.processingStatus === "IGNORED") {
    return "DUPLICATE";
  }

  if (
    event.processingStatus === "PROCESSING" &&
    event.updatedAt.getTime() > now.getTime() - processingLeaseMs
  ) {
    return "PROCESSING";
  }

  if (event.attemptCount >= maxAttempts) {
    return "EXHAUSTED";
  }

  if (event.processingStatus === "RECEIVED") {
    return "CLAIM";
  }

  if (event.processingStatus === "FAILED") {
    return !event.nextAttemptAt || event.nextAttemptAt.getTime() <= now.getTime()
      ? "CLAIM"
      : "RETRY_SCHEDULED";
  }

  if (event.processingStatus === "PROCESSING") {
    return "CLAIM";
  }

  return "DUPLICATE";
}

export function providerWebhookRetryAt(
  attemptCount: number,
  now: Date,
  { baseMs = RETRY_BASE_MS, maxMs = RETRY_MAX_MS } = {},
) {
  const exponent = Math.max(0, attemptCount - 1);
  const delayMs = Math.min(maxMs, baseMs * 2 ** exponent);
  return new Date(now.getTime() + delayMs);
}

export function createProviderWebhookInbox(
  store: ProviderWebhookInboxStore,
  {
    clock = () => new Date(),
    maxAttempts = MAX_ATTEMPTS,
    processingLeaseMs = PROCESSING_LEASE_MS,
  }: {
    clock?: () => Date;
    maxAttempts?: number;
    processingLeaseMs?: number;
  } = {},
) {
  return {
    complete: store.complete,
    fail: store.fail,
    receive: store.receive,
    retryAt: (attemptCount: number) => providerWebhookRetryAt(attemptCount, clock()),
    async claim(event: ProviderWebhookRecord) {
      const now = clock();
      const decision = decideProviderWebhookClaim(event, now, {
        maxAttempts,
        processingLeaseMs,
      });

      if (decision !== "CLAIM") {
        return { decision, event: null } as const;
      }

      const claimed = await store.claim({
        eventId: event.id,
        maxAttempts,
        now,
        staleBefore: new Date(now.getTime() - processingLeaseMs),
      });

      return claimed
        ? ({ decision: "CLAIM", event: claimed } as const)
        : ({ decision: "PROCESSING", event: null } as const);
    },
  };
}

const selectedFields = {
  attemptCount: true,
  errorCode: true,
  eventType: true,
  id: true,
  nextAttemptAt: true,
  payload: true,
  processedAt: true,
  processingStatus: true,
  providerEventId: true,
  updatedAt: true,
} as const;

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export const prismaProviderWebhookInboxStore: ProviderWebhookInboxStore = {
  async claim({ eventId, maxAttempts, now, staleBefore }) {
    const claimed = await prisma.providerWebhookEvent.updateMany({
      data: {
        attemptCount: { increment: 1 },
        errorCode: null,
        nextAttemptAt: null,
        processedAt: null,
        processingStatus: "PROCESSING",
      },
      where: {
        attemptCount: { lt: maxAttempts },
        id: eventId,
        OR: [
          { processingStatus: "RECEIVED" },
          {
            processingStatus: "FAILED",
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          {
            processingStatus: "PROCESSING",
            updatedAt: { lte: staleBefore },
          },
        ],
      },
    });

    if (claimed.count === 0) {
      return null;
    }

    return prisma.providerWebhookEvent.findUnique({
      select: selectedFields,
      where: { id: eventId },
    });
  },
  async complete({ attemptCount, eventId, now, status }) {
    const completed = await prisma.providerWebhookEvent.updateMany({
      data: {
        errorCode: null,
        nextAttemptAt: null,
        processedAt: now,
        processingStatus: status,
      },
      where: {
        attemptCount,
        id: eventId,
        processingStatus: "PROCESSING",
      },
    });

    return completed.count === 1;
  },
  async fail({ attemptCount, errorCode, eventId, nextAttemptAt }) {
    const failed = await prisma.providerWebhookEvent.updateMany({
      data: {
        errorCode,
        nextAttemptAt,
        processedAt: null,
        processingStatus: "FAILED",
      },
      where: {
        attemptCount,
        id: eventId,
        processingStatus: "PROCESSING",
      },
    });

    return failed.count === 1;
  },
  async receive(envelope) {
    await prisma.providerWebhookEvent.createMany({
      data: [
        {
          eventType: envelope.eventType,
          occurredAt: envelope.occurredAt,
          payload: jsonInput(envelope.body),
          provider: "TELNYX",
          providerEventId: envelope.providerEventId,
        },
      ],
      skipDuplicates: true,
    });

    return prisma.providerWebhookEvent.findUniqueOrThrow({
      select: selectedFields,
      where: {
        provider_providerEventId: {
          provider: "TELNYX",
          providerEventId: envelope.providerEventId,
        },
      },
    });
  },
};

export const providerWebhookInbox = createProviderWebhookInbox(
  prismaProviderWebhookInboxStore,
);
