import { describe, expect, it } from "bun:test";

import {
  directHandoffIdentity,
  redactDirectHandoffToken,
} from "@/lib/call-center/infrastructure/direct-handoff-headers";
import { directHandoffTokenHash } from "@/lib/call-center/infrastructure/direct-handoff-token";

describe("direct handoff headers", () => {
  it("reads array and object Telnyx header shapes case-insensitively", () => {
    expect(
      directHandoffIdentity({
        custom_headers: { "x-acuity-handoff-token": "token-1" },
        sip_headers: [{ name: "X-Acuity-Handoff-Id", value: "handoff-1" }],
      }),
    ).toEqual({ handoffId: "handoff-1", token: "token-1" });
  });

  it("ignores unrelated headers and fails closed on partial identity", () => {
    expect(directHandoffIdentity({ sip_headers: { "X-Other": "value" } })).toBeNull();
    expect(() =>
      directHandoffIdentity({ sip_headers: ["X-Acuity-Handoff-Id: handoff-1"] }),
    ).toThrow("DIRECT_HANDOFF_IDENTITY_INVALID");
    expect(() =>
      directHandoffIdentity({
        sip_headers: {
          "X-Acuity-Handoff": "call-center",
          "X-Acuity-Handoff-Target": "sip:acuity-ingress@sip.telnyx.com",
        },
      }),
    ).toThrow("DIRECT_HANDOFF_IDENTITY_INVALID");
  });

  it("hashes the token and removes it from the durable payload", () => {
    const token = "one-time-token";
    const redacted = redactDirectHandoffToken({
      custom_headers: {
        "X-Acuity-Handoff-Id": "handoff-1",
        "X-Acuity-Handoff-Token": token,
      },
    });

    expect(redacted.tokenHash).toBe(directHandoffTokenHash(token));
    expect(JSON.stringify(redacted.payload)).not.toContain(token);
    expect(directHandoffIdentity(redacted.payload)).toEqual({
      handoffId: "handoff-1",
      token: "[REDACTED]",
    });
  });
});
