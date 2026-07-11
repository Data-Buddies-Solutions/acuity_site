import { describe, expect, it } from "bun:test";

import {
  InvalidTelnyxVoiceWebhookEnvelopeError,
  parseTelnyxVoiceWebhookEnvelope,
} from "../telnyx-voice-envelope";

describe("parseTelnyxVoiceWebhookEnvelope", () => {
  it("extracts the durable event identity and preserves the verified body", () => {
    const body = {
      data: {
        event_type: "call.initiated",
        id: "event-1",
        occurred_at: "2026-07-11T10:00:00.000Z",
        payload: { call_control_id: "call-1" },
      },
    };

    const envelope = parseTelnyxVoiceWebhookEnvelope(body);

    expect(envelope).toEqual({
      body,
      eventType: "call.initiated",
      occurredAt: new Date("2026-07-11T10:00:00.000Z"),
      providerEventId: "event-1",
    });
  });

  it("falls back to the payload occurrence timestamp", () => {
    const envelope = parseTelnyxVoiceWebhookEnvelope({
      data: {
        event_type: "call.hangup",
        id: "event-2",
        payload: { occurred_at: "2026-07-11T10:05:00.000Z" },
      },
    });

    expect(envelope.occurredAt).toEqual(new Date("2026-07-11T10:05:00.000Z"));
  });

  it.each([
    null,
    {},
    { data: {} },
    { data: { event_type: "call.initiated", id: "event-1" } },
    { data: { event_type: "", id: "event-1", payload: {} } },
    { data: { event_type: "call.initiated", id: "", payload: {} } },
  ])("rejects an invalid voice envelope", (body) => {
    expect(() => parseTelnyxVoiceWebhookEnvelope(body)).toThrow(
      InvalidTelnyxVoiceWebhookEnvelopeError,
    );
  });
});
