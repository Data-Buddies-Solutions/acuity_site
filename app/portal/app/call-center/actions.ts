"use server";

import { revalidatePath } from "next/cache";

import {
  CallCenterNoteDisposition,
  CallCenterSessionDirection,
  type Prisma,
} from "@/generated/prisma/client";
import {
  buildCallCenterActivityScopeWhere,
  buildCallCenterNoteScopeWhere,
  buildCallCenterPatientSessionScopeWhere,
  buildPortalPatientSessionWhere,
  getCurrentPracticeCallCenterContext,
  getPortalCallCenterLocationState,
  isAbitaSouthFloridaCallCenterContext,
  isAbitaSweetwaterOpticalCallCenterContext,
  isSpecialAbitaCallCenterContext,
  setCallCenterEnabledForCurrentPractice,
} from "@/lib/call-center";
import { readPortalCanonicalWorkspace } from "@/lib/call-center/application/portal-canonical-workspace";
import { resolveCallerThreadInTransaction } from "@/lib/call-center/infrastructure/prisma-resolve-caller-thread";
import { reportCallCenterError } from "@/lib/call-center/operator-error-response";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

import { CALL_OUTCOME_SAVE_ERROR } from "./call-outcome";

const DISPOSITIONS_THAT_CLOSE_THREAD = new Set<CallCenterNoteDisposition>([
  CallCenterNoteDisposition.RESOLVED,
  CallCenterNoteDisposition.WRONG_NUMBER,
  CallCenterNoteDisposition.OTHER,
]);
const CALL_CENTER_MUTATION_ERROR = "Call center action could not be completed";

type CallCenterActionContext = NonNullable<
  Awaited<ReturnType<typeof getCurrentPracticeCallCenterContext>>
>;

type CallCenterActionScope = {
  activityWhere: ReturnType<typeof buildCallCenterActivityScopeWhere>;
  canonicalLocationIds: string[];
  locationId?: string | null;
  noteWhere: ReturnType<typeof buildCallCenterNoteScopeWhere>;
  sessionWhere: ReturnType<typeof buildCallCenterPatientSessionScopeWhere>;
};

function parseDisposition(value: FormDataEntryValue | null) {
  const disposition = String(value || "");

  if (
    disposition === CallCenterNoteDisposition.RESOLVED ||
    disposition === CallCenterNoteDisposition.CALLBACK_NEEDED ||
    disposition === CallCenterNoteDisposition.FOLLOW_UP_REQUIRED ||
    disposition === CallCenterNoteDisposition.WRONG_NUMBER ||
    disposition === CallCenterNoteDisposition.OTHER
  ) {
    return disposition;
  }

  return CallCenterNoteDisposition.RESOLVED;
}

function defaultStandaloneNoteLocationId(context: CallCenterActionContext) {
  const visibleLocations = context.hasAllLocationAccess
    ? context.practice.locations
    : context.practice.locations.filter((location) =>
        context.allowedLocationIds.includes(location.id),
      );
  const findByName = (matcher: (name: string) => boolean) =>
    visibleLocations.find((location) => matcher(location.name.trim().toLowerCase()))
      ?.id ?? null;

  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return (
      findByName((name) => name === "sweetwater") ??
      findByName(
        (name) =>
          name === "north miami beach optical" ||
          name === "brightview" ||
          name === "bright view",
      )
    );
  }

  if (isAbitaSouthFloridaCallCenterContext(context)) {
    return (
      findByName((name) => name === "hollywood") ??
      findByName((name) => name === "sweetwater")
    );
  }

  return (
    findByName((name) => /spring\s*hill/.test(name)) ?? visibleLocations[0]?.id ?? null
  );
}

