import {
  executeIdempotentCreation,
  executeIdempotentOperation,
  type OperationCreationResult,
  type OperationReceipt,
  type OperationReceiptData,
  type OperationReceiptTransaction,
} from "@/lib/call-center/application/operation-receipts";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
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
  transaction<T>(
    operation: (transaction: OperatorFollowUpTransaction) => Promise<T>,
  ): Promise<T>;
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

export function createOperatorFollowUp(store: OperatorFollowUpStore) {
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
