import { describe, expect, it } from "bun:test";

import {
  createProviderWebhookInbox,
  decideProviderWebhookClaim,
  providerWebhookRetryAt,
  type ProviderWebhookInboxMaintenanceStore,
  type ProviderWebhookInboxStore,
  type ProviderWebhookRecord,
} from "../provider-webhook-inbox";

const now = new Date("2026-07-11T12:00:00.000Z");

function event(overrides: Partial<ProviderWebhookRecord> = {}): ProviderWebhookRecord {
  return {
    attemptCount: 0,
    errorCode: null,
    eventType: "call.initiated",
    id: "inbox-1",
    nextAttemptAt: null,
    payload: { data: { id: "event-1" } },
    processedAt: null,
    processingStatus: "RECEIVED",
    providerEventId: "event-1",
    updatedAt: now,
    ...overrides,
  };
}

describe("provider webhook claim decisions", () => {
  it("claims new, failed, and stale processing events", () => {
    expect(decideProviderWebhookClaim(event(), now)).toBe("CLAIM");
    expect(decideProviderWebhookClaim(event({ processingStatus: "FAILED" }), now)).toBe(
      "CLAIM",
    );
    expect(
      decideProviderWebhookClaim(
        event({
          processingStatus: "PROCESSING",
          updatedAt: new Date(now.getTime() - 5 * 60_000),
        }),
        now,
      ),
    ).toBe("CLAIM");
  });

  it("honors a failed event's retry schedule", () => {
    expect(
      decideProviderWebhookClaim(
        event({
          nextAttemptAt: new Date(now.getTime() + 1),
          processingStatus: "FAILED",
        }),
        now,
      ),
    ).toBe("RETRY_SCHEDULED");
    expect(
      decideProviderWebhookClaim(
        event({ nextAttemptAt: now, processingStatus: "FAILED" }),
        now,
      ),
    ).toBe("CLAIM");
  });

  it("keeps active processing retryable and skips terminal duplicates", () => {
    expect(
      decideProviderWebhookClaim(event({ processingStatus: "PROCESSING" }), now),
    ).toBe("PROCESSING");
    expect(
      decideProviderWebhookClaim(
        event({ attemptCount: 8, processingStatus: "PROCESSING" }),
        now,
      ),
    ).toBe("PROCESSING");
    expect(
      decideProviderWebhookClaim(event({ processingStatus: "PROCESSED" }), now),
    ).toBe("DUPLICATE");
    expect(decideProviderWebhookClaim(event({ processingStatus: "IGNORED" }), now)).toBe(
      "DUPLICATE",
    );
  });

  it("makes exhausted failures visible instead of claiming forever", () => {
    expect(
      decideProviderWebhookClaim(
        event({ attemptCount: 8, processingStatus: "FAILED" }),
        now,
      ),
    ).toBe("EXHAUSTED");
  });

  it("uses bounded exponential retry delays", () => {
    expect(providerWebhookRetryAt(1, now).getTime() - now.getTime()).toBe(5_000);
    expect(providerWebhookRetryAt(3, now).getTime() - now.getTime()).toBe(20_000);
    expect(providerWebhookRetryAt(20, now).getTime() - now.getTime()).toBe(5 * 60_000);
  });

  it("allows only one concurrent claimant", async () => {
    let claimed = false;
    const store: ProviderWebhookInboxStore = {
      claim: async () => {
        if (claimed) {
          return null;
        }

        claimed = true;
        return event({ attemptCount: 1, processingStatus: "PROCESSING" });
      },
      complete: async () => true,
      fail: async () => true,
      receive: async () => event(),
    };
    const inbox = createProviderWebhookInbox(store, { clock: () => now });

    const claims = await Promise.all([inbox.claim(event()), inbox.claim(event())]);

    expect(claims.filter((claim) => claim.decision === "CLAIM")).toHaveLength(1);
    expect(claims.filter((claim) => claim.decision === "PROCESSING")).toHaveLength(1);
  });

  it("lists a bounded recovery batch with the claim lease", async () => {
    const inputs: Parameters<
      ProviderWebhookInboxMaintenanceStore["listRecoverable"]
    >[0][] = [];
    const recoverable = event({ processingStatus: "FAILED" });
    const store: ProviderWebhookInboxStore & ProviderWebhookInboxMaintenanceStore = {
      claim: async () => null,
      complete: async () => true,
      fail: async () => true,
      listRecoverable: async (value) => {
        inputs.push(value);
        return [recoverable];
      },
      receive: async () => event(),
      redactPayloads: async () => 0,
    };
    const inbox = createProviderWebhookInbox(store, {
      clock: () => now,
      maxAttempts: 4,
      processingLeaseMs: 60_000,
    });

    await expect(inbox.listRecoverable(10_000)).resolves.toEqual([recoverable]);
    expect(inputs[0]).toEqual({
      limit: 500,
      maxAttempts: 4,
      now,
      staleBefore: new Date(now.getTime() - 60_000),
    });
  });

  it("bounds a payload redaction batch", async () => {
    const inputs: Parameters<
      ProviderWebhookInboxMaintenanceStore["redactPayloads"]
    >[0][] = [];
    const store: ProviderWebhookInboxStore & ProviderWebhookInboxMaintenanceStore = {
      claim: async () => null,
      complete: async () => true,
      fail: async () => true,
      listRecoverable: async () => [],
      receive: async () => event(),
      redactPayloads: async (value) => {
        inputs.push(value);
        return 2;
      },
    };
    const inbox = createProviderWebhookInbox(store, { maxAttempts: 4 });
    const before = new Date("2026-07-01T00:00:00.000Z");

    await expect(inbox.redactPayloads({ before, limit: 10_000 })).resolves.toBe(2);
    expect(inputs[0]).toEqual({ before, limit: 500, maxAttempts: 4 });
  });
});