function resolveActionScopeFromForm(
  context: CallCenterActionContext,
  formData: FormData,
): CallCenterActionScope | null {
  const officeId = String(formData.get("office") || "").trim();
  const canonicalLocation = getPortalCallCenterLocationState(context, {
    locationId: officeId,
  }).locations.find(({ id }) => id === officeId);
  const canonicalLocationIds = canonicalLocation?.locationIds?.length
    ? canonicalLocation.locationIds
    : canonicalLocation?.locationId
      ? [canonicalLocation.locationId]
      : [];

  if (context.practice.locations.some((location) => location.id === officeId)) {
    if (!context.hasAllLocationAccess && !context.allowedLocationIds.includes(officeId)) {
      return null;
    }

    const location = context.practice.locations.find((item) => item.id === officeId);
    const selectedLocation = location
      ? {
          id: location.id,
          label: location.name,
          locationId: location.id,
          outboundNumber: "",
        }
      : null;

    return {
      activityWhere: buildCallCenterActivityScopeWhere(context, selectedLocation),
      canonicalLocationIds: canonicalLocationIds.length
        ? canonicalLocationIds
        : [officeId],
      locationId: officeId,
      noteWhere: buildCallCenterNoteScopeWhere(context, selectedLocation),
      sessionWhere: buildCallCenterPatientSessionScopeWhere(context, selectedLocation),
    };
  }

  if (!officeId || isSpecialAbitaCallCenterContext(context)) {
    return {
      activityWhere: buildCallCenterActivityScopeWhere(context),
      canonicalLocationIds,
      locationId: defaultStandaloneNoteLocationId(context),
      noteWhere: buildCallCenterNoteScopeWhere(context),
      sessionWhere: buildCallCenterPatientSessionScopeWhere(context),
    };
  }

  const phoneId = officeId.startsWith("phone:") ? officeId.slice("phone:".length) : "";
  const nullLocationPhone = context.practice.phoneNumbers.some(
    (phone) => phone.id === phoneId && phone.locationId === null,
  );

  if ((officeId === "practice" || nullLocationPhone) && context.hasAllLocationAccess) {
    return {
      activityWhere: { locationId: null },
      canonicalLocationIds: [],
      locationId: null,
      noteWhere: { locationId: null },
      sessionWhere: { locationId: null },
    };
  }

  return null;
}

async function inferNoteSource(
  context: CallCenterActionContext,
  phoneVariants: string[],
  scope: CallCenterActionScope,
  database: Prisma.TransactionClient,
) {
  const [missedCall, voicemail, session] = await Promise.all([
    database.callCenterMissedCall.findFirst({
      orderBy: [{ createdAt: "desc" }],
      select: {
        createdAt: true,
        id: true,
        locationId: true,
        sessionId: true,
      },
      where: {
        fromPhone: {
          in: phoneVariants,
        },
        practiceId: context.practice.id,
        ...scope.activityWhere,
      },
    }),
    database.callCenterVoicemail.findFirst({
      orderBy: [{ createdAt: "desc" }],
      select: {
        createdAt: true,
        id: true,
        locationId: true,
        sessionId: true,
      },
      where: {
        fromPhone: {
          in: phoneVariants,
        },
        practiceId: context.practice.id,
        ...scope.activityWhere,
      },
    }),
    database.callCenterSession.findFirst({
      orderBy: [{ updatedAt: "desc" }, { startedAt: "desc" }],
      select: {
        answeredAt: true,
        endedAt: true,
        id: true,
        locationId: true,
        startedAt: true,
      },
      where: {
        AND: [
          scope.sessionWhere,
          buildPortalPatientSessionWhere(),
          {
            OR: [
              {
                fromPhone: {
                  in: phoneVariants,
                },
              },
              {
                toPhone: {
                  in: phoneVariants,
                },
              },
            ],
          },
          {
            direction: {
              in: [
                CallCenterSessionDirection.INBOUND,
                CallCenterSessionDirection.OUTBOUND,
              ],
            },
          },
        ],
        practiceId: context.practice.id,
      },
    }),
  ]);

  const candidates: Array<{
    at: Date;
    locationId: string | null;
    missedCallId: string | null;
    sessionId: string | null;
    voicemailId: string | null;
  }> = [];

  if (missedCall) {
    candidates.push({
      at: missedCall.createdAt,
      locationId: missedCall.locationId,
      missedCallId: missedCall.id,
      sessionId: missedCall.sessionId,
      voicemailId: null,
    });
  }

  if (voicemail) {
    candidates.push({
      at: voicemail.createdAt,
      locationId: voicemail.locationId,
      missedCallId: null,
      sessionId: voicemail.sessionId,
      voicemailId: voicemail.id,
    });
  }

  if (session) {
    candidates.push({
      at: session.endedAt ?? session.answeredAt ?? session.startedAt,
      locationId: session.locationId,
      missedCallId: null,
      sessionId: session.id,
      voicemailId: null,
    });
  }

  const latest = candidates.sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  const fallbackLocationId =
    "locationId" in scope
      ? (scope.locationId ?? null)
      : !context.hasAllLocationAccess && context.allowedLocationIds.length === 1
        ? context.allowedLocationIds[0]
        : null;

  return {
    locationId: latest?.locationId ?? fallbackLocationId,
    missedCallId: latest?.missedCallId ?? null,
    sessionId: latest?.sessionId ?? null,
    voicemailId: latest?.voicemailId ?? null,
  };
}

