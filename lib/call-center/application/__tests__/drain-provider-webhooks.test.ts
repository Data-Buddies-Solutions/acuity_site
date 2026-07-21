import { describe, expect, it } from "bun:test";

import type { ProviderWebhookRecord } from "@/lib/call-center/infrastructure/provider-webhook-inbox";

import { createProviderWebhookDrainer } from "../drain-provider-webhooks";

const now = new Date("2026-07-21T12:00:00.000Z");
const record = (id: string): ProviderWebhookRecord => ({
  attemptCount: 1,
  directHandoffTokenHash: null,
  errorCode: "PROVIDER_EVENT_FAILED",
  eventType: "call.answered",
  id,
  nextAttemptAt: now,
  payload: {},
  processedAt: null,
  processingStatus: "FAILED",
  providerCallSessionId: `session-${id}`,
  providerEventId: `provider-${id}`,
  receivedAt: now,
  updatedAt: now,
});

describe("provider webhook recovery", () => {
  it("processes one bounded durable batch without replaying HTTP", async () => {
    const processed: string[] = [];
    const drain = createProviderWebhookDrainer({
      backlog: {
        listDue: async () => [record("event-1"), record("event-2")],
      },
      processRecord: async (event) => {
        processed.push(event.id);
        return { outcome: "PROCESSED" as const };
      },
    });

    await expect(drain()).resolves.toEqual({
      attempted: 2,
      failed: 0,
      processed: 2,
    });
    expect(processed).toEqual(["event-1", "event-2"]);
  });

  it("keeps poison rows visible while allowing the rest of the batch to converge", async () => {
    const drain = createProviderWebhookDrainer({
      backlog: { listDue: async () => [record("bad"), record("good")] },
      processRecord: async (event) =>
        event.id === "bad"
          ? { errorCode: "PROVIDER_EVENT_FAILED", outcome: "FAILED" as const }
          : { outcome: "PROCESSED" as const },
    });

    await expect(drain()).resolves.toEqual({
      attempted: 2,
      failed: 1,
      processed: 1,
    });
  });
});
