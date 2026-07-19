const SAMPLE_RATE = 8_000;
const DURATION_SECONDS = 12;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

let cached: string | null = null;

function writeWavHeader(buffer: Buffer, sampleCount: number) {
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const dataSize = sampleCount * bytesPerSample;
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * bytesPerSample, 28);
  buffer.writeUInt16LE(CHANNELS * bytesPerSample, 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
}

function envelope(position: number) {
  const attack = Math.min(1, position / 0.08);
  const release = Math.min(1, (1 - position) / 0.16);
  return Math.max(0, Math.min(attack, release));
}

/**
 * Produces a small, deterministic, royalty-free hold loop without an external
 * media host. The gentle arpeggio is intentionally narrow-band for telephony.
 */
export function holdMusicWavBase64() {
  if (cached) return cached;

  const sampleCount = SAMPLE_RATE * DURATION_SECONDS;
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  writeWavHeader(buffer, sampleCount);

  const progression = [
    [261.63, 329.63, 392.0, 493.88],
    [220.0, 261.63, 329.63, 392.0],
    [174.61, 220.0, 261.63, 329.63],
    [196.0, 246.94, 293.66, 392.0],
  ];
  const beatSeconds = 0.75;

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / SAMPLE_RATE;
    const beat = Math.floor(time / beatSeconds);
    const chord = progression[Math.floor(time / 3) % progression.length]!;
    const note = chord[beat % chord.length]!;
    const beatPosition = (time % beatSeconds) / beatSeconds;
    const noteEnvelope = envelope(beatPosition);
    const pad = chord.reduce(
      (sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * time),
      0,
    );
    const melody = Math.sin(2 * Math.PI * note * 2 * time);
    const shimmer = Math.sin(2 * Math.PI * note * 3 * time);
    const fade = Math.min(1, time / 0.15, (DURATION_SECONDS - time) / 0.15);
    const sample =
      fade * (0.075 * pad + noteEnvelope * (0.11 * melody + 0.025 * shimmer));
    buffer.writeInt16LE(
      Math.max(-32_767, Math.min(32_767, Math.round(sample * 32_767))),
      44 + index * 2,
    );
  }

  cached = buffer.toString("base64");
  return cached;
}
