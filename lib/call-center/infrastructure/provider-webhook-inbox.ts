import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

import type { TelnyxVoiceWebhookEnvelope } from "./telnyx-voice-envelope";

export type ProviderWebhookStatus =
  "FAILED" | "IGNORED" | "PROCESSED" | "PROCESSING" | "RECEIVED";

export type ProviderWebhookRecord = {
  attemptCount: number;
  effectOwner: "CANONICAL" | "LEGACY" | null;
  errorCode: string | null;
  eventType: string;
  id: string;
  nextAttemptAt: Date | null;
  payload: unknown;
  processedAt: Date | null;
  processingStatus: ProviderWebhookStatus;
  providerCallSessionId: string | null;
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
    effectOwner: "CANONICAL" | "LEGACY";
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

export type ProviderWebhookInboxMaintenanceStore = {
  listRecoverable(input: {
    limit: number;
    maxAttempts: number;
    now: Date;
    staleBefore: Date;
  }): Promise<ProviderWebhookRecord[]>;
  redactPayloads(input: {
    before: Date;
    canonicalProjectionEnabled: boolean;
    limit: number;
    maxAttempts: number;
    redactedAt: Date;
  }): Promise<number>;
};

export type ProviderWebhookInbox = ReturnType<typeof createProviderWebhookInbox>;

const MAX_ATTEMPTS = 8;
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const PROCESSING_LEASE_MS = 5 * 60_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

export const PROVIDER_WEBHOOK_REDACTED_PAYLOAD = { redacted: true } as const;

function boundedBatchSize(limit = DEFAULT_BATCH_SIZE) {
  if (!Number.isFinite(limit)) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.min(MAX_BATCH_SIZE, Math.max(1, Math.trunc(limit)));
}

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
  store: ProviderWebhookInboxStore & Partial<ProviderWebhookInboxMaintenanceStore>,
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
    async listRecoverable(limit: number) {
      if (!store.listRecoverable) {
        throw new Error("Provider webhook recovery is not configured");
      }

      const now = clock();

      return store.listRecoverable({
        limit: boundedBatchSize(limit),
        maxAttempts,
        now,
        staleBefore: new Date(now.getTime() - processingLeaseMs),
      });
    },
    async redactPayloads({
      before,
      canonicalProjectionEnabled,
      limit,
    }: {
      before: Date;
      canonicalProjectionEnabled: boolean;
      limit?: number;
    }) {
      if (!store.redactPayloads) {
        throw new Error("Provider webhook payload redaction is not configured");
      }

      return store.redactPayloads({
        before,
        canonicalProjectionEnabled,
        limit: boundedBatchSize(limit),
        maxAttempts,
        redactedAt: clock(),
      });
    },
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
  effectOwner: true,
  errorCode: true,
  eventType: true,
  id: true,
  nextAttemptAt: true,
  payload: true,
  processedAt: true,
  processingStatus: true,
  providerCallSessionId: true,
  providerEventId: true,
  updatedAt: true,
} as const;

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
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

export function providerWebhookPayloadRetentionWhere(
  before: Date,
  maxAttempts: number,
  canonicalProjectionEnabled: boolean,
): Prisma.ProviderWebhookEventWhereInput {
  const redactedPayload = jsonInput(PROVIDER_WEBHOOK_REDACTED_PAYLOAD);
  return {
    NOT: { payload: { equals: redactedPayload } },
    AND: [
      {
        OR: [
          { processingStatus: { in: ["PROCESSED", "IGNORED"] as const } },
          {
            attemptCount: { gte: maxAttempts },
            processingStatus: "FAILED" as const,
          },
        ],
      },
      ...(canonicalProjectionEnabled
        ? [
            {
              OR: [
                {
                  canonicalProjectionStatus: {
                    in: ["PROCESSED", "IGNORED"] as Array<"PROCESSED" | "IGNORED">,
                  },
                },
                {
                  canonicalProjectionAttemptCount: { gte: maxAttempts },
                  canonicalProjectionStatus: "FAILED" as const,
                },
              ],
            },
          ]
        : []),
    ],
    provider: "TELNYX" as const,
    receivedAt: { lt: before },
  };
}

export const prismaProviderWebhookInboxStore: ProviderWebhookInboxStore &
  ProviderWebhookInboxMaintenanceStore = {
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
  async complete({ attemptCount, effectOwner, eventId, now, status }) {
    const completed = await prisma.providerWebhookEvent.updateMany({
      data: {
        errorCode: null,
        nextAttemptAt: null,
        processedAt: now,
        processingStatus: status,
      },
      where: {
        attemptCount,
        effectOwner,
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
  async listRecoverable({ limit, maxAttempts, now, staleBefore }) {
    return prisma.providerWebhookEvent.findMany({
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
      select: selectedFields,
      take: limit,
      where: {
        attemptCount: { lt: maxAttempts },
        provider: "TELNYX",
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
  },
  async receive(envelope) {
    await prisma.providerWebhookEvent.createMany({
      data: [
        {
          effectOwner: null,
          eventType: envelope.eventType,
          occurredAt: envelope.occurredAt,
          payload: jsonInput(envelope.body),
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
  async redactPayloads({
    before,
    canonicalProjectionEnabled,
    limit,
    maxAttempts,
    redactedAt,
  }) {
    const redactedPayload = jsonInput(PROVIDER_WEBHOOK_REDACTED_PAYLOAD);
    const eligible = providerWebhookPayloadRetentionWhere(
      before,
      maxAttempts,
      canonicalProjectionEnabled,
    );
    const events = await prisma.providerWebhookEvent.findMany({
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: limit,
      where: eligible,
    });

    if (events.length === 0) {
      return 0;
    }

    const ids = events.map((event) => event.id);
    if (canonicalProjectionEnabled) {
      const redacted = await prisma.providerWebhookEvent.updateMany({
        data: { payload: redactedPayload },
        where: { ...eligible, id: { in: ids } },
      });
      return redacted.count;
    }

    const [terminal, skipped] = await prisma.$transaction([
      prisma.providerWebhookEvent.updateMany({
        data: { payload: redactedPayload },
        where: {
          ...eligible,
          canonicalProjectionStatus: { in: ["PROCESSED", "IGNORED"] },
          id: { in: ids },
        },
      }),
      prisma.providerWebhookEvent.updateMany({
        data: {
          canonicalProjectedAt: redactedAt,
          canonicalProjectionErrorCode: null,
          canonicalProjectionNextAttemptAt: null,
          canonicalProjectionStatus: "IGNORED",
          payload: redactedPayload,
        },
        where: {
          ...eligible,
          canonicalProjectionStatus: { in: ["RECEIVED", "PROCESSING", "FAILED"] },
          id: { in: ids },
        },
      }),
    ]);

    return terminal.count + skipped.count;
  },
};

export const providerWebhookInbox = createProviderWebhookInbox(
  prismaProviderWebhookInboxStore,
);
