"use server";

import { revalidatePath } from "next/cache";

import { CallCenterNoteDisposition } from "@/generated/prisma/client";
import {
  buildCallCenterActivityScopeWhere,
  buildCallCenterSessionScopeWhere,
  getCurrentPracticeCallCenterContext,
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

async function inferNoteSource(
  context: NonNullable<Awaited<ReturnType<typeof getCurrentPracticeCallCenterContext>>>,
  phoneVariants: string[],
) {
  const activityScope = buildCallCenterActivityScopeWhere(context);
  const sessionScope = buildCallCenterSessionScopeWhere(context);
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
        ...activityScope,
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
        ...activityScope,
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
          sessionScope,
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

  return {
    locationId:
      latest?.locationId ??
      (!context.hasAllLocationAccess && context.allowedLocationIds.length === 1
        ? context.allowedLocationIds[0]
        : null),
    missedCallId: latest?.missedCallId ?? null,
    sessionId: latest?.sessionId ?? null,
    voicemailId: latest?.voicemailId ?? null,
  };
}

async function closeNeedsActionThread(
  context: NonNullable<Awaited<ReturnType<typeof getCurrentPracticeCallCenterContext>>>,
  phoneVariants: string[],
  resolvedAt: Date,
) {
  const scopeWhere = buildCallCenterActivityScopeWhere(context);

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
        ...scopeWhere,
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
        ...scopeWhere,
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
        ...scopeWhere,
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
}: {
  body: string | null;
  context: NonNullable<Awaited<ReturnType<typeof getCurrentPracticeCallCenterContext>>>;
  disposition: CallCenterNoteDisposition;
  phone: string;
  phoneVariants: string[];
  resolvedThread: boolean;
  stationLabelSnapshot?: string | null;
  stationSeatId?: string | null;
}) {
  const source = await inferNoteSource(context, phoneVariants);
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
  context: NonNullable<Awaited<ReturnType<typeof getCurrentPracticeCallCenterContext>>>;
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

  return {
    stationLabelSnapshot: seat.extension
      ? `${seat.extension} - ${seat.label}`
      : seat.label,
    stationSeatId: seat.id,
  };
}

function revalidateCallCenterPaths(phone: string) {
  revalidatePath("/portal/app/call-center");
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

  if (!context || !phoneVariants.length) {
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
  });
  await closeNeedsActionThread(context, phoneVariants, resolvedAt);

  revalidateCallCenterPaths(phone);
}

export async function saveCallCenterNoteAction(formData: FormData) {
  const context = await getCurrentPracticeCallCenterContext();
  const phone = String(formData.get("phone") || "");
  const phoneVariants = phoneLookupVariants(phone);
  const disposition = parseDisposition(formData.get("disposition"));
  const body = String(formData.get("note") || "").trim() || null;
  const stationLabelSnapshot =
    String(formData.get("stationLabel") || formData.get("stationLabelSnapshot") || "")
      .trim() || null;
  const stationSeatId = String(formData.get("stationSeatId") || "").trim() || null;

  if (!context || !phoneVariants.length) {
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
    stationLabelSnapshot,
    stationSeatId,
  });

  if (resolvedThread) {
    await closeNeedsActionThread(context, phoneVariants, new Date());
  }

  revalidateCallCenterPaths(phone);
}
