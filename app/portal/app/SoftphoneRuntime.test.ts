import { describe, expect, it } from "bun:test";

import type { MediaObservation } from "./call-center/softphone-media-adapter";
import { phoneOwnerMessageError, selectSoftphoneRuntimeCalls } from "./SoftphoneRuntime";

function observation(
  mediaLegId: string,
  state: MediaObservation["state"],
): MediaObservation {
  return {
    connectionId: "connection-1",
    direction: "INBOUND",
    mediaLegId,
    providerCallControlId: null,
    providerCallLegId: null,
    providerCallSessionId: null,
    remoteAudioReady: false,
    state,
  };
}

describe("Softphone Runtime", () => {
  it("turns another tab's ownership event into the active-elsewhere banner", () => {
    expect(phoneOwnerMessageError({ clientInstanceId: "tab-2" }, "tab-1")).toBe(
      "Phone active in another tab",
    );
    expect(phoneOwnerMessageError({ clientInstanceId: "tab-1" }, "tab-1")).toBeNull();
  });

  it("keeps multiple incoming Telnyx calls and drives one ringtone", () => {
    const result = selectSoftphoneRuntimeCalls(
      [observation("leg-1", "RINGING"), observation("leg-2", "RINGING")],
      null,
    );

    expect(result.incoming.map(({ mediaLegId }) => mediaLegId)).toEqual([
      "leg-1",
      "leg-2",
    ]);
    expect(result.ringtoneOfferId).toBe("leg-1");
  });

  it("stops local ringing as soon as one answer begins", () => {
    const result = selectSoftphoneRuntimeCalls(
      [observation("leg-1", "RINGING"), observation("leg-2", "RINGING")],
      "leg-2",
    );

    expect(result.incoming).toHaveLength(2);
    expect(result.ringtoneOfferId).toBeNull();
  });
});
