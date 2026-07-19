import { describe, expect, it } from "bun:test";

import { callCenterRetryDelay } from "./call-center-retry";

describe("call center retry delay", () => {
  it("backs off with bounded jitter and caps the delay", () => {
    expect(callCenterRetryDelay(0, 1_000, () => 0)).toBe(750);
    expect(callCenterRetryDelay(2, 1_000, () => 1)).toBe(4_000);
    expect(callCenterRetryDelay(20, 1_000, () => 1)).toBe(30_000);
  });
});
