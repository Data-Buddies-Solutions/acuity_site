import {
  executeIdempotentCreation,
  executeIdempotentOperation,
  type OperationCreationResult,
  type OperationReceipt,
  type OperationReceiptData,
  type OperationReceiptTransaction,
} from "@/lib/call-center/application/operation-receipts";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { fetchTelnyxRecordingMetadata } from "@/lib/call-center/infrastructure/telnyx-recording";
import { prismaOperatorFollowUpStore } from "@/lib/call-center/infrastructure/prisma-operator-follow-up-store";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";

export const CALL_DISPOSITIONS = [
  "RESOLVED",
  "CALLBACK_NEEDED",
  "FOLLOW_UP_REQUIRED",
  "WRONG_NUMBER",
  "OTHER",
] as const;
export type CallDisposition = (typeof CALL_DISPOSITIONS)[number];

export type DispositionCallInput = {
  callId: string;
  disposition: CallDisposition;
  expectedStateVersion: number;
  idempotencyKey: string;
  note: string | null;
  taskIds: string[];
};

export type ResolveCallerThreadInput = {
  expectedTaskIds: string[];
  idempotencyKey: string;
  locationId?: string;
  phone: string;
  queueId?: string;
};

export type SaveOperatorNoteInput = {
  callId: string;
  disposition: CallDisposition;
  expectedStateVersion: number;
  expectedTaskIds: string[];
  idempotencyKey: string;
  locationId?: string;
  note: string | null;
  phone: string;
  queueId?: string;
};

type CanonicalCallerInput = {
  expectedTaskIds: string[];
  idempotencyKey: string;
  locationId?: string;
  phone: string;
  phoneVariants: string[];
  queueId?: string;
};

export type CanonicalSaveOperatorNoteInput = CanonicalCallerInput & {
  callId: string;
  disposition: CallDisposition;
  expectedStateVersion: number;
  note: string | null;
};

export interface OperatorFollowUpTransaction extends OperationReceiptTransaction {
  resolveCallerThread(
    actor: QueueAccessActor,
    input: CanonicalCallerInput,
    now: Date,
  ): Promise<OperationReceiptData>;
  saveDisposition(
    actor: QueueAccessActor,
    input: DispositionCallInput,
    now: Date,
  ): Promise<OperationReceiptData>;
  saveNote(
    actor: QueueAccessActor,
    input: CanonicalSaveOperatorNoteInput,
    now: Date,
  ): Promise<OperationCreationResult>;
}

export interface OperatorFollowUpStore {
  findVoicemail(
    actor: QueueAccessActor,
    recordingId: string,
  ): Promise<{
    durationSec: number;
    id: string;
    recordingUrl: string;
  } | null>;
  transaction<T>(
    operation: (transaction: OperatorFollowUpTransaction) => Promise<T>,
  ): Promise<T>;
  updateVoicemail(
    id: string,
    update: { durationSec?: number; listenedAt?: Date; recordingUrl?: string },
  ): Promise<void>;
}

export class OperatorFollowUpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OperatorFollowUpError";
  }
}

type OperatorFollowUpProviders = {
  fetchAudio(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  fetchRecordingMetadata: typeof fetchTelnyxRecordingMetadata;
};

function canonicalTaskIds(taskIds: string[]) {
  return [...new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))].sort();
}

function canonicalDispositionInput(input: DispositionCallInput) {
  const callId = input.callId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  const note = input.note?.trim() || null;
  const taskIds = canonicalTaskIds(input.taskIds);
  if (
    !callId ||
    !idempotencyKey ||
    idempotencyKey.length > 200 ||
    !CALL_DISPOSITIONS.includes(input.disposition) ||
    !Number.isInteger(input.expectedStateVersion) ||
    input.expectedStateVersion < 0 ||
    (note?.length ?? 0) > 2_000 ||
    taskIds.length > 100 ||
    taskIds.some((taskId) => taskId.length > 200)
  ) {
    throw new OperatorFollowUpError("Valid Call disposition input required", 400);
  }
  return { ...input, callId, idempotencyKey, note, taskIds };
}

function canonicalCallerInput(
  actor: QueueAccessActor,
  input: ResolveCallerThreadInput,
  requireTasks: boolean,
): CanonicalCallerInput {
  const phone = normalizePhone(input.phone);
  const phoneVariants = phoneLookupVariants(phone);
  const idempotencyKey = input.idempotencyKey.trim();
  const locationId = input.locationId?.trim() || undefined;
  const queueId = input.queueId?.trim() || undefined;
  const expectedTaskIds = canonicalTaskIds(input.expectedTaskIds);
  if (
    !phone ||
    !phoneVariants.length ||
    !idempotencyKey ||
    idempotencyKey.length > 200 ||
    (requireTasks && !expectedTaskIds.length)
  ) {
    throw new OperatorFollowUpError("Valid caller follow-up input required", 400);
  }
  if (
    locationId &&
    !actor.hasAllLocationAccess &&
    !actor.allowedLocationIds.includes(locationId)
  ) {
    throw new OperatorFollowUpError("Caller follow-up not found", 404);
  }
  return {
    expectedTaskIds,
    idempotencyKey,
    locationId,
    phone,
    phoneVariants,
    queueId,
  };
}

