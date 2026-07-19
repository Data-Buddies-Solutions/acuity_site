import { describe, expect, it } from "bun:test";

import { holdMusicWavBase64 } from "@/lib/call-center/infrastructure/hold-music";

describe("hold music", () => {
  it("builds one deterministic telephony WAV loop", () => {
    const first = holdMusicWavBase64();
    const second = holdMusicWavBase64();
    const wav = Buffer.from(first, "base64");

    expect(second).toBe(first);
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(8_000);
    expect(wav.length).toBe(44 + 8_000 * 12 * 2);
  });
});
