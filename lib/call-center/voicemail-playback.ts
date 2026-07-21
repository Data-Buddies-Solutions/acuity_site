import { canonicalCallAccessWhere } from "@/lib/call-center/application/portal-canonical-history";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { fetchTelnyxRecordingMetadata } from "@/lib/call-center/infrastructure/telnyx-recording";
import { prisma } from "@/lib/prisma";

type Voicemail = {
  durationSec: number;
  id: string;
  recordingUrl: string;
};

type VoicemailUpdate = {
  durationSec?: number;
  listenedAt?: Date;
  recordingUrl?: string;
};

type Dependencies = {
  fetchAudio(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  fetchRecordingMetadata: typeof fetchTelnyxRecordingMetadata;
  findVoicemail(actor: QueueAccessActor, recordingId: string): Promise<Voicemail | null>;
  updateVoicemail(id: string, update: VoicemailUpdate): Promise<void>;
};

export class VoicemailPlaybackError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VoicemailPlaybackError";
  }
}

export function createVoicemailPlayback(dependencies: Dependencies) {
  return {
    async play(
      actor: QueueAccessActor,
      input: { range: string | null; recordingId: string },
      now = new Date(),
    ) {
      const recordingId = input.recordingId.trim();
      if (!recordingId) {
        throw new VoicemailPlaybackError("Voicemail is unavailable", 404);
      }
      const voicemail = await dependencies.findVoicemail(actor, recordingId);
      if (!voicemail) {
        throw new VoicemailPlaybackError("Voicemail is unavailable", 404);
      }
      const metadata = await dependencies.fetchRecordingMetadata(recordingId);
      const urls = [metadata.recordingUrl, voicemail.recordingUrl].filter(
        (url, index, values): url is string =>
          Boolean(url && values.indexOf(url) === index),
      );
      if (!urls.length) {
        throw new VoicemailPlaybackError("Voicemail is unavailable", 404);
      }
      const upstreamHeaders: Record<string, string> = {};
      if (input.range) upstreamHeaders.Range = input.range;
      let audioResponse: Response | null = null;
      for (const url of urls) {
        try {
          const response = await dependencies.fetchAudio(url, {
            headers: upstreamHeaders,
          });
          if (response.ok && response.body) {
            audioResponse = response;
            break;
          }
        } catch {
          // A provider URL may expire while the durable fallback is still usable.
        }
      }
      if (!audioResponse?.body) {
        throw new VoicemailPlaybackError("Voicemail is unavailable", 502);
      }
      const update: VoicemailUpdate = {};
      if (!input.range) update.listenedAt = now;
      if (metadata.durationSec > voicemail.durationSec) {
        update.durationSec = metadata.durationSec;
      }
      if (metadata.recordingUrl && metadata.recordingUrl !== voicemail.recordingUrl) {
        update.recordingUrl = metadata.recordingUrl;
      }
      if (Object.keys(update).length) {
        await dependencies.updateVoicemail(voicemail.id, update);
      }
      const headers = new Headers({
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": "inline",
        "Content-Type": audioResponse.headers.get("content-type") || "audio/mpeg",
      });
      const contentLength = audioResponse.headers.get("content-length");
      if (contentLength) headers.set("Content-Length", contentLength);
      const contentRange = audioResponse.headers.get("content-range");
      if (contentRange) headers.set("Content-Range", contentRange);
      return { body: audioResponse.body, headers, status: audioResponse.status };
    },
  };
}

export const voicemailPlayback = createVoicemailPlayback({
  fetchAudio: (input, init) => fetch(input, init),
  fetchRecordingMetadata: fetchTelnyxRecordingMetadata,
  findVoicemail: (actor, recordingId) =>
    prisma.callCenterVoicemail.findFirst({
      select: {
        durationSec: true,
        id: true,
        recordingUrl: true,
      },
      where: {
        callCenterCall: canonicalCallAccessWhere({
          allowedLocationIds: actor.allowedLocationIds,
          hasAllLocationAccess: actor.hasAllLocationAccess,
          practice: { id: actor.practiceId },
        }),
        recordingId,
      },
    }),
  updateVoicemail: async (id, update) => {
    await prisma.callCenterVoicemail.update({ data: update, where: { id } });
  },
});
