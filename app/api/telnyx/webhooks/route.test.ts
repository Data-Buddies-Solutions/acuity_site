import { describe, expect, it } from "bun:test";

import { createTelnyxWebhookHandler } from "./handler";

describe("Telnyx webhook", () => {
  it("acknowledges a durable voice event before projection work", async () => {
    let deferred: (() => Promise<void>) | null = null;
    let projections = 0;
    const handler = createTelnyxWebhookHandler({
      defer: (work) => {
        deferred = work as () => Promise<void>;
      },
      parseVoiceEnvelope: () => ({
        body: {},
        eventType: "call.answered",
        occurredAt: new Date("2026-07-23T16:00:00.000Z"),
        providerEventId: "provider-event-1",
        receivedAt: new Date("2026-07-23T16:00:00.000Z"),
      }),
      processProviderRecord: async () => {
        projections += 1;
        return {
          duplicate: false,
          errorCode: "CANONICAL_PRISMA_P2028",
          outcome: "FAILED",
          providerWebhookEventId: "event-1",
        };
      },
      receiveProviderEvent: async () => ({
        attemptCount: 0,
        directHandoffTokenHash: null,
        errorCode: null,
        eventType: "call.answered",
        id: "event-1",
        nextAttemptAt: null,
        payload: {},
        processedAt: null,
        processingStatus: "RECEIVED",
        providerCallSessionId: "session-1",
        providerEventId: "provider-event-1",
        receivedAt: new Date("2026-07-23T16:00:00.000Z"),
        updatedAt: new Date("2026-07-23T16:00:00.000Z"),
      }),
      verifySignature: () => true,
    });
    const request = new Request("https://example.test/api/telnyx/webhooks", {
      body: JSON.stringify({
        data: { event_type: "call.answered", id: "provider-event-1" },
      }),
      headers: {
        "content-type": "application/json",
        "telnyx-signature-ed25519": "signature",
        "telnyx-timestamp": "timestamp",
      },
      method: "POST",
    });

    const response = await handler(request as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      durable: true,
      ok: true,
      processingStatus: "RECEIVED",
    });
    expect(projections).toBe(0);
    expect(deferred).not.toBeNull();
    await deferred!();
    expect(projections).toBe(1);
  });

  it("asks Telnyx to retry when durable receipt fails", async () => {
    let deferred = false;
    const handler = createTelnyxWebhookHandler({
      defer: () => {
        deferred = true;
      },
      parseVoiceEnvelope: () => ({
        body: {},
        eventType: "call.answered",
        occurredAt: new Date("2026-07-23T16:00:00.000Z"),
        providerEventId: "provider-event-1",
      }),
      receiveProviderEvent: async () => {
        throw new Error("database unavailable");
      },
      verifySignature: () => true,
    });
    const request = new Request("https://example.test/api/telnyx/webhooks", {
      body: JSON.stringify({
        data: { event_type: "call.answered", id: "provider-event-1" },
      }),
      headers: {
        "content-type": "application/json",
        "telnyx-signature-ed25519": "signature",
        "telnyx-timestamp": "timestamp",
      },
      method: "POST",
    });

    const response = await handler(request as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to process webhook",
    });
    expect(deferred).toBe(false);
  });
});
