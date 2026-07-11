import { describe, expect, it } from "bun:test";

import {
  isAgentSessionReady,
  readinessValidationError,
  resolveAgentSessionReadyAt,
} from "../agent-session-readiness";

const ready = {
  audioReady: true,
  connectionState: "READY" as const,
  currentCallId: null,
  microphoneReady: true,
  presence: "AVAILABLE" as const,
};

describe("canonical agent-session readiness", () => {
  it("requires every routing eligibility signal", () => {
    expect(isAgentSessionReady(ready)).toBe(true);
    expect(isAgentSessionReady({ ...ready, audioReady: false })).toBe(false);
    expect(isAgentSessionReady({ ...ready, microphoneReady: false })).toBe(false);
    expect(isAgentSessionReady({ ...ready, connectionState: "ERROR" })).toBe(false);
    expect(isAgentSessionReady({ ...ready, currentCallId: "call-1" })).toBe(false);
    expect(isAgentSessionReady({ ...ready, presence: "PAUSED" })).toBe(false);
  });

  it("returns an actionable validation error for an invalid available state", () => {
    expect(readinessValidationError({ ...ready, connectionState: "CONNECTING" })).toBe(
      "AVAILABLE requires a ready provider connection",
    );
    expect(readinessValidationError({ ...ready, microphoneReady: false })).toBe(
      "AVAILABLE requires microphone access",
    );
    expect(readinessValidationError({ ...ready, audioReady: false })).toBe(
      "AVAILABLE requires browser audio",
    );
    expect(readinessValidationError({ ...ready, presence: "PAUSED" })).toBeNull();
  });

  it("sets readyAt once while ready and clears it otherwise", () => {
    const now = new Date("2026-07-11T12:00:00.000Z");
    const existing = new Date("2026-07-11T11:59:00.000Z");

    expect(resolveAgentSessionReadyAt(ready, null, now)).toEqual(now);
    expect(resolveAgentSessionReadyAt(ready, existing, now)).toEqual(existing);
    expect(
      resolveAgentSessionReadyAt({ ...ready, presence: "PAUSED" }, existing, now),
    ).toBeNull();
  });
});
