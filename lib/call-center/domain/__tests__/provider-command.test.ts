import { describe, expect, it } from "bun:test";

import { decideProviderCommandMarkSent } from "../provider-command";

describe("provider command state", () => {
  it("never regresses a provider-confirmed callback", () => {
    expect(decideProviderCommandMarkSent("CONFIRMED", 2, 1)).toBe("ALREADY_CONFIRMED");
    expect(decideProviderCommandMarkSent("SENDING", 1, 1)).toBe("MARKED");
    expect(decideProviderCommandMarkSent("SENT", 1, 1)).toBe("ALREADY_SENT");
    expect(decideProviderCommandMarkSent("FAILED", 1, 1)).toBe("STALE");
    expect(decideProviderCommandMarkSent("SENDING", 2, 1)).toBe("STALE");
  });
});
