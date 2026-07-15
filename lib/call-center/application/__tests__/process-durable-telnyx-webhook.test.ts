import { describe, expect, it } from "bun:test";

import type { TelnyxVoiceWebhookEnvelope } from "../../infrastructure/telnyx-voice-envelope";
import { createDurableTelnyxWebhookCoordinator } from "../process-durable-telnyx-webhook";

const envelope = {
  body: { data: { event_type: "call.initiated", id: "provider-1", payload: {} } },
  eventType: "call.initiated",
  occurredAt: null,
  providerEventId: "provider-1",
} satisfies TelnyxVoiceWebhookEnvelope;

describe("durable Telnyx webhook coordination", () => {
  it("returns the provider result without exposing the internal inbox ID", async () => {
    const scheduled: string[] = [];
    const process = createDurableTelnyxWebhookCoordinator({
      processInbox: async () => ({
        duplicate: false,
        processingStatus: "PROCESSED",
        providerWebhookEventId: "inbox-1",
      }),
      scheduleCanonical: (eventId) => scheduled.push(eventId),
    });

    await expect(process(envelope)).resolves.toEqual({
      duplicate: false,
      processingStatus: "PROCESSED",
    });
    expect(scheduled).toEqual(["inbox-1"]);
  });

  it("contains scheduling failure without replaying inbox admission", async () => {
    let legacyCalls = 0;
    const process = createDurableTelnyxWebhookCoordinator({
      processInbox: async () => {
        legacyCalls += 1;
        return { ok: true, providerWebhookEventId: "inbox-1" };
      },
      scheduleCanonical: () => {
        throw new Error("post-response scheduler failed");
      },
    });

    await expect(process(envelope)).resolves.toEqual({ ok: true });
    expect(legacyCalls).toBe(1);
  });
});
