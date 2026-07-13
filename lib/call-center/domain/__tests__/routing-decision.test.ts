import { describe, expect, it } from "bun:test";

import {
  decideInboundRouting,
  type RoutingQueueSnapshot,
  type RoutingSessionCandidate,
} from "../routing-decision";

const now = new Date("2026-07-12T12:00:00.000Z");

function session(
  id: string,
  endpointId: string,
  overrides: Partial<RoutingSessionCandidate> = {},
): RoutingSessionCandidate {
  return {
    audioReady: true,
    connectionState: "READY",
    currentCallId: null,
    offeredCallId: null,
    endpoint: {
      configured: true,
      enabled: true,
      id: endpointId,
      locationId: "location-1",
    },
    id,
    leaseExpiresAt: new Date(now.getTime() + 30_000),
    microphoneReady: true,
    presence: "AVAILABLE",
    ...overrides,
  };
}

function queue(overrides: Partial<RoutingQueueSnapshot> = {}): RoutingQueueSnapshot {
  return {
    enabled: true,
    id: "queue-1",
    locationIds: ["location-1"],
    members: [],
    ...overrides,
  };
}

describe("inbound routing decision", () => {
  it("selects only eligible sessions in stable endpoint and session order", () => {
    const result = decideInboundRouting(
      queue({
        members: [
          {
            enabled: true,
            userId: "user-2",
            sessions: [session("session-2", "endpoint-b")],
          },
          {
            enabled: true,
            userId: "user-1",
            sessions: [
              session("session-3", "endpoint-a"),
              session("session-1", "endpoint-a"),
            ],
          },
        ],
      }),
      now,
    );

    expect(result.eligible).toEqual([
      { agentSessionId: "session-1", endpointId: "endpoint-a", userId: "user-1" },
      { agentSessionId: "session-3", endpointId: "endpoint-a", userId: "user-1" },
      { agentSessionId: "session-2", endpointId: "endpoint-b", userId: "user-2" },
    ]);
    expect(Object.values(result.exclusions).reduce((sum, count) => sum + count, 0)).toBe(
      0,
    );
  });

  it("rejects expired readiness, wrong locations, and occupied sessions", () => {
    const result = decideInboundRouting(
      queue({
        members: [
          {
            enabled: true,
            userId: "user-1",
            sessions: [
              session("expired", "endpoint-1", { leaseExpiresAt: now }),
              session("wrong-location", "endpoint-2", {
                endpoint: {
                  configured: true,
                  enabled: true,
                  id: "endpoint-2",
                  locationId: "location-2",
                },
              }),
              session("offered", "endpoint-4", { offeredCallId: "call-ringing" }),
              session("busy", "endpoint-3", { currentCallId: "call-active" }),
            ],
          },
        ],
      }),
      now,
    );

    expect(result.eligible).toEqual([]);
    expect(result.exclusions).toMatchObject({
      CURRENT_CALL: 1,
      LEASE_EXPIRED: 1,
      LOCATION_MISMATCH: 1,
      OFFERED_CALL: 1,
    });
  });

  it("reports one categorical first failure for every rejected candidate", () => {
    const result = decideInboundRouting(
      queue({
        members: [
          { enabled: false, userId: "disabled", sessions: [] },
          { enabled: true, userId: "absent", sessions: [] },
          {
            enabled: true,
            userId: "not-ready",
            sessions: [
              session("endpoint-disabled", "endpoint-1", {
                endpoint: {
                  configured: true,
                  enabled: false,
                  id: "endpoint-1",
                  locationId: "location-1",
                },
              }),
              session("not-configured", "endpoint-2", {
                endpoint: {
                  configured: false,
                  enabled: true,
                  id: "endpoint-2",
                  locationId: "location-1",
                },
              }),
              session("connecting", "endpoint-3", { connectionState: "CONNECTING" }),
              session("paused", "endpoint-4", { presence: "PAUSED" }),
              session("no-mic", "endpoint-5", { microphoneReady: false }),
              session("no-audio", "endpoint-6", { audioReady: false }),
            ],
          },
        ],
      }),
      now,
    );

    expect(result.exclusions).toMatchObject({
      AUDIO_NOT_READY: 1,
      CONNECTION_NOT_READY: 1,
      ENDPOINT_DISABLED: 1,
      ENDPOINT_NOT_CONFIGURED: 1,
      MEMBERSHIP_DISABLED: 1,
      MICROPHONE_NOT_READY: 1,
      NO_SESSION: 1,
      PRESENCE_NOT_AVAILABLE: 1,
    });
    expect(Object.values(result.exclusions).reduce((sum, count) => sum + count, 0)).toBe(
      8,
    );
  });

  it("never evaluates members for a disabled queue", () => {
    const result = decideInboundRouting(
      queue({
        enabled: false,
        members: [
          {
            enabled: true,
            userId: "user-1",
            sessions: [session("session-1", "endpoint-1")],
          },
        ],
      }),
      now,
    );

    expect(result.eligible).toEqual([]);
    expect(result.exclusions.QUEUE_DISABLED).toBe(1);
  });
});
