import { afterEach, describe, expect, it } from "bun:test";

import {
  normalizePhone,
  phoneLookupVariants,
  resolveTelnyxRuntimeSettings,
} from "@/lib/call-center";

const TELNYX_ENV_KEYS = [
  "TELNYX_CONNECTION_ID",
  "TELNYX_CREDENTIAL_ID",
  "TELNYX_INBOUND_NUMBER",
  "TELNYX_PHONE_NUMBER",
] as const;

const originalEnv = Object.fromEntries(
  TELNYX_ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of TELNYX_ENV_KEYS) {
    const originalValue = originalEnv[key];

    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
});

describe("call-center phone helpers", () => {
  it("normalizes US phone numbers for Telnyx lookups", () => {
    expect(normalizePhone("(727) 591-9997")).toBe("+17275919997");
    expect(normalizePhone("17275919997")).toBe("+17275919997");
    expect(normalizePhone("+1 727 591 9997")).toBe("+17275919997");
  });

  it("builds lookup variants for stored practice phone formats", () => {
    const variants = phoneLookupVariants("(727) 591-9997");

    expect(variants).toContain("(727) 591-9997");
    expect(variants).toContain("+17275919997");
    expect(variants).toContain("17275919997");
    expect(variants).toContain("7275919997");
  });

  it("prefers practice settings over Telnyx environment defaults", () => {
    process.env.TELNYX_CONNECTION_ID = "env-connection";
    process.env.TELNYX_CREDENTIAL_ID = "env-credential";
    process.env.TELNYX_INBOUND_NUMBER = "+15550000001";
    process.env.TELNYX_PHONE_NUMBER = "+15550000002";

    expect(
      resolveTelnyxRuntimeSettings({
        inboundPhoneNumber: "+17275919997",
        outboundCallerNumber: "+17275919997",
        telnyxConnectionId: "practice-connection",
        telnyxCredentialId: "practice-credential",
      }),
    ).toEqual({
      connectionId: "practice-connection",
      credentialId: "practice-credential",
      inboundPhoneNumber: "+17275919997",
      outboundCallerNumber: "+17275919997",
    });
  });

  it("falls back to Telnyx environment defaults while a practice is being configured", () => {
    process.env.TELNYX_CONNECTION_ID = "env-connection";
    process.env.TELNYX_CREDENTIAL_ID = "env-credential";
    process.env.TELNYX_INBOUND_NUMBER = "+15550000001";
    process.env.TELNYX_PHONE_NUMBER = "+15550000002";

    expect(
      resolveTelnyxRuntimeSettings({
        inboundPhoneNumber: null,
        outboundCallerNumber: null,
        telnyxConnectionId: null,
        telnyxCredentialId: null,
      }),
    ).toEqual({
      connectionId: "env-connection",
      credentialId: "env-credential",
      inboundPhoneNumber: "+15550000001",
      outboundCallerNumber: "+15550000002",
    });
  });
});
