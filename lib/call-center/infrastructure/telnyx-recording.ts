import { getTelnyxRecording, TelnyxError } from "@/lib/telnyx";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonBlankString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonNegativeNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = nonNegativeNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function recordingDuration(data: Record<string, unknown>) {
  const seconds = firstNumber(
    data.recording_duration_sec,
    data.recording_duration_secs,
    data.recording_duration_seconds,
    data.duration_sec,
    data.duration_secs,
    data.duration_seconds,
    data.RecordingDuration,
  );
  if (seconds !== null) return seconds;
  const millis = firstNumber(
    data.recording_duration_millis,
    data.recording_duration_ms,
    data.duration_millis,
    data.duration_ms,
  );
  return millis === null ? 0 : millis / 1_000;
}

function recordingUrl(data: Record<string, unknown>) {
  const groups = [
    asRecord(data.download_urls),
    asRecord(data.public_recording_urls),
    asRecord(data.recording_urls),
  ];
  for (const group of groups) {
    const url = nonBlankString(group?.mp3) ?? nonBlankString(group?.wav);
    if (url) return url;
  }
  return nonBlankString(data.recording_url);
}

export async function fetchTelnyxRecordingMetadata(recordingId: string) {
  const response = await getTelnyxRecording(recordingId);
  if (!response.ok) {
    throw new TelnyxError("Telnyx recording metadata is unavailable", response.status);
  }
  const body: unknown = await response.json();
  const data = asRecord(asRecord(body)?.data);
  if (!data) throw new TelnyxError("Telnyx recording metadata is invalid", 502);
  return {
    durationSec: Math.round(recordingDuration(data)),
    recordingUrl: recordingUrl(data),
  };
}
