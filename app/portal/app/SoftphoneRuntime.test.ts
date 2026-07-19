import { describe, expect, it } from "bun:test";

import type { MediaObservation } from "./call-center/softphone-media-adapter";
import type { AgentSessionView, CallView } from "@/lib/call-center/realtime-contract";
import {
  createSoftphoneRuntimeCallActions,
  isCanonicalOfferAnswerable,
  phoneOwnerMessageError,
  selectSoftphoneRuntimeBinding,
  selectSoftphoneRuntimeCalls,
} from "./SoftphoneRuntime";

function observation(
  mediaLegId: string,
  state: MediaObservation["state"],
): MediaObservation {
  return {
    availability: "READY",
    connectionId: "connection-1",
    correlationProviderIds: [],
    direction: "INBOUND",
    mediaLegId,
    providerCallControlId: null,
    providerCallLegId: null,
    providerCallSessionId: null,
    recoveredMediaLegId: null,
    recoveryGeneration: 0,
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

  it("allows Answer only while the exact canonical Call can still be won", () => {
    const ringing = { id: "call-1", status: "RINGING" as const, winningLegId: null };

    expect(isCanonicalOfferAnswerable("call-1", [ringing])).toBe(true);
    expect(
      isCanonicalOfferAnswerable("call-1", [
        ringing,
        { id: "call-2", status: "CONNECTED", winningLegId: "leg-2" },
      ]),
    ).toBe(false);
    expect(
      isCanonicalOfferAnswerable("call-1", [{ ...ringing, winningLegId: "leg-1" }]),
    ).toBe(false);
  });

  it("routes logical Call actions to the current recovered SDK object", async () => {
    const call: CallView = {
      answeredAt: null,
      callerName: null,
      direction: "INBOUND",
      endedAt: null,
      fromPhone: "+15555550100",
      id: "call-1",
      legs: [
        {
          agentSessionId: "session-1",
          endpointId: "endpoint-1",
          id: "leg-1",
          kind: "AGENT",
          providerCallControlId: "control-1",
          providerCallLegId: "provider-leg-1",
          providerCallSessionId: "provider-session-1",
          status: "RINGING",
        },
      ],
      queueId: "queue-1",
      receivedAt: "2026-07-19T12:00:00.000Z",
      stateVersion: 1,
      status: "RINGING",
      toPhone: "+15555550199",
      winningLegId: null,
    };
    const session = {
      endpointId: "endpoint-1",
      id: "session-1",
    } satisfies Pick<AgentSessionView, "endpointId" | "id">;
    const recovered = {
      ...observation("media-leg-2", "RINGING"),
      correlationProviderIds: [
        {
          providerCallControlId: "control-1",
          providerCallLegId: "provider-leg-1",
          providerCallSessionId: "provider-session-1",
        },
      ],
      recoveredMediaLegId: "media-leg-1",
      recoveryGeneration: 1,
    };
    const invoked: string[] = [];
    const actions = createSoftphoneRuntimeCallActions(
      (callId) => selectSoftphoneRuntimeBinding(callId, [call], session, [recovered]),
      {
        activate: (mediaLegId) => invoked.push(`activate:${mediaLegId}`),
        answer: async (mediaLegId) => {
          invoked.push(`answer:${mediaLegId}`);
        },
        hangup: (mediaLegId) => invoked.push(`hangup:${mediaLegId}`),
        mute: (mediaLegId, muted) => invoked.push(`mute:${mediaLegId}:${muted}`),
      },
    );

    await actions.answer(call.id);
    actions.activate(call.id);
    actions.mute(call.id, true);
    actions.hangup(call.id);

    expect(invoked).toEqual([
      "answer:media-leg-2",
      "activate:media-leg-2",
      "mute:media-leg-2:true",
      "hangup:media-leg-2",
    ]);
  });
});
