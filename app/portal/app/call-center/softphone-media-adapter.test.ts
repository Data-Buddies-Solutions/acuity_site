import { describe, expect, it } from "bun:test";

import {
  normalizeMediaObservation,
  upsertMediaObservation,
} from "./softphone-media-adapter";

describe("softphone media adapter", () => {
  it("normalizes Telnyx identifiers without caller-phone correlation", () => {
    expect(
      normalizeMediaObservation({
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
      availability: "READY",
      connectionId: "browser-connection",
      correlationProviderIds: [
        {
          providerCallControlId: "call-control-id",
          providerCallLegId: "call-leg-id",
          providerCallSessionId: "call-session-id",
        },
      ],
      direction: "INBOUND",
      mediaLegId: "sdk-call-id",
      providerCallControlId: "call-control-id",
      providerCallLegId: "call-leg-id",
      providerCallSessionId: "call-session-id",
      recoveredMediaLegId: null,
      recoveryGeneration: 0,
      remoteAudioReady: true,
      state: "ACTIVE",
    });
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
});
