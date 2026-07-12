export const CANONICAL_VOICEMAIL_RECORDING_MAX_SECONDS = 120;

const CALLBACK_GRACE_SECONDS = 30;
const MINIMUM_GREETING_WINDOW_SECONDS = 60;
const MAXIMUM_GREETING_WINDOW_SECONDS = 10 * 60;
const ESTIMATED_SPEECH_CHARACTERS_PER_SECOND = 5;

function addSeconds(now: Date, seconds: number) {
  return new Date(now.getTime() + seconds * 1_000);
}

export function canonicalVoicemailGreetingDeadline(now: Date, greeting: string) {
  const estimatedSpeechSeconds = Math.ceil(
    greeting.length / ESTIMATED_SPEECH_CHARACTERS_PER_SECOND,
  );
  const seconds = Math.min(
    MAXIMUM_GREETING_WINDOW_SECONDS,
    Math.max(
      MINIMUM_GREETING_WINDOW_SECONDS,
      estimatedSpeechSeconds + CALLBACK_GRACE_SECONDS,
    ),
  );
  return addSeconds(now, seconds);
}

export function canonicalVoicemailRecordingDeadline(now: Date) {
  return addSeconds(
    now,
    CANONICAL_VOICEMAIL_RECORDING_MAX_SECONDS + CALLBACK_GRACE_SECONDS,
  );
}
