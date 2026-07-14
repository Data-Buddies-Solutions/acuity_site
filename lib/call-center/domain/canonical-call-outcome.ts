export type CanonicalVoicemailMedia = {
  durationSec: number;
  recordingId?: string | null;
  recordingUrl?: string | null;
};

export function hasUsableCanonicalVoicemail(voicemail: CanonicalVoicemailMedia | null) {
  return Boolean(
    voicemail &&
    voicemail.durationSec > 0 &&
    voicemail.recordingId?.trim() &&
    voicemail.recordingUrl?.trim(),
  );
}

export function canonicalCallOutcome(call: {
  answeredAt: Date | null;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  voicemail: CanonicalVoicemailMedia | null;
}): "CALL" | "MISSED_CALL" | "VOICEMAIL" {
  if (call.answeredAt || call.direction === "OUTBOUND") return "CALL";
  if (hasUsableCanonicalVoicemail(call.voicemail)) return "VOICEMAIL";
  return ["ABANDONED", "FAILED", "VOICEMAIL"].includes(call.status)
    ? "MISSED_CALL"
    : "CALL";
}
