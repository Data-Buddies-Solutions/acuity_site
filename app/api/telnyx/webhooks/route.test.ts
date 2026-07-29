import { describe, expect, it } from "bun:test";

import type { ProviderWebhookRecord } from "@/lib/call-center/infrastructure/provider-webhook-inbox";

import { createTelnyxWebhookHandler } from "./handler";

describe("Telnyx webhook", () => {
  it("acknowledges a durable voice event before projection work", async () => {
    let deferred: (() => Promise<void>) | null = null;
    let projections = 0;
    const handler = createTelnyxWebhookHandler({
      defer: (work) => {
        deferred = work as () => Promise<void>;
      },
      drainProviderEvents: async () => ({
        attempted: 0,
        failed: 0,
        processed: 0,
      }),
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

  it("hands a queued same-call callback off immediately without waiting for cron", async () => {
    const deferred: Array<() => Promise<void>> = [];
    const projected: string[] = [];
    const pending = new Map<string, ProviderWebhookRecord>();
    let active = false;
    let releaseFirst!: () => void;
    const firstProjectionBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstProjectionStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      firstProjectionStarted = resolve;
    });

    const processProviderRecord = async (record: ProviderWebhookRecord) => {
      if (active) {
        throw Object.assign(new Error("same-call callback is already processing"), {
          status: 503,
        });
      }
      active = true;
      try {
        if (record.id === "event-1") {
          firstProjectionStarted();
          await firstProjectionBlocked;
        }
        projected.push(record.id);
        pending.delete(record.id);
        return {
          duplicate: false as const,
          outcome: "PROCESSED" as const,
          projection: {
            callId: "call-1",
            callStatus: "RINGING",
            commandIds: [],
            legId: "leg-1",
            legStatus: "RINGING",
            practiceId: "practice-1",
          },
          providerWebhookEventId: record.id,
        };
      } finally {
        active = false;
      }
    };

    const handler = createTelnyxWebhookHandler({
      defer: (work) => {
        deferred.push(work as () => Promise<void>);
      },
      drainProviderEvents: async () => {
        for (const record of pending.values()) {
          try {
            await processProviderRecord(record);
          } catch {
            // Another callback still owns this session. Its completion performs
            // the immediate handoff.
          }
        }
        return { attempted: 0, failed: 0, processed: 0 };
      },
      parseVoiceEnvelope: (body) => {
        const envelopeBody = body as {
          data: { event_type: string; id: string };
        };
        const providerEventId = envelopeBody.data.id;
        return {
          body: envelopeBody,
          eventType: "call.answered",
          occurredAt: new Date("2026-07-29T10:48:00.000Z"),
          providerEventId,
        };
      },
      processProviderRecord,
      receiveProviderEvent: async (envelope) => {
        const receivedAt = envelope.occurredAt ?? new Date("2026-07-29T10:48:00.000Z");
        const record = {
          attemptCount: 0,
          directHandoffTokenHash: null,
          errorCode: null,
          eventType: envelope.eventType,
          id: envelope.providerEventId.replace("provider-", ""),
          nextAttemptAt: null,
          payload: envelope.body,
          processedAt: null,
          processingStatus: "RECEIVED" as const,
          providerCallSessionId: "same-provider-session",
          providerEventId: envelope.providerEventId,
          receivedAt,
          updatedAt: receivedAt,
        };
        pending.set(record.id, record);
        return record;
      },
      verifySignature: () => true,
    });

    const request = (providerEventId: string) =>
      new Request("https://example.test/api/telnyx/webhooks", {
        body: JSON.stringify({
          data: { event_type: "call.answered", id: providerEventId },
        }),
        headers: {
          "content-type": "application/json",
          "telnyx-signature-ed25519": "signature",
          "telnyx-timestamp": "timestamp",
        },
        method: "POST",
      });

    await handler(request("provider-event-1") as never);
    await handler(request("provider-event-2") as never);

    const firstWork = deferred[0]!();
    await firstStarted;
    await deferred[1]!();
    expect(projected).toEqual([]);

    releaseFirst();
    await firstWork;

    expect(projected).toEqual(["event-1", "event-2"]);
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
