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
  it("returns the legacy result without exposing the internal inbox ID", async () => {
    const scheduled: string[] = [];
    const process = createDurableTelnyxWebhookCoordinator({
      processLegacy: async () => ({
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

  it("contains scheduling failure without replaying legacy effects", async () => {
    let legacyCalls = 0;
    const process = createDurableTelnyxWebhookCoordinator({
      processLegacy: async () => {
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
