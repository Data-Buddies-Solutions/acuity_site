import { Prisma } from "@/generated/prisma/client";

type Transaction = Prisma.TransactionClient;

export class CanonicalVoicemailPersistenceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CanonicalVoicemailPersistenceError";
  }
}

export type CanonicalVoicemailRecording = {
  durationSec: number;
  id: string;
  url: string;
};

export function persistCanonicalVoicemailTask(
  transaction: Transaction,
  input: {
    callId: string;
    practiceId: string;
    sourceEventRevision: bigint;
  },
) {
  return transaction.callCenterTask.upsert({
    create: {
      callId: input.callId,
      dedupeKey: `voicemail:${input.callId}`,
      kind: "VOICEMAIL",
      practiceId: input.practiceId,
      sourceEventRevision: input.sourceEventRevision,
    },
    update: {},
    where: {
      practiceId_dedupeKey: {
        dedupeKey: `voicemail:${input.callId}`,
        practiceId: input.practiceId,
      },
    },
  });
}

export async function persistCanonicalVoicemail(
  transaction: Transaction,
  input: {
    call: {
      callerName: string | null;
      fromPhone: string;
      id: string;
      practiceId: string;
    };
    occurredAt: Date;
    recording: CanonicalVoicemailRecording;
    sourceEventRevision: bigint;
  },
) {
  const [byCall, byRecording, source] = await Promise.all([
    transaction.callCenterVoicemail.findUnique({
      select: { callCenterCallId: true, id: true, recordingId: true },
      where: { callCenterCallId: input.call.id },
    }),
    transaction.callCenterVoicemail.findUnique({
      select: { callCenterCallId: true, id: true, recordingId: true },
      where: { recordingId: input.recording.id },
    }),
    transaction.callCenterCall.findUnique({
      select: {
        number: { select: { practicePhoneNumber: { select: { locationId: true } } } },
      },
      where: { id: input.call.id },
    }),
  ]);
  if (!source) throw new CanonicalVoicemailPersistenceError("CANONICAL_CALL_NOT_FOUND");
  if (
    (byCall && byCall.recordingId !== input.recording.id) ||
    (byRecording && byRecording.callCenterCallId !== input.call.id)
  ) {
    throw new CanonicalVoicemailPersistenceError("CANONICAL_VOICEMAIL_IDENTITY_MISMATCH");
  }

  const existing = byCall ?? byRecording;
  const data = {
    callerName: input.call.callerName,
    durationSec: input.recording.durationSec,
    fromPhone: input.call.fromPhone,
    locationId: source.number.practicePhoneNumber.locationId,
    recordingUrl: input.recording.url,
  };
  const voicemail = existing
    ? await transaction.callCenterVoicemail.update({
        data,
        select: { id: true },
        where: { id: existing.id },
      })
    : await transaction.callCenterVoicemail.create({
        data: {
          ...data,
          callCenterCallId: input.call.id,
          createdAt: input.occurredAt,
          practiceId: input.call.practiceId,
          recordingId: input.recording.id,
        },
        select: { id: true },
      });

  await persistCanonicalVoicemailTask(transaction, {
    callId: input.call.id,
    practiceId: input.call.practiceId,
    sourceEventRevision: input.sourceEventRevision,
  });
  return voicemail;
}