async function closeNeedsActionThread(
  context: CallCenterActionContext,
  disposition: CallCenterNoteDisposition,
  phoneVariants: string[],
  resolvedAt: Date,
  scope: CallCenterActionScope,
  transaction: Prisma.TransactionClient,
  queueId?: string,
) {
  await resolveCallerThreadInTransaction(
    {
      actor: {
        allowedLocationIds: context.allowedLocationIds,
        hasAllLocationAccess: context.hasAllLocationAccess,
        practiceId: context.practice.id,
        userId: context.session.user.id,
      },
      canonicalLocationIds: scope.canonicalLocationIds,
      disposition,
      legacyMissedCallWhere: scope.activityWhere,
      legacyNoteWhere: scope.noteWhere,
      legacyVoicemailWhere: scope.activityWhere as Prisma.CallCenterVoicemailWhereInput,
      now: resolvedAt,
      phoneVariants,
      queueId,
    },
    transaction,
  );
}

async function createCallCenterNote({
  body,
  context,
  disposition,
  phone,
  phoneVariants,
  resolvedThread,
  stationLabelSnapshot,
  stationSeatId,
  scope,
  transaction,
}: {
  body: string | null;
  context: CallCenterActionContext;
  disposition: CallCenterNoteDisposition;
  phone: string;
  phoneVariants: string[];
  resolvedThread: boolean;
  scope: CallCenterActionScope;
  stationLabelSnapshot?: string | null;
  stationSeatId?: string | null;
  transaction: Prisma.TransactionClient;
}) {
  const source = await inferNoteSource(context, phoneVariants, scope, transaction);
  const station = await resolveNoteStation({
    context,
    database: transaction,
    stationLabelSnapshot,
    stationSeatId,
  });
  const userLabel = context.session.user.name || context.session.user.email || null;

  await transaction.callCenterNote.create({
    data: {
      body,
      createdByLabel: userLabel,
      createdByUserId: context.session.user.id,
      disposition,
      fromPhone: normalizePhone(phone) || phone,
      locationId: source.locationId,
      missedCallId: source.missedCallId,
      practiceId: context.practice.id,
      resolvedThread,
      sessionId: source.sessionId,
      stationLabelSnapshot: station.stationLabelSnapshot,
      stationSeatId: station.stationSeatId,
      voicemailId: source.voicemailId,
    },
  });
}

async function resolveNoteStation({
  context,
  database,
  stationLabelSnapshot,
  stationSeatId,
}: {
  context: CallCenterActionContext;
  database: Prisma.TransactionClient;
  stationLabelSnapshot?: string | null;
  stationSeatId?: string | null;
}) {
  const fallbackLabel = stationLabelSnapshot?.trim() || null;
  const seatId = stationSeatId?.trim();

  if (!seatId) {
    return {
      stationLabelSnapshot: fallbackLabel,
      stationSeatId: null,
    };
  }

  const seat = await database.callCenterAgentSeat.findFirst({
    select: {
      extension: true,
      id: true,
      label: true,
    },
    where: {
      id: seatId,
      practiceId: context.practice.id,
      ...(context.hasAllLocationAccess
        ? {}
        : {
            OR: [
              {
                locationId: {
                  in: context.allowedLocationIds,
                },
              },
              {
                locationId: null,
              },
            ],
          }),
    },
  });

  if (!seat) {
    return {
      stationLabelSnapshot: fallbackLabel,
      stationSeatId: null,
    };
  }

  return noteStationFromSeat(seat);
}

function noteStationFromSeat(seat: {
  extension: string | null;
  id: string;
  label: string;
}) {
  return {
    stationLabelSnapshot: seat.extension
      ? `${seat.extension} - ${seat.label}`
      : seat.label,
    stationSeatId: seat.id,
  };
}

function revalidateCallCenterPaths(phone: string) {
  revalidatePath("/portal/app/call-center");
  revalidatePath("/portal/app/call-center/follow-up");
  revalidatePath(`/portal/app/call-center/callers/${encodeURIComponent(phone)}`);
  const normalized = normalizePhone(phone);

  if (normalized && normalized !== phone) {
    revalidatePath(`/portal/app/call-center/callers/${encodeURIComponent(normalized)}`);
  }
}

export type EnableCallCenterState = {
  error: ReturnType<typeof reportCallCenterError>["envelope"]["error"] | null;
};

export async function enableCallCenterAction(
  _state: EnableCallCenterState,
): Promise<EnableCallCenterState> {
  try {
    await setCallCenterEnabledForCurrentPractice(true);
    revalidatePath("/portal/app/call-center");
    return { error: null };
  } catch (error) {
    return {
      error: reportCallCenterError(error, undefined, {
        errorCode: "TEMPORARY_SERVICE_FAILURE",
        logLabel: "enable call center failed",
        retryable: true,
      }).envelope.error,
    };
  }
}

export async function disableCallCenterAction() {
  await setCallCenterEnabledForCurrentPractice(false);
  revalidatePath("/portal/app/call-center");
}

