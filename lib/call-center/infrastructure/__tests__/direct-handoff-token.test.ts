import { describe, expect, it } from "bun:test";

import {
  directHandoffRequestFingerprint,
  directHandoffToken,
  directHandoffTokenHash,
  matchesDirectHandoffToken,
} from "@/lib/call-center/infrastructure/direct-handoff-token";

describe("direct handoff token", () => {
  it("replays deterministically while persisting only a hash", () => {
    const token = directHandoffToken("handoff-1", "secret-1");
    expect(token).toBe(directHandoffToken("handoff-1", "secret-1"));
    expect(matchesDirectHandoffToken(token, directHandoffTokenHash(token))).toBe(true);
    expect(matchesDirectHandoffToken("other", directHandoffTokenHash(token))).toBe(false);
  });

  it("fingerprints the complete normalized request", () => {
    const input = {
      callerPhone: "+17865550100",
      routePhoneNumber: "+19542872010",
      sourceCallId: "source-1",
    };
    expect(directHandoffRequestFingerprint(input)).toBe(
      directHandoffRequestFingerprint(input),
    );
    expect(
      directHandoffRequestFingerprint({ ...input, sourceCallId: "source-2" }),
    ).not.toBe(directHandoffRequestFingerprint(input));
  });
});
