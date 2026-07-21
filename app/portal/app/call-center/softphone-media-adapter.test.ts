import { describe, expect, it } from "bun:test";

import {
  normalizeMediaObservation,
  upsertMediaObservation,
} from "./softphone-media-adapter";

describe("softphone media adapter", () => {
  it("normalizes Telnyx identifiers without caller-phone correlation", () => {
    expect(
      normalizeMediaObservation({
        clientState: btoa(
          JSON.stringify({
            callId: "canonical-call-1",
            canonicalCommand: true,
            legId: "canonical-leg-1",
          }),
        ),
        connectionId: " browser-connection ",
        direction: "incoming",
        mediaLegId: " sdk-call-id ",
        providerCallControlId: " call-control-id ",
        providerCallLegId: " call-leg-id ",
        providerCallSessionId: " call-session-id ",
        remoteAudioReady: true,
        state: "active",
      }),
    ).toEqual({
      canonicalCallId: "canonical-call-1",
      canonicalLegId: "canonical-leg-1",
      connectionId: "browser-connection",
      direction: "INBOUND",
      mediaLegId: "sdk-call-id",
      providerCallControlId: "call-control-id",
      providerCallLegId: "call-leg-id",
      providerCallSessionId: "call-session-id",
      remoteAudioReady: true,
      state: "ACTIVE",
    });
  });

  it("ignores malformed and non-canonical client state", () => {
    for (const clientState of ["not-base64", btoa(JSON.stringify({ legId: "leg-1" }))]) {
      expect(
        normalizeMediaObservation({
          clientState,
          connectionId: "connection-1",
          mediaLegId: "media-leg-1",
          remoteAudioReady: false,
        }),
      ).toMatchObject({ canonicalCallId: null, canonicalLegId: null });
    }
  });

  it("keeps correlation on connection and media leg IDs as provider IDs arrive", () => {
    const ringing = normalizeMediaObservation({
      connectionId: "connection-1",
      mediaLegId: "media-leg-1",
      remoteAudioReady: false,
      state: "ringing",
    });
    const active = normalizeMediaObservation({
      connectionId: "connection-1",
      mediaLegId: "media-leg-1",
      providerCallControlId: "control-1",
      providerCallLegId: "provider-leg-1",
      providerCallSessionId: "session-1",
      remoteAudioReady: true,
      state: "active",
    });

    expect(upsertMediaObservation([ringing], active)).toEqual([active]);
  });

  it("does not merge the same media leg ID across provider connections", () => {
    const first = normalizeMediaObservation({
      connectionId: "connection-1",
      mediaLegId: "media-leg-1",
      remoteAudioReady: false,
      state: "ringing",
    });
    const reconnected = normalizeMediaObservation({
      connectionId: "connection-2",
      mediaLegId: "media-leg-1",
      remoteAudioReady: false,
      state: "ringing",
    });

    expect(upsertMediaObservation([first], reconnected)).toEqual([first, reconnected]);
  });

  it("rejects observations without stable adapter identities", () => {
    expect(() =>
      normalizeMediaObservation({
        connectionId: "",
        mediaLegId: "media-leg-1",
        remoteAudioReady: false,
      }),
    ).toThrow("Media observations require connection and media leg IDs");
  });

  it("treats provider answer and recovery transitions as connecting", () => {
    for (const state of ["answering", "recovering"]) {
      expect(
        normalizeMediaObservation({
          connectionId: "connection-1",
          mediaLegId: `media-leg-${state}`,
          remoteAudioReady: false,
          state,
        }).state,
      ).toBe("CONNECTING");
    }
  });

  it("treats provider purge as an ended media leg", () => {
    expect(
      normalizeMediaObservation({
        connectionId: "connection-1",
        mediaLegId: "media-leg-1",
        remoteAudioReady: false,
        state: "purge",
      }).state,
    ).toBe("ENDED");
  });

  it("keeps an explicit provider failure terminal", () => {
    expect(
      normalizeMediaObservation({
        connectionId: "connection-1",
        mediaLegId: "media-leg-1",
        remoteAudioReady: false,
        state: "failed",
      }).state,
    ).toBe("FAILED");
  });
});
