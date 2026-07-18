import { describe, expect, it } from "bun:test";

import type { CallView } from "@/lib/call-center/realtime-contract";

import {
  canonicalOutboundIdempotencyKey,
  completeCanonicalOutboundOperation,
  selectCanonicalAgentActiveCall,
  selectCanonicalBrowserMediaLeg,
} from "./canonical-active-call-center";

const call: CallView = {
  answeredAt: null,
  callerName: null,
  direction: "INBOUND",
  endedAt: null,
  fromPhone: "+17865550100",
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
  receivedAt: "2026-07-12T12:00:00.000Z",
  stateVersion: 1,
  status: "RINGING",
  toPhone: "+17865550199",
  winningLegId: null,
};

const observation = {
  connectionId: "connection-1",
  direction: "INBOUND" as const,
  mediaLegId: "media-1",
  providerCallControlId: "control-1",
  providerCallLegId: "provider-leg-1",
  providerCallSessionId: "provider-session-1",
  remoteAudioReady: false,
  state: "RINGING" as const,
};

describe("canonical active call center correlation", () => {
  it("derives occupancy from the winning bridged leg instead of session pointers", () => {
    const connected = {
      ...call,
      answeredAt: "2026-07-12T12:00:10.000Z",
      legs: [{ ...call.legs[0]!, status: "BRIDGED" as const }],
      status: "CONNECTED" as const,
      winningLegId: "leg-1",
    };
    expect(
      selectCanonicalAgentActiveCall([call, connected], {
        endpointId: "endpoint-1",
        id: "session-1",
      }),
    ).toEqual(connected);
    expect(
      selectCanonicalAgentActiveCall([connected], {
        endpointId: "endpoint-2",
        id: "session-2",
      }),
    ).toBeNull();
  });

  it("matches one exact live provider leg and fails closed on ambiguity", () => {
    expect(
      selectCanonicalBrowserMediaLeg(call, "session-1", "endpoint-1", [observation]),
    ).toEqual({ leg: call.legs[0], observation });
    expect(
      selectCanonicalBrowserMediaLeg(call, "session-1", "endpoint-1", [
        observation,
        { ...observation, mediaLegId: "media-2" },
      ]),
    ).toBeNull();
  });

  it("reuses one outbound operation key until that operation completes", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const target = {
      clientInstanceId: "browser-1",
      destination: "+17865550100",
      numberId: "number-1",
      queueId: "queue-1",
    };
    const first = canonicalOutboundIdempotencyKey(storage, target, () => "one");
    expect(canonicalOutboundIdempotencyKey(storage, target, () => "two")).toBe(first);
    completeCanonicalOutboundOperation(storage, target, first);
    expect(canonicalOutboundIdempotencyKey(storage, target, () => "three")).not.toBe(
      first,
    );
  });
});
