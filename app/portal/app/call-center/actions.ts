"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { type Prisma } from "@/generated/prisma/client";
import { canonicalCallAccessWhere } from "@/lib/call-center/application/portal-canonical-history";
import { listAccessibleQueues } from "@/lib/call-center/auth/queue-access";
import { resolveCallerThreadInTransaction } from "@/lib/call-center/infrastructure/prisma-resolve-caller-thread";
import { reportCallCenterError } from "@/lib/call-center/operator-error-response";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { getCurrentPortalPracticeContext } from "@/lib/portal-access";

const CALL_CENTER_MUTATION_ERROR = "Call center action could not be completed";
const CALL_OUTCOME_SAVE_ERROR =
  "We couldn't save this outcome. Check the details and try again.";
const CLOSING_DISPOSITIONS = new Set(["RESOLVED", "WRONG_NUMBER", "OTHER"]);

type ActionContext = NonNullable<
  Awaited<ReturnType<typeof getCurrentPortalPracticeContext>>
>;

function parseDisposition(value: FormDataEntryValue | null) {
  const disposition = String(value || "");
  return [
    "RESOLVED",
    "CALLBACK_NEEDED",
    "FOLLOW_UP_REQUIRED",
    "WRONG_NUMBER",
    "OTHER",
  ].includes(disposition)
    ? disposition
    : "RESOLVED";
}

function requestedLocationIds(context: ActionContext, formData: FormData) {
  const locationId = String(formData.get("office") || "").trim();
  if (!locationId) return [];
  const visible = context.practice.locations.some(({ id }) => id === locationId);
  const allowed =
    context.hasAllLocationAccess || context.allowedLocationIds.includes(locationId);
  if (!visible || !allowed) throw new Error(CALL_CENTER_MUTATION_ERROR);
  return [locationId];
}

async function requestedQueueId(context: ActionContext, formData: FormData) {
  const queueId = String(formData.get("queue") || "").trim();
  if (!queueId) return undefined;
  const queues = await listAccessibleQueues({
    allowedLocationIds: context.allowedLocationIds,
    hasAllLocationAccess: context.hasAllLocationAccess,
    practiceId: context.practice.id,
    userId: context.session.user.id,
  });
  if (!queues.some(({ id }) => id === queueId)) {
    throw new Error(CALL_CENTER_MUTATION_ERROR);
  }
  return queueId;
}

function revalidateCallCenterPaths(phone?: string) {
  revalidatePath("/portal/app/call-center");
  revalidatePath("/portal/app/call-center/follow-up");
  if (!phone) return;
  for (const value of new Set([phone, normalizePhone(phone)].filter(Boolean))) {
    revalidatePath(
      `/portal/app/call-center/callers/${encodeURIComponent(value as string)}`,
    );
  }
}

export async function resolveNeedsActionGroupAction(formData: FormData) {
  const context = await getCurrentPortalPracticeContext();
  const phone = String(formData.get("phone") || "").trim();
  const phoneVariants = phoneLookupVariants(phone);
  if (!context || !phoneVariants.length) throw new Error(CALL_CENTER_MUTATION_ERROR);

  const locationIds = requestedLocationIds(context, formData);
  const queueId = await requestedQueueId(context, formData);
  await prisma.$transaction((transaction) =>
    resolveCallerThreadInTransaction(
      {
        actor: {
          allowedLocationIds: context.allowedLocationIds,
          hasAllLocationAccess: context.hasAllLocationAccess,
          practiceId: context.practice.id,
          userId: context.session.user.id,
        },
        locationIds,
        disposition: "RESOLVED",
        now: new Date(),
        phoneVariants,
        queueId,
      },
      transaction,
    ),
  );
  revalidateCallCenterPaths(phone);
}

async function saveCanonicalNote(
  context: ActionContext,
  formData: FormData,
  phone: string,
  phoneVariants: string[],
  disposition: string,
  body: string | null,
) {
  const locationIds = requestedLocationIds(context, formData);
  const queueId = await requestedQueueId(context, formData);
  const access = {
    ...canonicalCallAccessWhere(context, locationIds),
    ...(queueId ? { queueId } : {}),
  } satisfies Prisma.CallCenterCallWhereInput;
  const call = await prisma.callCenterCall.findFirst({
    orderBy: { receivedAt: "desc" },
    select: { id: true },
    where: {
      ...access,
      OR: [{ fromPhone: { in: phoneVariants } }, { toPhone: { in: phoneVariants } }],
    },
  });
  if (!call) throw new Error(CALL_CENTER_MUTATION_ERROR);
  const now = new Date();
  const taskId = randomUUID();
  const kind =
    disposition === "CALLBACK_NEEDED"
      ? "CALLBACK"
      : disposition === "FOLLOW_UP_REQUIRED"
        ? "FOLLOW_UP"
        : "NOTE";
  const open = kind !== "NOTE";

  await prisma.$transaction(async (transaction) => {
    if (CLOSING_DISPOSITIONS.has(disposition)) {
      await resolveCallerThreadInTransaction(
        {
          actor: {
            allowedLocationIds: context.allowedLocationIds,
            hasAllLocationAccess: context.hasAllLocationAccess,
            practiceId: context.practice.id,
            userId: context.session.user.id,
          },
          locationIds,
          disposition,
          now,
          phoneVariants,
          queueId,
        },
        transaction,
      );
    }

    const event = await transaction.callCenterEvent.create({
      data: {
        actorUserId: context.session.user.id,
        aggregateId: taskId,
        aggregateType: "TASK",
        data: { body, callId: call.id, disposition },
        idempotencyKey: `portal-note:${taskId}`,
        occurredAt: now,
        practiceId: context.practice.id,
        type: "TASK_CREATED",
      },
      select: { revision: true },
    });
    await transaction.callCenterTask.create({
      data: {
        callId: call.id,
        createdAt: now,
        dedupeKey: `portal-note:${taskId}`,
        id: taskId,
        kind,
        note: body,
        practiceId: context.practice.id,
        resolvedAt: open ? null : now,
        resolvedByUserId: open ? null : context.session.user.id,
        sourceEventRevision: event.revision,
        status: open ? "OPEN" : "RESOLVED",
      },
    });
  });
}

async function saveCallCenterNoteAction(formData: FormData) {
  const context = await getCurrentPortalPracticeContext();
  const phone = String(formData.get("phone") || "").trim();
  const phoneVariants = phoneLookupVariants(phone);
  if (!context || !phoneVariants.length) {
    return { error: CALL_OUTCOME_SAVE_ERROR, ok: false as const };
  }

  try {
    await saveCanonicalNote(
      context,
      formData,
      phone,
      phoneVariants,
      parseDisposition(formData.get("disposition")),
      String(formData.get("note") || "").trim() || null,
    );
    revalidateCallCenterPaths(phone);
    return { ok: true as const };
  } catch (error) {
    reportCallCenterError(error, undefined, {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "save call center note failed",
      retryable: true,
    });
    return { error: CALL_OUTCOME_SAVE_ERROR, ok: false as const };
  }
}

export async function saveCallCenterNoteFormAction(formData: FormData) {
  const result = await saveCallCenterNoteAction(formData);
  if (!result.ok) throw new Error(CALL_CENTER_MUTATION_ERROR);
}
