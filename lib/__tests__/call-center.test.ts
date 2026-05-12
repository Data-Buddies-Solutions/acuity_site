import { afterEach, describe, expect, it } from "bun:test";

import {
  extractCallCenterHandoffMetadata,
  extractTelnyxRecordingDurationSec,
  extractTelnyxRecordingUrl,
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

  it("extracts LiveKit AI handoff metadata from Telnyx SIP headers", () => {
    expect(
      extractCallCenterHandoffMetadata({
        direction: "outgoing",
        sip_headers: [
          { name: "X-Acuity-Handoff", value: "call-center" },
          { name: "X-Acuity-Caller-Phone", value: "+17275551212" },
          { name: "X-Acuity-Trunk-Phone", value: "+17275919997" },
          { name: "X-Acuity-Transfer-Number", value: "+16182265883" },
          { name: "X-Acuity-LiveKit-Call-Id", value: "call-123" },
          { name: "X-Acuity-Office-Key", value: "spring-hill" },
        ],
      }),
    ).toEqual({
      callerPhone: "+17275551212",
      liveKitCallId: "call-123",
      officeKey: "spring-hill",
      transferNumber: "+16182265883",
      trunkPhone: "+17275919997",
    });
  });

  it("ignores non-call-center SIP headers", () => {
    expect(
      extractCallCenterHandoffMetadata({
        sip_headers: [{ name: "X-Acuity-Handoff", value: "other" }],
      }),
    ).toBeNull();
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

describe("Telnyx voicemail duration parsing", () => {
  it("reads direct numeric and string second values", () => {
    expect(
      extractTelnyxRecordingDurationSec({
        recording_duration_sec: 12,
      }),
    ).toBe(12);
    expect(
      extractTelnyxRecordingDurationSec({
        RecordingDuration: "17",
      }),
    ).toBe(17);
  });

  it("converts millisecond values to seconds", () => {
    expect(
      extractTelnyxRecordingDurationSec({
        duration_millis: "12345",
      }),
    ).toBe(12.345);
  });

  it("reads nested duration objects", () => {
    expect(
      extractTelnyxRecordingDurationSec({
        duration: {
          seconds: "9",
        },
      }),
    ).toBe(9);
  });

  it("derives duration from Telnyx recording timestamps", () => {
    expect(
      extractTelnyxRecordingDurationSec({
        recording_ended_at: "2026-05-01T13:00:14.500Z",
        recording_started_at: "2026-05-01T13:00:08.000Z",
      }),
    ).toBe(6.5);
  });

  it("returns zero when the payload has no duration signal", () => {
    expect(extractTelnyxRecordingDurationSec({})).toBe(0);
  });
});

describe("Telnyx voicemail recording URL parsing", () => {
  it("prefers fresh download URLs over webhook recording URLs", () => {
    expect(
      extractTelnyxRecordingUrl({
        download_urls: {
          mp3: "https://recordings.example/download.mp3",
        },
        public_recording_urls: {
          mp3: "https://recordings.example/public.mp3",
        },
        recording_urls: {
          mp3: "https://recordings.example/webhook.mp3",
        },
      }),
    ).toBe("https://recordings.example/download.mp3");
  });

  it("falls back through public and webhook recording URLs", () => {
    expect(
      extractTelnyxRecordingUrl({
        public_recording_urls: {
          wav: "https://recordings.example/public.wav",
        },
        recording_urls: {
          mp3: "https://recordings.example/webhook.mp3",
        },
      }),
    ).toBe("https://recordings.example/public.wav");
  });
});
