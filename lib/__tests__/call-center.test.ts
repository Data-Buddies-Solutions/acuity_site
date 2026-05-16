import { afterEach, describe, expect, it } from "bun:test";

import { CallCenterSessionDirection } from "@/generated/prisma/client";
import {
  extractAcuityLiveKitHandoff,
  extractTelnyxRecordingDurationSec,
  extractTelnyxRecordingUrl,
  isRingbackToneActiveAtSecond,
  normalizePhone,
  phoneLookupVariants,
  resolveTelnyxRuntimeSettings,
  telnyxSessionDirectionFromPayload,
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

describe("Telnyx caller ringback cadence", () => {
  it("uses repeated ringback tone windows instead of one tone followed by silence", () => {
    expect(isRingbackToneActiveAtSecond(0)).toBe(true);
    expect(isRingbackToneActiveAtSecond(1.99)).toBe(true);
    expect(isRingbackToneActiveAtSecond(2)).toBe(false);
    expect(isRingbackToneActiveAtSecond(5.99)).toBe(false);
    expect(isRingbackToneActiveAtSecond(6)).toBe(true);
    expect(isRingbackToneActiveAtSecond(7.5)).toBe(true);
    expect(isRingbackToneActiveAtSecond(-1)).toBe(false);
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

describe("LiveKit SIP handoff parsing", () => {
  it("reads Acuity handoff headers from Telnyx sip_headers arrays", () => {
    expect(
      extractAcuityLiveKitHandoff({
        sip_headers: [
          { name: "X-Acuity-Handoff", value: "call-center" },
          { name: "X-Acuity-Trunk-Phone", value: "+17275919997" },
          { name: "X-Acuity-Caller-Phone", value: "(813) 555-0100" },
          { name: "X-Acuity-LiveKit-Call-Id", value: "lk-call-123" },
        ],
      }),
    ).toEqual({
      callerPhone: "(813) 555-0100",
      handoff: "call-center",
      isCallCenterHandoff: true,
      liveKitCallId: "lk-call-123",
      trunkPhone: "+17275919997",
    });
  });

  it("reads Acuity handoff headers from Telnyx custom_headers maps", () => {
    expect(
      extractAcuityLiveKitHandoff({
        custom_headers: {
          "x-acuity-caller-phone": "+18135550100",
          "x-acuity-handoff": "call-center",
          "x-acuity-livekit-call-id": "lk-call-456",
          "x-acuity-trunk-phone": "7275919997",
        },
      }),
    ).toMatchObject({
      callerPhone: "+18135550100",
      isCallCenterHandoff: true,
      liveKitCallId: "lk-call-456",
      trunkPhone: "7275919997",
    });
  });

  it("treats call-center handoff webhooks as inbound sessions", () => {
    expect(
      telnyxSessionDirectionFromPayload({
        direction: "outgoing",
        sip_headers: [
          { name: "X-Acuity-Handoff", value: "call-center" },
          { name: "X-Acuity-Trunk-Phone", value: "+17275919997" },
        ],
      }),
    ).toBe(CallCenterSessionDirection.INBOUND);
  });
});