export async function resolveMissedCallAction(formData: FormData) {
  const context = await getCurrentPracticeCallCenterContext();
  const id = String(formData.get("id") || "");

  if (!context || !id) {
    return;
  }

  await prisma.callCenterMissedCall.updateMany({
    data: {
      calledBack: true,
      resolvedAt: new Date(),
    },
    where: {
      id,
      practiceId: context.practice.id,
      ...buildCallCenterActivityScopeWhere(context),
    },
  });

  revalidatePath("/portal/app/call-center");
}

export async function resolveVoicemailAction(formData: FormData) {
  const context = await getCurrentPracticeCallCenterContext();
  const id = String(formData.get("id") || "");

  if (!context || !id) {
    return;
  }

  await prisma.callCenterVoicemail.updateMany({
    data: {
      resolvedAt: new Date(),
    },
    where: {
      id,
      practiceId: context.practice.id,
      ...buildCallCenterActivityScopeWhere(context),
    },
  });

  revalidatePath("/portal/app/call-center");
}

export async function resolveNeedsActionGroupAction(formData: FormData) {
  const context = await getCurrentPracticeCallCenterContext();
  const phone = String(formData.get("phone") || "");
  const phoneVariants = phoneLookupVariants(phone);
  const stationLabelSnapshot =
    String(
      formData.get("stationLabel") || formData.get("stationLabelSnapshot") || "",
    ).trim() || null;
  const stationSeatId = String(formData.get("stationSeatId") || "").trim() || null;

  if (!context || !phoneVariants.length) {
    throw new Error(CALL_CENTER_MUTATION_ERROR);
  }

  const scope = resolveActionScopeFromForm(context, formData);

  if (!scope) {
    throw new Error(CALL_CENTER_MUTATION_ERROR);
  }

  const requestedQueueId = String(formData.get("queue") || "").trim() || undefined;
  const canonicalWorkspace = requestedQueueId
    ? await readPortalCanonicalWorkspace(
        scope.canonicalLocationIds,
        true,
        requestedQueueId,
      )
    : null;
  const queueId = canonicalWorkspace?.availableQueues.some(
    ({ id }) => id === requestedQueueId,
  )
    ? requestedQueueId
    : undefined;
  if (requestedQueueId && !queueId) throw new Error(CALL_CENTER_MUTATION_ERROR);

  const resolvedAt = new Date();

  await prisma.$transaction(async (transaction) => {
    await createCallCenterNote({
      body: null,
      context,
      disposition: CallCenterNoteDisposition.RESOLVED,
      phone,
      phoneVariants,
      resolvedThread: true,
      scope,
      stationLabelSnapshot,
      stationSeatId,
      transaction,
    });
    await closeNeedsActionThread(
      context,
      CallCenterNoteDisposition.RESOLVED,
      phoneVariants,
      resolvedAt,
      scope,
      transaction,
      queueId,
    );
  });

  revalidateCallCenterPaths(phone);
}

export async function saveCallCenterNoteAction(formData: FormData) {
  const context = await getCurrentPracticeCallCenterContext();
  const phone = String(formData.get("phone") || "");
  const phoneVariants = phoneLookupVariants(phone);
  const disposition = parseDisposition(formData.get("disposition"));
  const body = String(formData.get("note") || "").trim() || null;
  const stationLabelSnapshot =
    String(
      formData.get("stationLabel") || formData.get("stationLabelSnapshot") || "",
    ).trim() || null;
  const stationSeatId = String(formData.get("stationSeatId") || "").trim() || null;

  if (!context || !phoneVariants.length) {
    return { error: CALL_OUTCOME_SAVE_ERROR, ok: false as const };
  }

  const scope = resolveActionScopeFromForm(context, formData);

  if (!scope) {
    return { error: CALL_OUTCOME_SAVE_ERROR, ok: false as const };
  }

  const resolvedThread = DISPOSITIONS_THAT_CLOSE_THREAD.has(disposition);

  await prisma.$transaction(async (transaction) => {
    await createCallCenterNote({
      body,
      context,
      disposition,
      phone,
      phoneVariants,
      resolvedThread,
      scope,
      stationLabelSnapshot,
      stationSeatId,
      transaction,
    });

    if (resolvedThread) {
      await closeNeedsActionThread(
        context,
        disposition,
        phoneVariants,
        new Date(),
        scope,
        transaction,
      );
    }
  });

  revalidateCallCenterPaths(phone);
  return { ok: true as const };
}

export async function saveCallCenterNoteFormAction(formData: FormData) {
  const result = await saveCallCenterNoteAction(formData);
  if (!result.ok) throw new Error(CALL_CENTER_MUTATION_ERROR);
}