export function createOperatorFollowUp(
  store: OperatorFollowUpStore,
  providers: OperatorFollowUpProviders = {
    fetchAudio: (input, init) => fetch(input, init),
    fetchRecordingMetadata: fetchTelnyxRecordingMetadata,
  },
) {
  return {
    async disposition(
      actor: QueueAccessActor,
      input: DispositionCallInput,
      now = new Date(),
    ): Promise<OperationReceipt> {
      const canonical = canonicalDispositionInput(input);
      return store.transaction((transaction) =>
        executeIdempotentOperation(
          transaction,
          {
            actorUserId: actor.userId,
            aggregateId: canonical.callId,
            aggregateType: "CALL",
            idempotencyKey: canonical.idempotencyKey,
            practiceId: actor.practiceId,
            targetFingerprint: JSON.stringify({
              callId: canonical.callId,
              disposition: canonical.disposition,
              note: canonical.note,
              taskIds: canonical.taskIds,
            }),
            type: "CALL_DISPOSITION_REQUESTED",
          },
          (current) => current.saveDisposition(actor, canonical, now),
          now,
        ),
      );
    },

    async resolveCallerThread(
      actor: QueueAccessActor,
      input: ResolveCallerThreadInput,
      now = new Date(),
    ): Promise<OperationReceipt> {
      const canonical = canonicalCallerInput(actor, input, true);
      return store.transaction((transaction) =>
        executeIdempotentOperation(
          transaction,
          {
            actorUserId: actor.userId,
            aggregateId: canonical.phone,
            aggregateType: "TASK",
            idempotencyKey: canonical.idempotencyKey,
            practiceId: actor.practiceId,
            targetFingerprint: JSON.stringify({
              expectedTaskIds: canonical.expectedTaskIds,
              locationId: canonical.locationId ?? null,
              phone: canonical.phone,
              queueId: canonical.queueId ?? null,
            }),
            type: "CALLER_THREAD_RESOLUTION_REQUESTED",
          },
          (current) => current.resolveCallerThread(actor, canonical, now),
          now,
        ),
      );
    },

    async playVoicemail(
      actor: QueueAccessActor,
      input: { range: string | null; recordingId: string },
      now = new Date(),
    ) {
      const recordingId = input.recordingId.trim();
      if (!recordingId) {
        throw new OperatorFollowUpError("Voicemail is unavailable", 404);
      }
      const voicemail = await store.findVoicemail(actor, recordingId);
      if (!voicemail) {
        throw new OperatorFollowUpError("Voicemail is unavailable", 404);
      }
      const metadata = await providers.fetchRecordingMetadata(recordingId);
      const urls = [metadata.recordingUrl, voicemail.recordingUrl].filter(
        (url, index, values): url is string =>
          Boolean(url && values.indexOf(url) === index),
      );
      if (!urls.length) {
        throw new OperatorFollowUpError("Voicemail is unavailable", 404);
      }
      const upstreamHeaders: Record<string, string> = {};
      if (input.range) upstreamHeaders.Range = input.range;
      let audioResponse: Response | null = null;
      for (const url of urls) {
        try {
          const response = await providers.fetchAudio(url, {
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
        throw new OperatorFollowUpError("Voicemail is unavailable", 502);
      }
      const update: {
        durationSec?: number;
        listenedAt?: Date;
        recordingUrl?: string;
      } = {};
      if (!input.range) update.listenedAt = now;
      if (metadata.durationSec > voicemail.durationSec) {
        update.durationSec = metadata.durationSec;
      }
      if (metadata.recordingUrl && metadata.recordingUrl !== voicemail.recordingUrl) {
        update.recordingUrl = metadata.recordingUrl;
      }
      if (Object.keys(update).length) {
        await store.updateVoicemail(voicemail.id, update);
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

    async saveNote(
      actor: QueueAccessActor,
      input: SaveOperatorNoteInput,
      now = new Date(),
    ): Promise<OperationReceipt> {
      const disposition = canonicalDispositionInput({
        callId: input.callId,
        disposition: input.disposition,
        expectedStateVersion: input.expectedStateVersion,
        idempotencyKey: input.idempotencyKey,
        note: input.note,
        taskIds: input.expectedTaskIds,
      });
      const canonical = {
        ...canonicalCallerInput(actor, input, false),
        callId: disposition.callId,
        disposition: disposition.disposition,
        expectedStateVersion: disposition.expectedStateVersion,
        note: disposition.note,
      };
      return store.transaction((transaction) =>
        executeIdempotentCreation(
          transaction,
          {
            actorUserId: actor.userId,
            aggregateType: "TASK",
            idempotencyKey: canonical.idempotencyKey,
            practiceId: actor.practiceId,
            targetFingerprint: JSON.stringify({
              callId: canonical.callId,
              disposition: canonical.disposition,
              expectedStateVersion: canonical.expectedStateVersion,
              expectedTaskIds: canonical.expectedTaskIds,
              locationId: canonical.locationId ?? null,
              note: canonical.note,
              phone: canonical.phone,
              queueId: canonical.queueId ?? null,
            }),
            type: "OPERATOR_NOTE_REQUESTED",
          },
          (current) => current.saveNote(actor, canonical, now),
          now,
        ),
      );
    },
  };
}

export const operatorFollowUp = createOperatorFollowUp(prismaOperatorFollowUpStore);
