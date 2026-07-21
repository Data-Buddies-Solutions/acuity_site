import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

import { redactDirectHandoffToken } from "./direct-handoff-uri";
import type { TelnyxVoiceWebhookEnvelope } from "./telnyx-voice-envelope";

type ProviderWebhookStatus =
  "FAILED" | "IGNORED" | "PROCESSED" | "PROCESSING" | "RECEIVED";

export type ProviderWebhookRecord = {
  attemptCount: number;
  directHandoffTokenHash: string | null;
  errorCode: string | null;
  eventType: string;
  id: string;
  nextAttemptAt: Date | null;
  payload: unknown;
  processedAt: Date | null;
  processingStatus: ProviderWebhookStatus;
  providerCallSessionId: string | null;
  providerEventId: string;
  receivedAt: Date;
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
  completeIgnored(input: {
    attemptCount: number;
    errorCode?: string;
    eventId: string;
    now: Date;
  }): Promise<boolean>;
  fail(input: {
    attemptCount: number;
    errorCode: string;
    eventId: string;
    nextAttemptAt: Date;
  }): Promise<boolean>;
  listDue(input: {
    limit: number;
    maxAttempts: number;
    now: Date;
    staleBefore: Date;
  }): Promise<ProviderWebhookRecord[]>;
  receive(envelope: TelnyxVoiceWebhookEnvelope): Promise<ProviderWebhookRecord>;
};

export type ProviderWebhookInbox = ReturnType<typeof createProviderWebhookInbox>;

export const PROVIDER_WEBHOOK_MAX_ATTEMPTS = 8;
export const PROVIDER_WEBHOOK_PROCESSING_LEASE_MS = 5 * 60_000;

export function decideProviderWebhookClaim(
  event: Pick<
    ProviderWebhookRecord,
    "attemptCount" | "nextAttemptAt" | "processingStatus" | "updatedAt"
  >,
  now: Date,
  {
    maxAttempts = PROVIDER_WEBHOOK_MAX_ATTEMPTS,
    processingLeaseMs = PROVIDER_WEBHOOK_PROCESSING_LEASE_MS,
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

export function providerWebhookRetryAt(attemptCount: number, now: Date) {
  const delaySeconds = Math.min(300, 5 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(now.getTime() + delaySeconds * 1_000);
}

export function createProviderWebhookInbox(
  store: ProviderWebhookInboxStore,
  {
    clock = () => new Date(),
    maxAttempts = PROVIDER_WEBHOOK_MAX_ATTEMPTS,
    processingLeaseMs = PROVIDER_WEBHOOK_PROCESSING_LEASE_MS,
  }: {
    clock?: () => Date;
    maxAttempts?: number;
    processingLeaseMs?: number;
  } = {},
) {
  return {
    completeIgnored: store.completeIgnored,
    fail: store.fail,
    receive: store.receive,
    listDue: (limit: number) => {
      const now = clock();
      return store.listDue({
        limit,
        maxAttempts,
        now,
        staleBefore: new Date(now.getTime() - processingLeaseMs),
      });
    },
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
  directHandoffTokenHash: true,
  errorCode: true,
  eventType: true,
  id: true,
  nextAttemptAt: true,
  payload: true,
  processedAt: true,
  processingStatus: true,
  providerCallSessionId: true,
  providerEventId: true,
  receivedAt: true,
  updatedAt: true,
} as const;

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function sanitizedProviderWebhookBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { body, tokenHash: null };
  }
  const root = body as Record<string, unknown>;
  const data = root.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { body, tokenHash: null };
  }
  const payload = (data as Record<string, unknown>).payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { body, tokenHash: null };
  }

  const sanitized = redactDirectHandoffToken(payload as Record<string, unknown>);
  if (!sanitized.tokenHash) return { body, tokenHash: null };
  return {
    body: {
      ...root,
      data: {
        ...(data as Record<string, unknown>),
        payload: sanitized.payload,
      },
    },
    tokenHash: sanitized.tokenHash,
  };
}

function providerCallSessionId(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const data = (body as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const payload = (data as Record<string, unknown>).payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).call_session_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const prismaProviderWebhookInboxStore: ProviderWebhookInboxStore = {
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
  async completeIgnored({ attemptCount, errorCode, eventId, now }) {
    const completed = await prisma.providerWebhookEvent.updateMany({
      data: {
        errorCode: errorCode ?? null,
        nextAttemptAt: null,
        processedAt: now,
        processingStatus: "IGNORED",
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
  async listDue({ limit, maxAttempts, now, staleBefore }) {
    return prisma.providerWebhookEvent.findMany({
      orderBy: [{ nextAttemptAt: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
      select: selectedFields,
      take: limit,
      where: {
        attemptCount: { lt: maxAttempts },
        OR: [
          { processingStatus: "RECEIVED" },
          {
            processingStatus: "FAILED",
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          { processingStatus: "PROCESSING", updatedAt: { lte: staleBefore } },
        ],
      },
    });
  },
  async receive(envelope) {
    const sanitized = sanitizedProviderWebhookBody(envelope.body);
    await prisma.providerWebhookEvent.createMany({
      data: [
        {
          directHandoffTokenHash: sanitized.tokenHash,
          eventType: envelope.eventType,
          occurredAt: envelope.occurredAt,
          payload: jsonInput(sanitized.body),
          provider: "TELNYX",
          providerCallSessionId: providerCallSessionId(envelope.body),
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
