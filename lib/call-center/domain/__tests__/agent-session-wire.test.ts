import { describe, expect, it } from "bun:test";

import {
  serializeAgentConnectionState,
  serializeAgentSessionView,
} from "../agent-session-wire";

describe("canonical agent-session wire serializer", () => {
  it.each([
    ["CONNECTING", "CONNECTING"],
    ["READY", "READY"],
    ["ERROR", "FAILED"],
    ["CLOSED", "DISCONNECTED"],
  ] as const)("maps Prisma %s to wire %s", (database, wire) => {
    expect(serializeAgentConnectionState(database)).toBe(wire);
  });

  it("exposes the canonical client identity and monotonic version", () => {
    expect(
      serializeAgentSessionView({
        audioReady: false,
        clientInstanceId: "client-1",
        connectionState: "ERROR",
        endpointId: "endpoint-1",
        id: "session-1",
        leaseExpiresAt: new Date("2026-07-11T12:01:00.000Z"),
        microphoneReady: false,
        presence: "PAUSED",
        stateVersion: 4,
      }),
    ).toEqual({
      audioReady: false,
      clientInstanceId: "client-1",
      connectionState: "FAILED",
      endpointId: "endpoint-1",
      id: "session-1",
      leaseExpiresAt: "2026-07-11T12:01:00.000Z",
      microphoneReady: false,
      presence: "PAUSED",
      stateVersion: 4,
    });
  });
});
