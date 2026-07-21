import { describe, expect, it } from "bun:test";

import type { MediaObservation } from "./call-center/softphone-media-adapter";
import {
  canonicalAvailabilityIntent,
  phoneOwnerMessageError,
  releaseProvisionalSuppressedRingtoneOffers,
  scheduleOutboundOperationExpiry,
  selectSoftphoneRuntimeCalls,
  updateOutboundOperationFromMedia,
  updateSuppressedRingtoneOffers,
} from "./SoftphoneRuntime";

function observation(
  mediaLegId: string,
  state: MediaObservation["state"],
  canonicalIdentity?: { callId: string; legId: string },
): MediaObservation {
  return {
    canonicalCallId: canonicalIdentity?.callId ?? null,
    canonicalLegId: canonicalIdentity?.legId ?? null,
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
  it("adopts a newer canonical pause for the same session", () => {
    expect(canonicalAvailabilityIntent({ presence: "PAUSED" })).toBe("PAUSED");
  });

  it("expires an outbound operation when no media observation arrives", async () => {
    let expired = false;
    scheduleOutboundOperationExpiry(() => {
      expired = true;
    }, 0);

    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(expired).toBe(true);
  });

  it("allows outbound expiry to be cancelled after terminal reconciliation", async () => {
    let expired = false;
    const cancel = scheduleOutboundOperationExpiry(() => {
      expired = true;
    }, 0);
    cancel();

    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(expired).toBe(false);
  });

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

  it("does not ring an inbound offer while an outbound agent leg is connecting", () => {
    const result = selectSoftphoneRuntimeCalls(
      [
        observation("outbound-agent-leg", "RINGING"),
        observation("inbound-offer", "RINGING"),
      ],
      null,
      { outboundOperationActive: true },
    );

    expect(result.ringtoneOfferId).toBeNull();
  });

  it("clears outbound suppression when the media leg fails before answer", () => {
    const canonicalIdentity = {
      callId: "canonical-outbound-call",
      legId: "canonical-outbound-leg",
    };
    const ringing = updateOutboundOperationFromMedia(
      {
        active: true,
        canonicalCallId: canonicalIdentity.callId,
        canonicalLegId: canonicalIdentity.legId,
        mediaLegId: null,
      },
      observation("outbound-agent-leg", "RINGING", canonicalIdentity),
    );
    const failed = updateOutboundOperationFromMedia(
      ringing,
      observation("outbound-agent-leg", "FAILED", canonicalIdentity),
    );

    expect(ringing).toEqual({
      active: true,
      canonicalCallId: canonicalIdentity.callId,
      canonicalLegId: canonicalIdentity.legId,
      mediaLegId: "outbound-agent-leg",
    });
    expect(failed).toEqual({
      active: false,
      canonicalCallId: null,
      canonicalLegId: null,
      mediaLegId: null,
    });
  });

  it("does not treat a concurrent inbound offer as the outbound media leg", () => {
    expect(
      updateOutboundOperationFromMedia(
        {
          active: true,
          canonicalCallId: "canonical-outbound-call",
          canonicalLegId: "canonical-outbound-leg",
          mediaLegId: null,
        },
        observation("concurrent-inbound-offer", "RINGING", {
          callId: "canonical-inbound-call",
          legId: "canonical-inbound-leg",
        }),
      ),
    ).toEqual({
      active: true,
      canonicalCallId: "canonical-outbound-call",
      canonicalLegId: "canonical-outbound-leg",
      mediaLegId: null,
    });
  });

  it("clears outbound suppression from an exact terminal observation", () => {
    expect(
      updateOutboundOperationFromMedia(
        {
          active: true,
          canonicalCallId: "canonical-outbound-call",
          canonicalLegId: "canonical-outbound-leg",
          mediaLegId: null,
        },
        observation("outbound-agent-leg", "FAILED", {
          callId: "canonical-outbound-call",
          legId: "canonical-outbound-leg",
        }),
      ),
    ).toEqual({
      active: false,
      canonicalCallId: null,
      canonicalLegId: null,
      mediaLegId: null,
    });
  });

  it("does not revive a stale inbound offer after the outbound call ends", () => {
    const staleOffer = observation("stale-inbound-offer", "RINGING");
    const suppressedOfferIds = updateSuppressedRingtoneOffers([], staleOffer, true);

    expect(
      selectSoftphoneRuntimeCalls([staleOffer], null, { suppressedOfferIds })
        .ringtoneOfferId,
    ).toBeNull();
  });

  it("releases only offers provisionally suppressed by a rejected outbound call", () => {
    expect(
      releaseProvisionalSuppressedRingtoneOffers(
        ["previously-suppressed", "provisionally-suppressed"],
        ["previously-suppressed"],
      ),
    ).toEqual(["previously-suppressed"]);
  });

  it("allows a genuinely new offer after the stale outbound-era offer terminates", () => {
    const staleOffer = observation("stale-inbound-offer", "RINGING");
    const endedOffer = observation("stale-inbound-offer", "ENDED");
    const newOffer = observation("new-inbound-offer", "RINGING");
    const suppressedDuringOutbound = updateSuppressedRingtoneOffers([], staleOffer, true);
    const suppressedAfterTerminal = updateSuppressedRingtoneOffers(
      suppressedDuringOutbound,
      endedOffer,
      false,
    );

    expect(
      selectSoftphoneRuntimeCalls([newOffer], null, {
        suppressedOfferIds: suppressedAfterTerminal,
      }).ringtoneOfferId,
    ).toBe("new-inbound-offer");
  });

  it("does not ring while the canonical agent session is paused or offline", () => {
    expect(
      selectSoftphoneRuntimeCalls([observation("leg-1", "RINGING")], null, {
        enabled: false,
      }).ringtoneOfferId,
    ).toBeNull();
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
