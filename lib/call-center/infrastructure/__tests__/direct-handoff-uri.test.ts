import { describe, expect, it } from "bun:test";

import { directHandoffTokenHash } from "@/lib/call-center/infrastructure/direct-handoff-token";
import {
  directHandoffSipUri,
  hasDirectHandoffIdentity,
  redactDirectHandoffToken,
} from "@/lib/call-center/infrastructure/direct-handoff-uri";

const token = "a".repeat(43);

describe("direct handoff SIP URI", () => {
  it("embeds one opaque token in the configured SIP user", () => {
    expect(
      directHandoffSipUri("sip:acuity-handoff@abitacallcenter.sip.telnyx.com", token),
    ).toBe(`sip:acuity-handoff~ah1~${token}@abitacallcenter.sip.telnyx.com`);
  });

  it("rejects credentials, reused markers, and malformed tokens", () => {
    expect(() => directHandoffSipUri("sip:user:password@example.com", token)).toThrow(
      "DIRECT_HANDOFF_SIP_URI_INVALID",
    );
    expect(() => directHandoffSipUri("sip:user~ah1~old@example.com", token)).toThrow(
      "DIRECT_HANDOFF_SIP_URI_INVALID",
    );
    expect(() => directHandoffSipUri("sip:user@example.com", "short")).toThrow(
      "DIRECT_HANDOFF_SIP_URI_INVALID",
    );
  });

  it("hashes and redacts the token before durable persistence", () => {
    const original = `sip:acuity-handoff~ah1~${token}@abitacallcenter.sip.telnyx.com`;
    const redacted = redactDirectHandoffToken({ to: original });

    expect(redacted.tokenHash).toBe(directHandoffTokenHash(token));
    expect(JSON.stringify(redacted.payload)).not.toContain(token);
    expect(redacted.payload).toEqual({
      to: "sip:acuity-handoff~ah1~[REDACTED]@abitacallcenter.sip.telnyx.com",
    });
    expect(hasDirectHandoffIdentity(redacted.payload)).toBe(true);

    const schemeless = redactDirectHandoffToken({
      to: `acuity-handoff~ah1~${token}@abitacallcenter.sip.telnyx.com`,
    });
    expect(schemeless.tokenHash).toBe(directHandoffTokenHash(token));
  });

  it("ignores arbitrary headers and ordinary SIP destinations", () => {
    const payload = {
      custom_headers: {
        "X-Acuity-Handoff-Id": "handoff-1",
        "X-Acuity-Handoff-Token": token,
      },
      to: "sip:acuity-handoff@abitacallcenter.sip.telnyx.com",
    };
    expect(redactDirectHandoffToken(payload)).toEqual({ payload, tokenHash: null });
    expect(hasDirectHandoffIdentity(payload)).toBe(false);
  });
});
