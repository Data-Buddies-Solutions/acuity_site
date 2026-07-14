import { Prisma } from "@/generated/prisma/client";
import { hasUsableCanonicalVoicemail } from "@/lib/call-center/domain/canonical-call-outcome";

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

export async function persistCanonicalUnansweredTask(
  transaction: Transaction,
  input: {
    callId: string;
    dedupeKey?: string;
    kind: "MISSED_CALL" | "VOICEMAIL";
    practiceId: string;
    sourceEventRevision: bigint;
  },
) {
  const dedupeKey = input.dedupeKey ?? `voicemail:${input.callId}`;
  const task = await transaction.callCenterTask.upsert({
    create: {
      callId: input.callId,
      dedupeKey,
      kind: input.kind,
      practiceId: input.practiceId,
      sourceEventRevision: input.sourceEventRevision,
    },
    select: { id: true },
    update: { kind: input.kind, sourceEventRevision: input.sourceEventRevision },
    where: {
      practiceId_dedupeKey: {
        dedupeKey,
        practiceId: input.practiceId,
      },
    },
  });
  await transaction.callCenterEvent.upsert({
    create: {
      aggregateId: task.id,
      aggregateType: "TASK",
      data: { callId: input.callId, kind: input.kind },
      idempotencyKey: `task:${task.id}:source:${input.sourceEventRevision}`,
      practiceId: input.practiceId,
      type: "TASK_UPSERTED",
    },
    update: {},
    where: {
      practiceId_type_idempotencyKey: {
        idempotencyKey: `task:${task.id}:source:${input.sourceEventRevision}`,
        practiceId: input.practiceId,
        type: "TASK_UPSERTED",
      },
    },
  });
  return task;
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
  const existingSelect = {
    callCenterCallId: true,
    durationSec: true,
    id: true,
    recordingId: true,
    recordingUrl: true,
  } as const;
  const [byCall, byRecording, source] = await Promise.all([
    transaction.callCenterVoicemail.findUnique({
      select: existingSelect,
      where: { callCenterCallId: input.call.id },
    }),
    transaction.callCenterVoicemail.findUnique({
      select: existingSelect,
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
  const recordingIsUsable = hasUsableCanonicalVoicemail({
    durationSec: input.recording.durationSec,
    recordingId: input.recording.id,
    recordingUrl: input.recording.url,
  });
  const existingIsUsable = hasUsableCanonicalVoicemail(
    existing
      ? {
          durationSec: existing.durationSec,
          recordingId: existing.recordingId,
          recordingUrl: existing.recordingUrl,
        }
      : null,
  );
  if (!recordingIsUsable) {
    await persistCanonicalUnansweredTask(transaction, {
      callId: input.call.id,
      kind: existingIsUsable ? "VOICEMAIL" : "MISSED_CALL",
      practiceId: input.call.practiceId,
      sourceEventRevision: input.sourceEventRevision,
    });
    return existingIsUsable ? { id: existing!.id } : null;
  }
  const data = {
    callerName: input.call.callerName,
    durationSec: Math.max(existing?.durationSec ?? 0, input.recording.durationSec),
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

  await persistCanonicalUnansweredTask(transaction, {
    callId: input.call.id,
    kind: "VOICEMAIL",
    practiceId: input.call.practiceId,
    sourceEventRevision: input.sourceEventRevision,
  });
  return voicemail;
}
