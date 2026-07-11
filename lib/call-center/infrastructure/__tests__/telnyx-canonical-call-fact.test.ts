import { describe, expect, it } from "bun:test";

import {
  CanonicalTelnyxFactError,
  parseCanonicalTelnyxCallFact,
  resolveCanonicalTelnyxCallObservations,
  resolveCanonicalTelnyxLegKind,
} from "../telnyx-canonical-call-fact";

const receivedAt = new Date("2026-07-11T10:00:01.000Z");

function envelope(eventType: string, payload: Record<string, unknown>) {
  return {
    data: {
      event_type: eventType,
      id: `event-${eventType}`,
      occurred_at: "2026-07-11T10:00:00.000Z",
      payload,
    },
  };
}

describe("canonical Telnyx call facts", () => {
  it("classifies an inbound customer leg without retaining the raw envelope", () => {
    expect(
      parseCanonicalTelnyxCallFact(
        envelope("call.initiated", {
          call_control_id: "control-customer",
          call_leg_id: "leg-customer",
          call_session_id: "session-1",
          direction: "incoming",
          from: "+1 (786) 555-0100",
          to: "+1 786 465 7479",
        }),
        receivedAt,
      ),
    ).toMatchObject({
      direction: "INBOUND",
      fromPhone: "+17865550100",
      legKind: "CUSTOMER",
      toPhone: "+17864657479",
    });
  });

  it("classifies a linked station leg from trusted client state", () => {
    const clientState = Buffer.from(
      JSON.stringify({
        queueItemId: "queue-item-1",
        ringAttemptId: "attempt-1",
        seatId: "seat-1",
      }),
    ).toString("base64");

    expect(
      parseCanonicalTelnyxCallFact(
        envelope("call.bridged", {
          call_control_id: "control-agent",
          call_session_id: "session-agent",
          client_state: clientState,
          direction: "outgoing",
        }),
        receivedAt,
      ),
    ).toMatchObject({
      clientQueueItemId: "queue-item-1",
      endpointId: "seat-1",
      legKind: "AGENT",
    });
  });

  it("ignores provider events that do not change canonical call facts", () => {
    expect(
      parseCanonicalTelnyxCallFact(
        envelope("call.playback.started", { call_control_id: "control-1" }),
        receivedAt,
      ),
    ).toBeNull();
  });

  it("accepts a call-level voicemail fact with only the customer session identity", () => {
    expect(
      parseCanonicalTelnyxCallFact(
        envelope("calls.voicemail.completed", {
          call_session_id: "session-1",
          direction: "incoming",
        }),
        receivedAt,
      ),
    ).toMatchObject({
      legKind: "CUSTOMER",
      providerCallSessionId: "session-1",
    });
  });

  it("defers a later event without client state to exact stored leg identity", () => {
    const fact = parseCanonicalTelnyxCallFact(
      envelope("call.bridged", {
        call_control_id: "control-agent",
        call_session_id: "session-agent",
        direction: "outgoing",
        from: "+17864657479",
        to: "sip:browser-seat@example.sip.telnyx.com",
      }),
      receivedAt,
    );

    expect(fact).toMatchObject({
      legKind: null,
      providerCallControlId: "control-agent",
    });
    const legKind = resolveCanonicalTelnyxLegKind("AGENT", fact!.legKind);
    expect(legKind).toBe("AGENT");
    expect(
      resolveCanonicalTelnyxCallObservations(fact!.eventType, legKind, fact!.direction),
    ).toEqual({ callObservation: "CONNECTED", legObservation: "BRIDGED" });
    expect(() => resolveCanonicalTelnyxLegKind(null, fact!.legKind)).toThrow(
      "CANONICAL_LEG_CONTEXT_MISSING",
    );
  });

  it("does not treat a normal connected-call recording as voicemail", () => {
    expect(
      parseCanonicalTelnyxCallFact(
        envelope("call.recording.saved", {
          call_control_id: "control-1",
          call_session_id: "session-1",
        }),
        receivedAt,
      ),
    ).toBeNull();
  });

  it("rejects supported events without a stable leg identity", () => {
    expect(() =>
      parseCanonicalTelnyxCallFact(
        envelope("call.answered", { call_session_id: "session-1" }),
        receivedAt,
      ),
    ).toThrow(CanonicalTelnyxFactError);
  });
});
