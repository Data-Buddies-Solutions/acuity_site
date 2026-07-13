import { describe, expect, it } from "bun:test";

import {
  InvalidDirectHandoffConfigError,
  resolveDirectHandoffConfig,
} from "@/lib/call-center/infrastructure/direct-handoff-config";

const canonicalEnvironment = {
  CALL_CENTER_CANONICAL_ACTIVATION_ENABLED: "true",
  CALL_CENTER_CANONICAL_PROJECTION_ENABLED: "true",
  CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED: "true",
  CALL_CENTER_WEBHOOK_PAYLOAD_RETENTION_APPROVED: "true",
  CALL_CENTER_WEBHOOK_RETENTION_DAYS: "7",
};

describe("direct handoff configuration", () => {
  it("is default-off without requiring secrets", () => {
    expect(resolveDirectHandoffConfig({})).toEqual({ enabled: false });
  });

  it("requires canonical admission and a complete SIP configuration", () => {
    expect(() =>
      resolveDirectHandoffConfig({
        ...canonicalEnvironment,
        CALL_CENTER_DIRECT_HANDOFF_ENABLED: "true",
      }),
    ).toThrow(InvalidDirectHandoffConfigError);
  });

  it("rejects a SIP URI containing credentials", () => {
    expect(() =>
      resolveDirectHandoffConfig({
        ...canonicalEnvironment,
        CALL_CENTER_DIRECT_HANDOFF_ENABLED: "true",
        CALL_CENTER_DIRECT_HANDOFF_SIP_URI: "sip:acuity-ingress:password@sip.telnyx.com",
        CALL_CENTER_HANDOFF_ABITA_PRACTICE_ID: "practice-1",
        CALL_CENTER_HANDOFF_ABITA_SECRET: "test-secret",
      }),
    ).toThrow(InvalidDirectHandoffConfigError);
  });

  it("enables every configured route through one global switch", () => {
    expect(
      resolveDirectHandoffConfig({
        ...canonicalEnvironment,
        CALL_CENTER_DIRECT_HANDOFF_ENABLED: "true",
        CALL_CENTER_DIRECT_HANDOFF_SIP_URI: "sip:acuity-ingress@sip.telnyx.com",
        CALL_CENTER_HANDOFF_ABITA_PRACTICE_ID: "practice-1",
        CALL_CENTER_HANDOFF_ABITA_SECRET: "test-secret",
      }),
    ).toEqual({
      enabled: true,
      practiceId: "practice-1",
      secret: "test-secret",
      sipUri: "sip:acuity-ingress@sip.telnyx.com",
    });
  });
});
