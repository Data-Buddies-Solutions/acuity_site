import { describe, expect, it } from "bun:test";

import {
  canonicalVoicemailGreetingDeadline,
  canonicalVoicemailRecordingDeadline,
} from "../canonical-voicemail-lifecycle";

const now = new Date("2026-07-12T12:00:00.000Z");

describe("canonical voicemail deadlines", () => {
  it("allows a bounded greeting window based on message length", () => {
    expect(canonicalVoicemailGreetingDeadline(now, "Short greeting")).toEqual(
      new Date("2026-07-12T12:01:00.000Z"),
    );
    expect(canonicalVoicemailGreetingDeadline(now, "x".repeat(2_000))).toEqual(
      new Date("2026-07-12T12:07:10.000Z"),
    );
  });

  it("allows recording max length plus callback grace", () => {
    expect(canonicalVoicemailRecordingDeadline(now)).toEqual(
      new Date("2026-07-12T12:02:30.000Z"),
    );
  });
});
