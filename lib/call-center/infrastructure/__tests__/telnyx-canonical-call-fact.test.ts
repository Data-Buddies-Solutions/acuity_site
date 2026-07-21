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
  it("keeps a provider-originated outbound call ringing until an agent bridges", () => {
    expect(
      resolveCanonicalTelnyxCallObservations("call.answered", "CUSTOMER", "OUTBOUND"),
    ).toEqual({
      callObservation: "RINGING",
      legObservation: "ANSWERED",
    });
  });

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
      canonicalCallId: null,
      canonicalLegId: null,
      direction: "INBOUND",
      fromPhone: "+17865550100",
      legKind: "CUSTOMER",
      providerCommandId: null,
      providerCommandIdSource: null,
      toPhone: "+17864657479",
    });
  });

  it("classifies a linked station leg from trusted client state", () => {
    const clientState = Buffer.from(
      JSON.stringify({
        callId: "call-1",
        endpointId: "endpoint-1",
        legId: "leg-1",
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
          command_id: "command-1",
          direction: "outgoing",
        }),
        receivedAt,
      ),
    ).toMatchObject({
      canonicalCallId: "call-1",
      canonicalLegId: "leg-1",
      clientQueueItemId: "queue-item-1",
      endpointId: "endpoint-1",
      legKind: "AGENT",
      providerCommandId: "command-1",
      providerCommandIdSource: "PAYLOAD",
    });
  });

  it("treats an opaque outbound token as agent context without trusting IDs", () => {
    const clientState = Buffer.from(
      JSON.stringify({
        canonicalOutboundToken: "opaque-token",
        practiceId: "practice-1",
        version: 1,
      }),
    ).toString("base64");

    expect(
      parseCanonicalTelnyxCallFact(
        envelope("call.initiated", {
          call_control_id: "control-outbound",
          call_leg_id: "leg-outbound",
          call_session_id: "session-outbound",
          client_state: clientState,
          direction: "outgoing",
          from: "+15555550000",
          to: "+15555550123",
        }),
        receivedAt,
      ),
    ).toMatchObject({
      canonicalCallId: null,
      canonicalLegId: null,
      direction: "OUTBOUND",
      endpointId: null,
      legKind: "AGENT",
    });
  });

  it("ignores provider events that do not change canonical call facts", () => {
    expect(
      parseCanonicalTelnyxCallFact(
        envelope("call.dtmf.received", { call_control_id: "control-1" }),
        receivedAt,
      ),
    ).toBeNull();
  });

  it("retains exact lifecycle callback correlation from command client state", () => {
    for (const eventType of [
      "call.answered",
      "call.playback.started",
      "call.playback.ended",
      "call.speak.started",
      "call.recording.error",
      "call.hangup",
    ]) {
      const clientState = Buffer.from(
        JSON.stringify({
          callId: "call-1",
          canonicalCommand: true,
          commandId: `command-${eventType}`,
          legId: "customer-leg-1",
        }),
      ).toString("base64");
      expect(
        parseCanonicalTelnyxCallFact(
          envelope(eventType, {
            call_control_id: "control-customer",
            call_leg_id: "provider-leg-customer",
            call_session_id: "session-1",
            client_state: clientState,
            direction: "incoming",
          }),
          receivedAt,
        ),
      ).toMatchObject({
        canonicalCallId: "call-1",
        canonicalLegId: "customer-leg-1",
        eventType,
        providerCommandId: `command-${eventType}`,
        providerCommandIdSource: "CLIENT_STATE",
      });
    }
  });

  it("retains the bounded playback ending status", () => {
    expect(
      parseCanonicalTelnyxCallFact(
        envelope("call.playback.ended", {
          call_control_id: "control-customer",
          call_leg_id: "provider-leg-customer",
          command_id: "command-1",
          direction: "incoming",
          status: "FILE_NOT_FOUND",
        }),
        receivedAt,
      ),
    ).toMatchObject({ playbackStatus: "file_not_found" });
  });

  it("accepts a call-level voicemail fact with only the customer session identity", () => {
    expect(
      parseCanonicalTelnyxCallFact(
        envelope("calls.voicemail.completed", {
          call_session_id: "session-1",
          direction: "incoming",
          duration_secs: 12.4,
          recording_id: "recording-1",
          recording_urls: { mp3: "https://example.test/voicemail.mp3" },
        }),
        receivedAt,
      ),
    ).toMatchObject({
      legKind: "CUSTOMER",
      providerCallSessionId: "session-1",
      recordingDurationSec: 12,
      recordingId: "recording-1",
      recordingUrl: "https://example.test/voicemail.mp3",
    });
  });

  it("derives recording duration from Telnyx recording timestamps", () => {
    expect(
      parseCanonicalTelnyxCallFact(
        envelope("call.recording.saved", {
          call_session_id: "session-1",
          client_state: Buffer.from(
            JSON.stringify({
              callId: "call-1",
              canonicalCommand: true,
              commandId: "record-command-1",
              legId: "customer-leg-1",
            }),
          ).toString("base64"),
          public_recording_urls: { mp3: "https://example.test/voicemail.mp3" },
          recording_ended_at: "2026-07-11T10:00:12.400Z",
          recording_id: "recording-1",
          recording_started_at: "2026-07-11T10:00:00.000Z",
        }),
        receivedAt,
      ),
    ).toMatchObject({
      recordingDurationSec: 12,
      recordingId: "recording-1",
      recordingUrl: "https://example.test/voicemail.mp3",
    });
  });

  it("prefers numeric recording duration over derived timestamps", () => {
    expect(
      parseCanonicalTelnyxCallFact(
        envelope("call.recording.saved", {
          call_session_id: "session-1",
          command_id: "record-command-1",
          duration_secs: 4,
          public_recording_urls: { mp3: "https://example.test/voicemail.mp3" },
          recording_ended_at: "2026-07-11T10:00:12.000Z",
          recording_id: "recording-1",
          recording_started_at: "2026-07-11T10:00:00.000Z",
        }),
        receivedAt,
      ),
    ).toMatchObject({ recordingDurationSec: 4 });
  });

  it("safely rejects invalid, missing, or reversed recording timestamps", () => {
    for (const timestamps of [
      {
        recording_ended_at: "2026-07-11T10:00:12.000Z",
        recording_started_at: "invalid",
      },
      { recording_started_at: "2026-07-11T10:00:00.000Z" },
      {
        recording_ended_at: "2026-07-11T10:00:00.000Z",
        recording_started_at: "2026-07-11T10:00:12.000Z",
      },
    ]) {
      expect(
        parseCanonicalTelnyxCallFact(
          envelope("call.recording.saved", {
            call_session_id: "session-1",
            command_id: "record-command-1",
            public_recording_urls: { mp3: "https://example.test/voicemail.mp3" },
            recording_id: "recording-1",
            ...timestamps,
          }),
          receivedAt,
        ),
      ).toMatchObject({ recordingDurationSec: 0 });
    }
  });

  it("recognizes exact customer greeting completion and recording evidence", () => {
    const clientState = (commandId: string) =>
      Buffer.from(
        JSON.stringify({
          callId: "call-1",
          canonicalCommand: true,
          commandId,
          legId: "customer-leg-1",
        }),
      ).toString("base64");

    expect(
      parseCanonicalTelnyxCallFact(
        envelope("call.speak.ended", {
          call_control_id: "control-customer",
          call_session_id: "session-1",
          client_state: clientState("greeting-command-1"),
        }),
        receivedAt,
      ),
    ).toMatchObject({
      legKind: "CUSTOMER",
      providerCommandId: "greeting-command-1",
      recordingId: null,
    });

    expect(
      parseCanonicalTelnyxCallFact(
        envelope("call.recording.saved", {
          call_session_id: "session-1",
          client_state: clientState("record-command-1"),
          duration_ms: 9_600,
          recording_id: "recording-1",
          public_recording_urls: { wav: "https://example.test/voicemail.wav" },
        }),
        receivedAt,
      ),
    ).toMatchObject({
      legKind: null,
      providerCommandId: "record-command-1",
      recordingDurationSec: 10,
      recordingId: "recording-1",
      recordingUrl: "https://example.test/voicemail.wav",
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
      toAddress: "sip:browser-seat@example.sip.telnyx.com",
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

  it("uses canonical IDs for exact lookup without inferring the stored leg kind", () => {
    const clientState = Buffer.from(
      JSON.stringify({ callId: "call-1", legId: "leg-1" }),
    ).toString("base64");

    expect(
      parseCanonicalTelnyxCallFact(
        envelope("call.bridged", {
          call_control_id: "control-agent",
          client_state: clientState,
          direction: "outgoing",
        }),
        receivedAt,
      ),
    ).toMatchObject({
      canonicalCallId: "call-1",
      canonicalLegId: "leg-1",
      legKind: null,
    });
  });

  it("rejects a partial canonical call-leg identity", () => {
    const clientState = Buffer.from(JSON.stringify({ callId: "call-1" })).toString(
      "base64",
    );

    expect(() =>
      parseCanonicalTelnyxCallFact(
        envelope("call.initiated", {
          call_control_id: "control-agent",
          client_state: clientState,
          direction: "outgoing",
        }),
        receivedAt,
      ),
    ).toThrow("CANONICAL_AGENT_LINK_INCOMPLETE");
  });

  it("fails visibly when canonical recording evidence is incomplete", () => {
    expect(() =>
      parseCanonicalTelnyxCallFact(
        envelope("call.recording.saved", {
          call_control_id: "control-1",
          call_session_id: "session-1",
        }),
        receivedAt,
      ),
    ).toThrow("CANONICAL_COMMAND_ID_MISSING");
    expect(() =>
      parseCanonicalTelnyxCallFact(
        envelope("call.recording.saved", {
          call_session_id: "session-1",
          command_id: "record-command-1",
          recording_id: "recording-1",
        }),
        receivedAt,
      ),
    ).toThrow("CANONICAL_RECORDING_URL_MISSING");
  });

  it("uses the durable command identity when recording_id is omitted", () => {
    expect(
      parseCanonicalTelnyxCallFact(
        envelope("call.recording.saved", {
          call_session_id: "session-1",
          command_id: "record-command-1",
          recording_urls: { mp3: "https://example.test/recording.mp3" },
        }),
        receivedAt,
      ),
    ).toMatchObject({ recordingId: "record-command-1" });
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
