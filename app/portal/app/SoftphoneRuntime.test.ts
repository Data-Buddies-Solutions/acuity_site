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

  it("keeps the answered leg owned while its local media is active or held", () => {
    const states = ["ACTIVE", "HELD"] as const;

    expect(
      states.map(
        (state) =>
          selectSoftphoneRuntimeCalls([observation("leg-1", state)], "leg-1")
            .answeringMediaLegId,
      ),
    ).toEqual(["leg-1", "leg-1"]);
  });

  it("releases the answered leg without known-live local media", () => {
    const states = ["ENDED", "FAILED", "UNKNOWN"] as const;

    expect(
      states.map(
        (state) =>
          selectSoftphoneRuntimeCalls([observation("leg-1", state)], "leg-1")
            .answeringMediaLegId,
      ),
    ).toEqual([null, null, null]);
    expect(selectSoftphoneRuntimeCalls([], "leg-1").answeringMediaLegId).toBeNull();
  });
});
