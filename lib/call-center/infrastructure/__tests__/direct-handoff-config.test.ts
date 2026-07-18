import { describe, expect, it } from "bun:test";

import {
  InvalidDirectHandoffConfigError,
  resolveDirectHandoffConfig,
} from "@/lib/call-center/infrastructure/direct-handoff-config";

describe("direct handoff configuration", () => {
  it("requires a complete configuration", () => {
    expect(() => resolveDirectHandoffConfig({})).toThrow(InvalidDirectHandoffConfigError);
  });

  it("rejects a SIP URI containing credentials", () => {
    expect(() =>
      resolveDirectHandoffConfig({
        CALL_CENTER_DIRECT_HANDOFF_SIP_URI: "sip:acuity-ingress:password@sip.telnyx.com",
        CALL_CENTER_HANDOFF_ABITA_PRACTICE_ID: "practice-1",
        CALL_CENTER_HANDOFF_ABITA_SECRET: "test-secret",
      }),
    ).toThrow(InvalidDirectHandoffConfigError);
  });

  it("returns the configured route", () => {
    expect(
      resolveDirectHandoffConfig({
        CALL_CENTER_DIRECT_HANDOFF_SIP_URI: "sip:acuity-ingress@sip.telnyx.com",
        CALL_CENTER_HANDOFF_ABITA_PRACTICE_ID: "practice-1",
        CALL_CENTER_HANDOFF_ABITA_SECRET: "test-secret",
      }),
    ).toEqual({
      practiceId: "practice-1",
      secret: "test-secret",
      sipUri: "sip:acuity-ingress@sip.telnyx.com",
    });
  });
});
