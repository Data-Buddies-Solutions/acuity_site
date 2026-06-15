import { describe, expect, it } from "bun:test";

import {
  normalizePhone,
  phoneDigits,
  phoneLookupVariants,
  phoneNationalDigits,
} from "@/lib/phone";

describe("phone helpers", () => {
  it("extracts raw and national digits", () => {
    expect(phoneDigits("+1 (727) 591-9997")).toBe("17275919997");
    expect(phoneNationalDigits("+1 (727) 591-9997")).toBe("7275919997");
    expect(phoneNationalDigits("+44 20 7946 0958")).toBe("442079460958");
  });

  it("normalizes US numbers to E.164 for telephony calls", () => {
    expect(normalizePhone("(727) 591-9997")).toBe("+17275919997");
    expect(normalizePhone("7275919997")).toBe("+17275919997");
    expect(normalizePhone("17275919997")).toBe("+17275919997");
    expect(normalizePhone("+1 727 591 9997")).toBe("+17275919997");
  });

  it("preserves blank input and normalizes non-US digit strings conservatively", () => {
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(normalizePhone("442079460958")).toBe("+442079460958");
  });

  it("builds lookup variants for stored practice phone formats", () => {
    const variants = phoneLookupVariants("(727) 591-9997");

    expect(variants).toContain("(727) 591-9997");
    expect(variants).toContain("+17275919997");
    expect(variants).toContain("17275919997");
    expect(variants).toContain("7275919997");
  });
});
