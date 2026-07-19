import { prisma } from "@/lib/prisma";

export type CanonicalProjectionStatus =
  "FAILED" | "IGNORED" | "PROCESSED" | "PROCESSING" | "RECEIVED";

export type CanonicalProjectionRecord = {
  canonicalProjectionAttemptCount: number;
  canonicalProjectionErrorCode: string | null;
  canonicalProjectionStatus: CanonicalProjectionStatus;
  effectOwner: "CANONICAL";
  eventType: string;
  id: string;
  payload: unknown;
  providerCallSessionId: string | null;
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
    reasonCode?: string;
  }): Promise<boolean>;
  fail(input: {
    attemptCount: number;
    errorCode: string;
    eventId: string;
  }): Promise<boolean>;
};

export const CANONICAL_PROJECTION_MAX_ATTEMPTS = 8;
const PROCESSING_LEASE_MS = 5 * 60_000;

export const canonicalProjectionMainLaneWhere = {
  processingStatus: {
    in: ["PROCESSED", "IGNORED"] as Array<"PROCESSED" | "IGNORED">,
  },
} as const;

export function createCanonicalProjectionInbox(
  store: CanonicalProjectionInboxStore,
  { clock = () => new Date() }: { clock?: () => Date } = {},
) {
  return {
    async claim(eventId: string) {
      const now = clock();
      return store.claim({
        eventId,
        maxAttempts: CANONICAL_PROJECTION_MAX_ATTEMPTS,
        now,
        staleBefore: new Date(now.getTime() - PROCESSING_LEASE_MS),
      });
    },
    completeIgnored: store.completeIgnored,
    async fail(event: CanonicalProjectionRecord, errorCode: string) {
      return store.fail({
        attemptCount: event.canonicalProjectionAttemptCount,
        errorCode: errorCode.slice(0, 100),
        eventId: event.id,
      });
    },
  };
}

const selectedFields = {
  canonicalProjectionAttemptCount: true,
  canonicalProjectionErrorCode: true,
  canonicalProjectionStatus: true,
  effectOwner: true,
  eventType: true,
  id: true,
  payload: true,
  providerCallSessionId: true,
  providerEventId: true,
  receivedAt: true,
  updatedAt: true,
} as const;

function requireEffectOwner<T extends { effectOwner: "CANONICAL" | "LEGACY" | null }>(
  event: T,
): Omit<T, "effectOwner"> & { effectOwner: "CANONICAL" } {
  if (event.effectOwner !== "CANONICAL") {
    throw new Error("Canonical projection claimed an event outside its lane");
  }

  return { ...event, effectOwner: "CANONICAL" };
}

export const prismaCanonicalProjectionInboxStore: CanonicalProjectionInboxStore = {
  async claim({ eventId, maxAttempts, now, staleBefore }) {
    const claimed = await prisma.providerWebhookEvent.updateMany({
      data: {
        canonicalProjectionAttemptCount: { increment: 1 },
        canonicalProjectionErrorCode: null,
        canonicalProjectedAt: null,
        canonicalProjectionStatus: "PROCESSING",
      },
      where: {
        canonicalProjectionAttemptCount: { lt: maxAttempts },
        effectOwner: "CANONICAL",
        id: eventId,
        ...canonicalProjectionMainLaneWhere,
        provider: "TELNYX",
        OR: [
          { canonicalProjectionStatus: "RECEIVED" },
          { canonicalProjectionStatus: "FAILED" },
          {
            canonicalProjectionStatus: "PROCESSING",
            updatedAt: { lte: staleBefore },
          },
        ],
      },
    });

    if (claimed.count !== 1) return null;

    const event = await prisma.providerWebhookEvent.findUnique({
      select: selectedFields,
      where: { id: eventId },
    });
    return event ? requireEffectOwner(event) : null;
  },
  async completeIgnored({ attemptCount, eventId, now, reasonCode }) {
    const completed = await prisma.providerWebhookEvent.updateMany({
      data: {
        canonicalProjectedAt: now,
        canonicalProjectionErrorCode: reasonCode ?? null,
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
  async fail({ attemptCount, errorCode, eventId }) {
    const failed = await prisma.providerWebhookEvent.updateMany({
      data: {
        canonicalProjectionErrorCode: errorCode,
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
};

export const canonicalProjectionInbox = createCanonicalProjectionInbox(
  prismaCanonicalProjectionInboxStore,
);
