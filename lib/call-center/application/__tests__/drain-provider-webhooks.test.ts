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
  it("bounds concurrent recovery work and serializes one provider call session", async () => {
    let active = 0;
    let maxActive = 0;
    const processed: string[] = [];
    const releaseFirst = Promise.withResolvers<void>();
    const firstStarted = Promise.withResolvers<void>();
    const first = {
      ...record("first"),
      providerCallSessionId: "shared-session",
    };
    const second = {
      ...record("second"),
      providerCallSessionId: "shared-session",
    };
    const other = {
      ...record("other"),
      providerCallSessionId: "other-session",
    };
    const drain = createProviderWebhookDrainer({
      backlog: { listDue: async () => [first, second, other] },
      concurrency: 2,
      processRecord: async (event) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        processed.push(`start:${event.id}`);
        if (event.id === "first") {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
        processed.push(`end:${event.id}`);
        active -= 1;
        return { outcome: "PROCESSED" as const };
      },
    });

    const result = drain();
    await firstStarted.promise;
    await Promise.resolve();

    expect(processed).toContain("start:other");
    expect(processed).not.toContain("start:second");
    releaseFirst.resolve();

    await expect(result).resolves.toEqual({
      attempted: 3,
      failed: 0,
      processed: 3,
    });
    expect(maxActive).toBe(2);
    expect(processed.indexOf("end:first")).toBeLessThan(
      processed.indexOf("start:second"),
    );
  });

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
