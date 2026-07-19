import { describe, expect, it } from "bun:test";

import {
  createProviderWebhookInbox,
  decideProviderWebhookClaim,
  providerWebhookRetryAt,
  sanitizedProviderWebhookBody,
  type ProviderWebhookInboxStore,
  type ProviderWebhookRecord,
} from "../provider-webhook-inbox";

const now = new Date("2026-07-11T12:00:00.000Z");

function event(overrides: Partial<ProviderWebhookRecord> = {}): ProviderWebhookRecord {
  return {
    attemptCount: 0,
    directHandoffTokenHash: null,
    errorCode: null,
    eventType: "call.initiated",
    id: "inbox-1",
    nextAttemptAt: null,
    payload: { data: { id: "event-1" } },
    processedAt: null,
    processingStatus: "RECEIVED",
    providerCallSessionId: null,
    providerEventId: "event-1",
    receivedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("provider webhook claim decisions", () => {
  it("removes direct handoff tokens before durable persistence", () => {
    const token = "a".repeat(43);
    const sanitized = sanitizedProviderWebhookBody({
      data: {
        payload: {
          to: `sip:acuity-handoff~ah1~${token}@abitacallcenter.sip.telnyx.com`,
        },
      },
    });

    expect(sanitized.tokenHash).toHaveLength(64);
    expect(JSON.stringify(sanitized.body)).not.toContain(token);
  });

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

  it("leaves retry timing to the provider", () => {
    expect(providerWebhookRetryAt(1, now)).toBe(now);
    expect(providerWebhookRetryAt(20, now)).toBe(now);
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
      completeIgnored: async () => true,
      fail: async () => true,
      receive: async () => event(),
    };
    const inbox = createProviderWebhookInbox(store, { clock: () => now });

    const claims = await Promise.all([inbox.claim(event()), inbox.claim(event())]);

    expect(claims.filter((claim) => claim.decision === "CLAIM")).toHaveLength(1);
    expect(claims.filter((claim) => claim.decision === "PROCESSING")).toHaveLength(1);
  });
});
