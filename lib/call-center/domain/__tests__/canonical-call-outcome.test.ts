import { describe, expect, it } from "bun:test";

import {
  canonicalCallOutcome,
  hasUsableCanonicalVoicemail,
} from "../canonical-call-outcome";

const unanswered = {
  answeredAt: null,
  direction: "INBOUND" as const,
  status: "VOICEMAIL",
};

describe("canonical call outcome", () => {
  it("classifies unanswered calls without usable media as missed", () => {
    expect(canonicalCallOutcome({ ...unanswered, voicemail: null })).toBe("MISSED_CALL");
    expect(
      canonicalCallOutcome({
        ...unanswered,
        voicemail: { durationSec: 0, recordingId: "recording-1", recordingUrl: "url" },
      }),
    ).toBe("MISSED_CALL");
    expect(
      canonicalCallOutcome({
        ...unanswered,
        voicemail: { durationSec: 12, recordingId: "", recordingUrl: "" },
      }),
    ).toBe("MISSED_CALL");
  });

  it("classifies a retained positive-duration recording as voicemail", () => {
    const voicemail = {
      durationSec: 12,
      recordingId: "recording-1",
      recordingUrl: "https://example.test/recording",
    };
    expect(hasUsableCanonicalVoicemail(voicemail)).toBe(true);
    expect(canonicalCallOutcome({ ...unanswered, voicemail })).toBe("VOICEMAIL");
  });

  it("does not classify a staff-answered call as missed", () => {
    expect(
      canonicalCallOutcome({
        ...unanswered,
        answeredAt: new Date("2026-07-14T10:00:00.000Z"),
        status: "COMPLETED",
        voicemail: null,
      }),
    ).toBe("CALL");
  });
});
