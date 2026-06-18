"use server";

import { revalidatePath } from "next/cache";

import {
  CallCenterNoteDisposition,
  CallCenterSessionDirection,
} from "@/generated/prisma/client";
import {
  buildCallCenterActivityScopeWhere,
  buildCallCenterNoteScopeWhere,
  buildCallCenterPatientSessionScopeWhere,
  buildPortalPatientSessionWhere,
  getCurrentPracticeCallCenterContext,
  isAbitaSouthFloridaCallCenterContext,
  isAbitaSweetwaterOpticalCallCenterContext,
  isSpecialAbitaCallCenterContext,
  setCallCenterEnabledForCurrentPractice,
} from "@/lib/call-center";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

const OPEN_NOTE_DISPOSITIONS = [
  CallCenterNoteDisposition.CALLBACK_NEEDED,
  CallCenterNoteDisposition.FOLLOW_UP_REQUIRED,
];

const DISPOSITIONS_THAT_CLOSE_THREAD = new Set<CallCenterNoteDisposition>([
  CallCenterNoteDisposition.RESOLVED,
  CallCenterNoteDisposition.WRONG_NUMBER,
  CallCenterNoteDisposition.OTHER,
]);

type CallCenterActionContext = NonNullable<
  Awaited<ReturnType<typeof getCurrentPracticeCallCenterContext>>
>;

type CallCenterActionScope = {
  activityWhere: ReturnType<typeof buildCallCenterActivityScopeWhere>;
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
    return findByName((name) => name === "sweetwater");
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

  if (!officeId || isSpecialAbitaCallCenterContext(context)) {
    return {
      activityWhere: buildCallCenterActivityScopeWhere(context),
      locationId: defaultStandaloneNoteLocationId(context),
      noteWhere: buildCallCenterNoteScopeWhere(context),
      sessionWhere: buildCallCenterPatientSessionScopeWhere(context),
    };
  }

  if (context.practice.locations.some((location) => location.id === officeId)) {
    if (!context.hasAllLocationAccess && !context.allowedLocationIds.includes(officeId)) {
      return null;
    }

    return {
      activityWhere: { locationId: officeId },
      locationId: officeId,
      noteWhere: { locationId: officeId },
      sessionWhere: { locationId: officeId },
    };
  }

  const phoneId = officeId.startsWith("phone:") ? officeId.slice("phone:".length) : "";
  const nullLocationPhone = context.practice.phoneNumbers.some(
    (phone) => phone.id === phoneId && phone.locationId === null,
  );

  if ((officeId === "practice" || nullLocationPhone) && context.hasAllLocationAccess) {
    return {
      activityWhere: { locationId: null },
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
) {
  const [missedCall, voicemail, session] = await Promise.all([
    prisma.callCenterMissedCall.findFirst({
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
    prisma.callCenterVoicemail.findFirst({
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
    prisma.callCenterSession.findFirst({
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
  phoneVariants: string[],
  resolvedAt: Date,
  scope: CallCenterActionScope,
) {
  await Promise.all([
    prisma.callCenterMissedCall.updateMany({
      data: {
        calledBack: true,
        resolvedAt,
      },
      where: {
        calledBack: false,
        fromPhone: {
          in: phoneVariants,
        },
        practiceId: context.practice.id,
        resolvedAt: null,
        ...scope.activityWhere,
      },
    }),
    prisma.callCenterVoicemail.updateMany({
      data: {
        resolvedAt,
      },
      where: {
        fromPhone: {
          in: phoneVariants,
        },
        practiceId: context.practice.id,
        resolvedAt: null,
        ...scope.activityWhere,
      },
    }),
    prisma.callCenterNote.updateMany({
      data: {
        resolvedThread: true,
      },
      where: {
        disposition: {
          in: OPEN_NOTE_DISPOSITIONS,
        },
        fromPhone: {
          in: phoneVariants,
        },
        practiceId: context.practice.id,
        resolvedThread: false,
        ...scope.noteWhere,
      },
    }),
  ]);
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
}) {
  const source = await inferNoteSource(context, phoneVariants, scope);
  const station = await resolveNoteStation({
    context,
    stationLabelSnapshot,
    stationSeatId,
  });
  const userLabel = context.session.user.name || context.session.user.email || null;

  await prisma.callCenterNote.create({
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
  stationLabelSnapshot,
  stationSeatId,
}: {
  context: CallCenterActionContext;
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

  const seat = await prisma.callCenterAgentSeat.findFirst({
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

export async function enableCallCenterAction() {
  await setCallCenterEnabledForCurrentPractice(true);
  revalidatePath("/portal/app/call-center");
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
    return;
  }

  const scope = resolveActionScopeFromForm(context, formData);

  if (!scope) {
    return;
  }

  const resolvedAt = new Date();

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
  });
  await closeNeedsActionThread(context, phoneVariants, resolvedAt, scope);

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
    return;
  }

  const scope = resolveActionScopeFromForm(context, formData);

  if (!scope) {
    return;
  }

  const resolvedThread = DISPOSITIONS_THAT_CLOSE_THREAD.has(disposition);

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
  });

  if (resolvedThread) {
    await closeNeedsActionThread(context, phoneVariants, new Date(), scope);
  }

  revalidateCallCenterPaths(phone);
}
