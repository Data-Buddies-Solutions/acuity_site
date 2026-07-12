const DEFAULT_DURATION_SEC = 30;
const MAX_DURATION_SEC = 120;
const TONE_DURATION_SEC = 2;
const CYCLE_DURATION_SEC = 6;

const cache = new Map<number, string>();

export function normalizeCallWaitSeconds(timeoutSeconds: number | null | undefined) {
  if (!Number.isFinite(timeoutSeconds)) return DEFAULT_DURATION_SEC;
  return Math.min(
    MAX_DURATION_SEC,
    Math.max(1, Math.round(timeoutSeconds || DEFAULT_DURATION_SEC)),
  );
}

export function isRingbackToneActiveAtSecond(elapsedSeconds: number) {
  return (
    Number.isFinite(elapsedSeconds) &&
    elapsedSeconds >= 0 &&
    elapsedSeconds % CYCLE_DURATION_SEC < TONE_DURATION_SEC
  );
}

function createRingbackWavBase64(durationSeconds: number) {
  const sampleRate = 8_000;
  const bytesPerSample = 2;
  const sampleCount = sampleRate * durationSeconds;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const elapsedSeconds = index / sampleRate;
    const sample = isRingbackToneActiveAtSecond(elapsedSeconds)
      ? Math.round(
          (9_000 *
            (Math.sin(2 * Math.PI * 440 * elapsedSeconds) +
              Math.sin(2 * Math.PI * 480 * elapsedSeconds))) /
            2,
        )
      : 0;
    buffer.writeInt16LE(sample, 44 + index * bytesPerSample);
  }

  return buffer.toString("base64");
}

export function ringbackWavBase64For(timeoutSeconds: number | null | undefined) {
  const durationSeconds = normalizeCallWaitSeconds(timeoutSeconds);
  const cached = cache.get(durationSeconds);
  if (cached) return cached;

  const wav = createRingbackWavBase64(durationSeconds);
  cache.set(durationSeconds, wav);
  return wav;
}
