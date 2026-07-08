import { describe, expect, it } from "bun:test";

import { deriveLiveKitAgentCallSkeleton } from "@/lib/livekit-webhooks";

describe("deriveLiveKitAgentCallSkeleton", () => {
  it("builds an in-progress AgentCall skeleton from SIP participant attributes", () => {
    const skeleton = deriveLiveKitAgentCallSkeleton({
      createdAt: 1783512000,
      event: "participant_joined",
      id: "EV_joined",
      participant: {
        attributes: {
          "sip.callID": "SIP_call_123",
          "sip.phoneNumber": "+15551234567",
          "sip.trunkPhoneNumber": "+15557654321",
        },
        identity: "caller_identity",
        sid: "PA_123",
      },
      room: {
        creationTime: 1783511990,
        name: "room_123",
        sid: "RM_123",
      },
    });

    expect(skeleton).toMatchObject({
      callId: "SIP_call_123",
      callerPhone: "+15551234567",
      eventId: "EV_joined",
      eventType: "participant_joined",
      officePhone: "+15557654321",
      status: "IN_PROGRESS",
    });
    expect(skeleton?.livekitContext).toMatchObject({
      participantIdentity: "caller_identity",
      roomName: "room_123",
      roomSid: "RM_123",
      sipCallId: "SIP_call_123",
    });
  });

  it("marks terminal webhook-only skeletons as failed finalization fallbacks", () => {
    const skeleton = deriveLiveKitAgentCallSkeleton({
      createdAt: 1783512060,
      event: "participant_left",
      id: "EV_left",
      participant: {
        attributes: {
          "sip.callID": "SIP_call_123",
          "sip.phoneNumber": "+15551234567",
          "sip.trunkPhoneNumber": "+15557654321",
        },
        joinedAt: 1783512000,
        sid: "PA_123",
      },
      room: {
        name: "room_123",
        sid: "RM_123",
      },
    });

    expect(skeleton?.status).toBe("FAILED");
    expect(skeleton?.durationSec).toBe(60);
    expect(skeleton?.endedAt?.toISOString()).toBe("2026-07-08T12:01:00.000Z");
  });

  it("does not create an AgentCall skeleton for non-SIP events without phone routing data", () => {
    const skeleton = deriveLiveKitAgentCallSkeleton({
      createdAt: 1783512000,
      event: "room_started",
      id: "EV_room",
      room: {
        name: "room_123",
        sid: "RM_123",
      },
    });

    expect(skeleton).toBeNull();
  });
});
