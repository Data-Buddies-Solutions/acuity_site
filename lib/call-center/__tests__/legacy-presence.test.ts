import { describe, expect, it } from "bun:test";

import {
  canWriteLegacyPresence,
  isLegacyPresenceReadyForCalls,
} from "@/lib/call-center/legacy-presence";

describe("legacy call-center presence readiness", () => {
  it("fails closed unless AVAILABLE is explicitly ready", () => {
    expect(canWriteLegacyPresence({ readyForCalls: false, status: "AVAILABLE" })).toBe(
      false,
    );
    expect(canWriteLegacyPresence({ readyForCalls: true, status: "AVAILABLE" })).toBe(
      true,
    );
  });

  it("keeps non-available presence valid but ineligible for calls", () => {
    expect(canWriteLegacyPresence({ readyForCalls: false, status: "OFFLINE" })).toBe(
      true,
    );
    expect(isLegacyPresenceReadyForCalls({ readyForCalls: true, status: "BUSY" })).toBe(
      false,
    );
  });
});
