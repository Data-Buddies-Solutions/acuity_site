import { describe, expect, it } from "bun:test";

import { createVoicemailPlayback } from "@/lib/call-center/voicemail-playback";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};

describe("voicemail playback module", () => {
  it("authorizes playback and commits provider metadata after audio opens", async () => {
    let update: unknown;
    const now = new Date("2026-07-20T12:00:00.000Z");
    const playback = createVoicemailPlayback({
      fetchAudio: async () =>
        new Response("audio", {
          headers: { "content-type": "audio/mpeg" },
        }),
      fetchRecordingMetadata: async () => ({
        durationSec: 12,
        recordingUrl: "https://provider.test/recording.mp3",
      }),
      findVoicemail: async () => ({
        durationSec: 10,
        id: "voicemail-1",
        recordingUrl: "https://stored.test/recording.mp3",
      }),
      updateVoicemail: async (id, data) => {
        update = { data, id };
      },
    });

    const result = await playback.play(
      actor,
      { range: null, recordingId: "recording-1" },
      now,
    );

    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("audio/mpeg");
    expect(update).toEqual({
      data: {
        durationSec: 12,
        listenedAt: now,
        recordingUrl: "https://provider.test/recording.mp3",
      },
      id: "voicemail-1",
    });
  });
});
