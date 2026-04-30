import {
  CallCenterSessionDirection,
  type CallCenterSessionStatus,
  type Prisma,
} from "@/generated/prisma/client";

import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPracticeBranding } from "@/lib/practice-branding";
import { startTelnyxRecording, speakOnTelnyxCall, TelnyxError } from "@/lib/telnyx";

const MISSED_CAUSES = new Set([
  "call_rejected",
  "no_answer",
  "originator_cancel",
  "timeout",
  "user_busy",
]);

function env(name: string) {
  return process.env[name]?.trim() || "";
}

export function normalizePhone(phone: string | null | undefined) {
  const trimmed = phone?.trim() ?? "";
  const digits = trimmed.replace(/\D/g, "");

  if (!digits) {
    return trimmed;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  return trimmed.startsWith("+") ? trimmed : `+${digits}`;
}

export function phoneLookupVariants(phone: string | null | undefined) {
  const variants = new Set<string>();
  const trimmed = phone?.trim() ?? "";
  const normalized = normalizePhone(trimmed);
  const digits = trimmed.replace(/\D/g, "");

  if (trimmed) variants.add(trimmed);
  if (normalized) variants.add(normalized);
  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
  }
  if (digits.length === 10) {
    variants.add(`+1${digits}`);
    variants.add(`1${digits}`);
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    variants.add(digits.slice(1));
  }

  return [...variants].filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function asDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function decodeClientState(value: unknown) {
  const raw = asString(value);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function defaultSettingsFromPractice(practice: {
  phoneNumbers: Array<{ isPrimary: boolean; phoneNumber: string }>;
}) {
  const primaryPhone =
    practice.phoneNumbers.find((phone) => phone.isPrimary) ??
    practice.phoneNumbers[0] ??
    null;

  return {
    inboundPhoneNumber: env("TELNYX_INBOUND_NUMBER") || primaryPhone?.phoneNumber || null,
    outboundCallerNumber: env("TELNYX_PHONE_NUMBER") || primaryPhone?.phoneNumber || null,
    telnyxConnectionId: env("TELNYX_CONNECTION_ID") || null,
    telnyxCredentialId: env("TELNYX_CREDENTIAL_ID") || null,
  };
}

export async function getCurrentPracticeCallCenterContext() {
  const session = await getAuthSession();

  if (!session) {
    return null;
  }

  const membership = await prisma.practiceMembership.findFirst({
    include: {
      practice: {
        include: {
          callCenterSettings: true,
          locations: {
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          },
          phoneNumbers: {
            include: {
              location: true,
            },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          },
        },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    where: {
      userId: session.user.id,
    },
  });

  if (!membership) {
    return null;
  }

  return {
    membership,
    practice: membership.practice,
    session,
  };
}

export async function setCallCenterEnabledForCurrentPractice(enabled: boolean) {
  const context = await getCurrentPracticeCallCenterContext();

  if (!context) {
    throw new TelnyxError("Unauthorized", 401);
  }

  const defaults = defaultSettingsFromPractice(context.practice);

  await prisma.practiceCallCenterSettings.upsert({
    create: {
      ...defaults,
      enabled,
      practiceId: context.practice.id,
    },
    update: {
      enabled,
      inboundPhoneNumber:
        context.practice.callCenterSettings?.inboundPhoneNumber ??
        defaults.inboundPhoneNumber,
      outboundCallerNumber:
        context.practice.callCenterSettings?.outboundCallerNumber ??
        defaults.outboundCallerNumber,
      telnyxConnectionId:
        context.practice.callCenterSettings?.telnyxConnectionId ??
        defaults.telnyxConnectionId,
      telnyxCredentialId:
        context.practice.callCenterSettings?.telnyxCredentialId ??
        defaults.telnyxCredentialId,
    },
    where: {
      practiceId: context.practice.id,
    },
  });
}

export function resolveTelnyxRuntimeSettings(settings: {
  inboundPhoneNumber: string | null;
  outboundCallerNumber: string | null;
  telnyxConnectionId: string | null;
  telnyxCredentialId: string | null;
}) {
  return {
    connectionId: settings.telnyxConnectionId || env("TELNYX_CONNECTION_ID"),
    credentialId: settings.telnyxCredentialId || env("TELNYX_CREDENTIAL_ID"),
    inboundPhoneNumber: settings.inboundPhoneNumber || env("TELNYX_INBOUND_NUMBER"),
    outboundCallerNumber: settings.outboundCallerNumber || env("TELNYX_PHONE_NUMBER"),
  };
}

export type PortalCallActivityKind = "missed" | "voicemail";

export type PortalCallActivityItem = {
  callerName: string | null;
  createdAt: Date;
  durationSec: number | null;
  fromPhone: string | null;
  id: string;
  kind: PortalCallActivityKind;
  locationName: string | null;
  recordingId: string | null;
  recordId: string;
  resolved: boolean;
};

export type PortalCallCenterLocation = {
  id: string;
  label: string;
  locationId: string | null;
  outboundNumber: string;
};

function getPortalCallCenterLocations(practice: {
  locations: Array<{
    id: string;
    isPrimary: boolean;
    name: string;
    phone: string | null;
  }>;
  phoneNumbers: Array<{
    id: string;
    isPrimary: boolean;
    label: string | null;
    locationId: string | null;
    phoneNumber: string;
  }>;
}): PortalCallCenterLocation[] {
  const locations: PortalCallCenterLocation[] = [];

  for (const location of practice.locations) {
    const phone =
      practice.phoneNumbers.find(
        (number) => number.locationId === location.id && number.isPrimary,
      ) ??
      practice.phoneNumbers.find((number) => number.locationId === location.id) ??
      null;

    locations.push({
      id: location.id,
      label: location.name,
      locationId: location.id,
      outboundNumber: phone?.phoneNumber ?? "",
    });
  }

  for (const phone of practice.phoneNumbers) {
    if (phone.locationId) {
      continue;
    }

    locations.push({
      id: `phone:${phone.id}`,
      label: phone.label || phone.phoneNumber,
      locationId: null,
      outboundNumber: phone.phoneNumber,
    });
  }

  if (!locations.length) {
    const primaryPhone =
      practice.phoneNumbers.find((phone) => phone.isPrimary) ??
      practice.phoneNumbers[0] ??
      null;

    locations.push({
      id: "practice",
      label: "Practice",
      locationId: null,
      outboundNumber: primaryPhone?.phoneNumber ?? "",
    });
  }

  return locations;
}

export async function getPortalCallCenterData(options?: { locationId?: string }) {
  const context = await getCurrentPracticeCallCenterContext();

  if (!context) {
    return null;
  }

  const { practice } = context;
  const locations = getPortalCallCenterLocations(practice);
  const selectedLocation =
    locations.find((location) => location.id === options?.locationId) ??
    locations[0] ??
    null;
  const locationFilter: { locationId?: string | null } = selectedLocation
    ? { locationId: selectedLocation.locationId }
    : {};

  const [missedCallCount, voicemailCount, missedCalls, voicemails] = await Promise.all([
    prisma.callCenterMissedCall.count({
      where: {
        calledBack: false,
        practiceId: practice.id,
        resolvedAt: null,
        ...locationFilter,
      },
    }),
    prisma.callCenterVoicemail.count({
      where: {
        practiceId: practice.id,
        resolvedAt: null,
        ...locationFilter,
      },
    }),
    prisma.callCenterMissedCall.findMany({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        calledBack: true,
        callerName: true,
        createdAt: true,
        fromPhone: true,
        id: true,
        location: {
          select: {
            name: true,
          },
        },
        resolvedAt: true,
      },
      take: 30,
      where: {
        calledBack: false,
        practiceId: practice.id,
        resolvedAt: null,
        ...locationFilter,
      },
    }),
    prisma.callCenterVoicemail.findMany({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        callerName: true,
        createdAt: true,
        durationSec: true,
        fromPhone: true,
        id: true,
        location: {
          select: {
            name: true,
          },
        },
        recordingId: true,
        resolvedAt: true,
      },
      take: 30,
      where: {
        practiceId: practice.id,
        resolvedAt: null,
        ...locationFilter,
      },
    }),
  ]);

  const activity: PortalCallActivityItem[] = [];

  for (const missed of missedCalls) {
    activity.push({
      callerName: missed.callerName,
      createdAt: missed.createdAt,
      durationSec: null,
      fromPhone: missed.fromPhone,
      id: `missed:${missed.id}`,
      kind: "missed",
      locationName: missed.location?.name ?? null,
      recordingId: null,
      recordId: missed.id,
      resolved: false,
    });
  }

  for (const voicemail of voicemails) {
    activity.push({
      callerName: voicemail.callerName,
      createdAt: voicemail.createdAt,
      durationSec: voicemail.durationSec,
      fromPhone: voicemail.fromPhone,
      id: `voicemail:${voicemail.id}`,
      kind: "voicemail",
      locationName: voicemail.location?.name ?? null,
      recordingId: voicemail.recordingId,
      recordId: voicemail.id,
      resolved: false,
    });
  }

  activity.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return {
    activity: activity.slice(0, 60),
    branding: getPracticeBranding(practice),
    locations,
    missedCalls,
    phoneNumbers: practice.phoneNumbers,
    practiceId: practice.id,
    practiceName: practice.name,
    selectedLocation,
    settings: practice.callCenterSettings,
    totals: {
      missedCalls: missedCallCount,
      voicemails: voicemailCount,
    },
    voicemails,
  };
}

async function findSettingsByPracticePhone(practicePhoneVariants: string[]) {
  if (!practicePhoneVariants.length) {
    return null;
  }

  const settings = await prisma.practiceCallCenterSettings.findFirst({
    include: {
      practice: true,
    },
    where: {
      enabled: true,
      OR: [
        {
          inboundPhoneNumber: {
            in: practicePhoneVariants,
          },
        },
        {
          outboundCallerNumber: {
            in: practicePhoneVariants,
          },
        },
      ],
    },
  });

  if (settings) {
    return settings;
  }

  const phoneMapping = await prisma.practicePhoneNumber.findFirst({
    include: {
      practice: {
        include: {
          callCenterSettings: true,
        },
      },
    },
    where: {
      phoneNumber: {
        in: practicePhoneVariants,
      },
      practice: {
        callCenterSettings: {
          enabled: true,
        },
      },
    },
  });

  if (phoneMapping?.practice.callCenterSettings) {
    return {
      ...phoneMapping.practice.callCenterSettings,
      practice: phoneMapping.practice,
    };
  }

  return null;
}

async function findSettingsByConnectionId(connectionId: string) {
  const settings = await prisma.practiceCallCenterSettings.findMany({
    include: {
      practice: true,
    },
    take: 2,
    where: {
      enabled: true,
      telnyxConnectionId: connectionId,
    },
  });

  return settings.length === 1 ? settings[0] : null;
}

async function resolveCallCenterSettingsForWebhook(payload: Record<string, unknown>) {
  const connectionId = asString(payload.connection_id);
  const practicePhoneVariants = phoneLookupVariants(getPracticeSidePhone(payload));

  if (practicePhoneVariants.length) {
    return findSettingsByPracticePhone(practicePhoneVariants);
  }

  if (connectionId) {
    return findSettingsByConnectionId(connectionId);
  }

  return null;
}

async function resolveLocationIdForPhone(practiceId: string, phone: string) {
  const variants = phoneLookupVariants(phone);

  if (!variants.length) {
    return null;
  }

  const mapping = await prisma.practicePhoneNumber.findFirst({
    select: {
      locationId: true,
    },
    where: {
      phoneNumber: {
        in: variants,
      },
      practiceId,
    },
  });

  return mapping?.locationId ?? null;
}

function getPracticeSidePhone(payload: Record<string, unknown>) {
  const direction = asString(payload.direction);
  const from = asString(payload.from);
  const to = asString(payload.to);

  if (direction === "outgoing" || direction === "outbound") {
    return from;
  }

  return to || from;
}

async function resolveAgentCallIdFromPayload(
  practiceId: string,
  payload: Record<string, unknown>,
) {
  const clientState = decodeClientState(payload.client_state);
  const agentCallId = asString(clientState?.agentCallId);
  const callId = asString(clientState?.callId);

  if (agentCallId) {
    const call = await prisma.agentCall.findFirst({
      select: { id: true },
      where: {
        id: agentCallId,
        practiceId,
      },
    });

    if (call) {
      return call.id;
    }
  }

  if (callId) {
    const call = await prisma.agentCall.findFirst({
      select: { id: true },
      where: {
        callId,
        practiceId,
      },
    });

    return call?.id ?? null;
  }

  return null;
}

function toSessionDirection(direction: string) {
  if (direction === "incoming" || direction === "inbound") {
    return CallCenterSessionDirection.INBOUND;
  }
  if (direction === "outgoing" || direction === "outbound") {
    return CallCenterSessionDirection.OUTBOUND;
  }
  return CallCenterSessionDirection.UNKNOWN;
}

async function upsertSessionFromPayload({
  eventType,
  locationId,
  payload,
  practiceId,
  status,
}: {
  eventType: string;
  locationId: string | null;
  payload: Record<string, unknown>;
  practiceId: string;
  status: CallCenterSessionStatus;
}) {
  const callControlId = asString(payload.call_control_id);
  const callSessionId = asString(payload.call_session_id);
  const now = new Date();
  const eventAt = asDate(payload.occurred_at) ?? now;
  const agentCallId = await resolveAgentCallIdFromPayload(practiceId, payload);
  const baseData = {
    agentCallId,
    callerName: asString(payload.caller_id_name) || null,
    direction: toSessionDirection(asString(payload.direction)),
    endedAt:
      status === "COMPLETED" || status === "MISSED" || status === "FAILED"
        ? eventAt
        : undefined,
    fromPhone: normalizePhone(asString(payload.from)) || null,
    locationId,
    metadata: jsonInput({
      lastEventType: eventType,
      payload,
    }),
    status,
    telnyxCallSessionId: callSessionId || null,
    toPhone: normalizePhone(asString(payload.to)) || null,
    ...(status === "ACTIVE" ? { answeredAt: eventAt } : {}),
  };

  if (callControlId) {
    return prisma.callCenterSession.upsert({
      create: {
        ...baseData,
        practiceId,
        startedAt: eventAt,
        telnyxCallControlId: callControlId,
      },
      update: baseData,
      where: {
        telnyxCallControlId: callControlId,
      },
    });
  }

  const existing = callSessionId
    ? await prisma.callCenterSession.findFirst({
        where: {
          practiceId,
          telnyxCallSessionId: callSessionId,
        },
      })
    : null;

  if (existing) {
    return prisma.callCenterSession.update({
      data: baseData,
      where: {
        id: existing.id,
      },
    });
  }

  return prisma.callCenterSession.create({
    data: {
      ...baseData,
      practiceId,
      startedAt: eventAt,
    },
  });
}

async function recordMissedCall({
  agentCallId,
  locationId,
  payload,
  practiceId,
  sessionId,
}: {
  agentCallId: string | null;
  locationId: string | null;
  payload: Record<string, unknown>;
  practiceId: string;
  sessionId: string | null;
}) {
  if (sessionId) {
    const existing = await prisma.callCenterMissedCall.findFirst({
      where: {
        sessionId,
      },
    });

    if (existing) {
      return existing;
    }
  }

  return prisma.callCenterMissedCall.create({
    data: {
      agentCallId,
      callerName: asString(payload.caller_id_name) || null,
      fromPhone: normalizePhone(asString(payload.from)) || "Unknown",
      locationId,
      practiceId,
      sessionId,
    },
  });
}

async function recordVoicemail({
  locationId,
  payload,
  practiceId,
  sessionId,
}: {
  locationId: string | null;
  payload: Record<string, unknown>;
  practiceId: string;
  sessionId: string | null;
}) {
  const recordingId =
    asString(payload.recording_id) ||
    asString(payload.call_session_id) ||
    asString(payload.call_control_id);
  const recordingUrls = isRecord(payload.recording_urls) ? payload.recording_urls : {};
  const recordingUrl =
    asString(recordingUrls.mp3) ||
    asString(recordingUrls.wav) ||
    asString(payload.recording_url);

  if (!recordingId || !recordingUrl) {
    return null;
  }

  const missedCall = sessionId
    ? await prisma.callCenterMissedCall.findFirst({
        where: {
          sessionId,
        },
      })
    : null;

  if (missedCall) {
    await prisma.callCenterMissedCall.update({
      data: {
        resolvedAt: new Date(),
      },
      where: {
        id: missedCall.id,
      },
    });
  }

  const durationMillis =
    typeof payload.recording_duration_millis === "number"
      ? payload.recording_duration_millis
      : typeof payload.recording_duration_ms === "number"
        ? payload.recording_duration_ms
        : null;
  const durationSeconds =
    typeof payload.recording_duration_sec === "number"
      ? payload.recording_duration_sec
      : isRecord(payload.duration) && typeof payload.duration.seconds === "number"
        ? payload.duration.seconds
        : typeof payload.duration === "number"
          ? payload.duration
          : null;
  const duration =
    durationSeconds ?? (durationMillis != null ? durationMillis / 1000 : 0);

  return prisma.callCenterVoicemail.upsert({
    create: {
      callerName: asString(payload.caller_id_name) || null,
      durationSec: Math.max(0, Math.round(duration)),
      fromPhone: normalizePhone(asString(payload.from)) || "Unknown",
      locationId,
      missedCallId: missedCall?.id ?? null,
      practiceId,
      recordingId,
      recordingUrl,
      sessionId,
    },
    update: {
      callerName: asString(payload.caller_id_name) || null,
      durationSec: Math.max(0, Math.round(duration)),
      fromPhone: normalizePhone(asString(payload.from)) || "Unknown",
      locationId,
      missedCallId: missedCall?.id ?? null,
      recordingUrl,
      sessionId,
    },
    where: {
      recordingId,
    },
  });
}

export async function handleTelnyxWebhookEvent(body: unknown) {
  if (!isRecord(body) || !isRecord(body.data) || !isRecord(body.data.payload)) {
    return { ignored: true };
  }

  const eventType = asString(body.data.event_type);
  const payload = body.data.payload;

  if (!eventType) {
    return { ignored: true };
  }

  const settings = await resolveCallCenterSettingsForWebhook(payload);

  if (!settings) {
    return { ignored: true, reason: "no_enabled_practice" };
  }

  const practiceId = settings.practiceId;
  const locationId = await resolveLocationIdForPhone(
    practiceId,
    getPracticeSidePhone(payload),
  );
  let session: Awaited<ReturnType<typeof upsertSessionFromPayload>> | null = null;

  switch (eventType) {
    case "call.initiated":
      session = await upsertSessionFromPayload({
        eventType,
        locationId,
        payload,
        practiceId,
        status: "RINGING",
      });
      break;

    case "call.answered":
      session = await upsertSessionFromPayload({
        eventType,
        locationId,
        payload,
        practiceId,
        status: "ACTIVE",
      });
      break;

    case "call.hangup": {
      const hangupCause = asString(payload.hangup_cause);
      const missed = MISSED_CAUSES.has(hangupCause);
      session = await upsertSessionFromPayload({
        eventType,
        locationId,
        payload,
        practiceId,
        status: missed ? "MISSED" : "COMPLETED",
      });

      if (missed) {
        await recordMissedCall({
          agentCallId: session.agentCallId,
          locationId,
          payload,
          practiceId,
          sessionId: session.id,
        });
      }
      break;
    }

    case "call.speak.ended":
      if (settings.recordingEnabled && asString(payload.call_control_id)) {
        await startTelnyxRecording(asString(payload.call_control_id));
      }
      break;

    case "call.recording.saved":
    case "calls.voicemail.completed":
      session = await upsertSessionFromPayload({
        eventType,
        locationId,
        payload,
        practiceId,
        status: "VOICEMAIL",
      });
      await recordVoicemail({
        locationId,
        payload,
        practiceId,
        sessionId: session.id,
      });
      break;

    default:
      session = await upsertSessionFromPayload({
        eventType,
        locationId,
        payload,
        practiceId,
        status: "ACTIVE",
      });
  }

  return {
    eventType,
    ignored: false,
    practiceId,
    sessionId: session?.id ?? null,
  };
}

export async function triggerTelnyxVoicemailPrompt(
  settings: {
    voicemailGreeting: string;
  },
  callControlId: string,
) {
  const response = await speakOnTelnyxCall({
    callControlId,
    payload: settings.voicemailGreeting,
  });

  if (!response.ok) {
    throw new TelnyxError("Failed to trigger Telnyx voicemail prompt", response.status);
  }
}
