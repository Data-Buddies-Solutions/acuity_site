import {
  CallCenterPresenceStatus,
  type CallCenterQueueStatus,
  type CallCenterRingAttemptStatus,
  CallCenterSessionDirection,
  type CallCenterSessionStatus,
  type Prisma,
} from "@/generated/prisma/client";

import {
  buildPortalLocationScopeWhere,
  canAccessPortalLocation,
  filterPortalLocationsForAccess,
  getCurrentPortalPracticeContext,
  type PortalPracticeAccessContext,
} from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";
import { getPracticeBranding } from "@/lib/practice-branding";
import {
  answerTelnyxCall,
  dialTelnyxCall,
  getTelnyxRecording,
  hangupTelnyxCall,
  startTelnyxPlayback,
  startTelnyxRecording,
  speakOnTelnyxCall,
  stopTelnyxPlayback,
  TelnyxError,
} from "@/lib/telnyx";

const MISSED_CAUSES = new Set([
  "call_rejected",
  "no_answer",
  "originator_cancel",
  "timeout",
  "user_busy",
]);
const PRESENCE_EXPIRATION_MS = 45_000;
const AGENT_RING_TIMEOUT_SEC = 10;
const RETRYABLE_RING_ATTEMPT_STATUSES = new Set<CallCenterRingAttemptStatus>([
  "CANCELED",
  "FAILED",
  "NO_ANSWER",
]);
const LIVE_RING_ATTEMPT_STATUSES: CallCenterRingAttemptStatus[] = [
  "DIALING",
  "RINGING",
  "ANSWERED",
  "BRIDGED",
];
const DEFAULT_QUEUE_WAIT_TIMEOUT_SEC = 10;
const MAX_QUEUE_WAIT_TIMEOUT_SEC = 120;
const RINGBACK_TONE_DURATION_SEC = 2;
const RINGBACK_CYCLE_SEC = 6;
const ABITA_PRACTICE_NAME = "Abita Eye Group";
const ABITA_SOUTH_FLORIDA_CALL_CENTER_EMAIL = "callcenter@abitaeye.com";
const ABITA_SOUTH_FLORIDA_LOCATION_NAMES = new Set(["hollywood", "sweetwater"]);
const ABITA_SOUTH_FLORIDA_QUEUE_KEY = "abita-south-florida";
const ABITA_SOUTH_FLORIDA_TRANSFER_PHONE = "+16184220360";
const ABITA_SWEETWATER_OPTICAL_EMAIL = "sweetwateropticals@abitaeye.com";
const ABITA_SWEETWATER_OPTICAL_PHONE = "+17864657479";
const ABITA_SWEETWATER_OPTICAL_QUEUE_KEY = "abita-sweetwater-optical";

const ringbackWavCache = new Map<number, string>();
const VOICEMAIL_BEEP_WAV_BASE64 = createVoicemailBeepWavBase64();

function normalizeVoicemailTimeoutSec(timeoutSec: number | null | undefined) {
  if (!Number.isFinite(timeoutSec)) {
    return DEFAULT_QUEUE_WAIT_TIMEOUT_SEC;
  }

  return Math.min(
    MAX_QUEUE_WAIT_TIMEOUT_SEC,
    Math.max(1, Math.round(timeoutSec || DEFAULT_QUEUE_WAIT_TIMEOUT_SEC)),
  );
}

function ringbackWavBase64For(timeoutSec: number | null | undefined) {
  const durationSec = normalizeVoicemailTimeoutSec(timeoutSec);
  const cached = ringbackWavCache.get(durationSec);

  if (cached) {
    return cached;
  }

  const wav = createRingbackWavBase64(durationSec);
  ringbackWavCache.set(durationSec, wav);

  return wav;
}

export function isRingbackToneActiveAtSecond(elapsedSec: number) {
  if (!Number.isFinite(elapsedSec) || elapsedSec < 0) {
    return false;
  }

  return elapsedSec % RINGBACK_CYCLE_SEC < RINGBACK_TONE_DURATION_SEC;
}

function createRingbackWavBase64(durationSec = DEFAULT_QUEUE_WAIT_TIMEOUT_SEC) {
  const sampleRate = 8000;
  const sampleCount = sampleRate * durationSec;
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRate;
    const inTone = isRingbackToneActiveAtSecond(t);
    const sample = inTone
      ? Math.round(
          (9000 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t))) /
            2,
        )
      : 0;

    buffer.writeInt16LE(sample, 44 + i * bytesPerSample);
  }

  return buffer.toString("base64");
}

function createVoicemailBeepWavBase64() {
  const sampleRate = 8000;
  const durationSec = 0.4;
  const sampleCount = Math.floor(sampleRate * durationSec);
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Single 1000Hz tone with ~10ms attack/release so it doesn't click.
  const attackSamples = Math.floor(sampleRate * 0.01);
  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRate;
    const envelope =
      i < attackSamples
        ? i / attackSamples
        : i > sampleCount - attackSamples
          ? (sampleCount - i) / attackSamples
          : 1;
    const sample = Math.round(envelope * 12000 * Math.sin(2 * Math.PI * 1000 * t));
    buffer.writeInt16LE(sample, 44 + i * bytesPerSample);
  }

  return buffer.toString("base64");
}

type CallCenterVoicemailSettings = {
  recordingEnabled: boolean;
  outboundCallerNumber?: string | null;
  telnyxConnectionId?: string | null;
  telnyxCredentialId?: string | null;
  voicemailGreeting: string;
  voicemailTimeoutSec: number;
};

type CallCenterTelnyxRuntimeSettings = {
  inboundPhoneNumber: string | null;
  outboundCallerNumber: string | null;
  telnyxConnectionId: string | null;
  telnyxCredentialId: string | null;
};

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

type AcuityLiveKitHandoff = {
  callerPhone: string;
  handoff: string;
  isCallCenterHandoff: boolean;
  liveKitCallId: string;
  trunkPhone: string;
};

const ACUITY_HANDOFF_HEADER = "x-acuity-handoff";
const ACUITY_TRUNK_PHONE_HEADER = "x-acuity-trunk-phone";
const ACUITY_CALLER_PHONE_HEADER = "x-acuity-caller-phone";
const ACUITY_LIVEKIT_CALL_ID_HEADER = "x-acuity-livekit-call-id";

function addTelnyxHeader(headers: Map<string, string>, name: unknown, value: unknown) {
  const headerName = asString(name).toLowerCase();
  const headerValue = asString(value);

  if (headerName && headerValue) {
    headers.set(headerName, headerValue);
  }
}

function collectTelnyxHeaders(value: unknown, headers: Map<string, string>) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        const separatorIndex = item.indexOf(":");
        if (separatorIndex > 0) {
          addTelnyxHeader(
            headers,
            item.slice(0, separatorIndex),
            item.slice(separatorIndex + 1),
          );
        }
        continue;
      }

      if (!isRecord(item)) {
        continue;
      }

      addTelnyxHeader(
        headers,
        asString(item.name) ||
          asString(item.key) ||
          asString(item.header) ||
          asString(item.header_name),
        asString(item.value) || asString(item.header_value),
      );
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [name, headerValue] of Object.entries(value)) {
    if (isRecord(headerValue)) {
      addTelnyxHeader(
        headers,
        asString(headerValue.name) ||
          asString(headerValue.key) ||
          asString(headerValue.header) ||
          name,
        asString(headerValue.value) || asString(headerValue.header_value),
      );
    } else {
      addTelnyxHeader(headers, name, headerValue);
    }
  }
}

export function extractAcuityLiveKitHandoff(
  payload: Record<string, unknown>,
): AcuityLiveKitHandoff {
  const headers = new Map<string, string>();
  collectTelnyxHeaders(payload.sip_headers, headers);
  collectTelnyxHeaders(payload.custom_headers, headers);

  const handoff = headers.get(ACUITY_HANDOFF_HEADER) ?? "";

  return {
    callerPhone: headers.get(ACUITY_CALLER_PHONE_HEADER) ?? "",
    handoff,
    isCallCenterHandoff: handoff.toLowerCase() === "call-center",
    liveKitCallId: headers.get(ACUITY_LIVEKIT_CALL_ID_HEADER) ?? "",
    trunkPhone: headers.get(ACUITY_TRUNK_PHONE_HEADER) ?? "",
  };
}

function asDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isUniqueConstraintError(error: unknown) {
  return isRecord(error) && error.code === "P2002";
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = asFiniteNumber(value);
    if (parsed != null) {
      return parsed;
    }
  }

  return null;
}

function secondsBetween(startValue: unknown, endValue: unknown) {
  const startedAt = asDate(startValue);
  const endedAt = asDate(endValue);

  if (!startedAt || !endedAt) {
    return null;
  }

  const seconds = (endedAt.getTime() - startedAt.getTime()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function extractTelnyxRecordingDurationSec(payload: Record<string, unknown>) {
  const directSeconds = firstFiniteNumber(
    payload.recording_duration_sec,
    payload.recording_duration_secs,
    payload.recording_duration_seconds,
    payload.duration_sec,
    payload.duration_secs,
    payload.duration_seconds,
    payload.RecordingDuration,
  );

  if (directSeconds != null) {
    return directSeconds;
  }

  const directMillis = firstFiniteNumber(
    payload.recording_duration_millis,
    payload.recording_duration_ms,
    payload.duration_millis,
    payload.duration_ms,
  );

  if (directMillis != null) {
    return directMillis / 1000;
  }

  if (isRecord(payload.duration)) {
    const nestedSeconds = firstFiniteNumber(
      payload.duration.seconds,
      payload.duration.sec,
    );

    if (nestedSeconds != null) {
      return nestedSeconds;
    }

    const nestedMillis = firstFiniteNumber(
      payload.duration.milliseconds,
      payload.duration.millis,
      payload.duration.ms,
    );

    if (nestedMillis != null) {
      return nestedMillis / 1000;
    }
  }

  const scalarDuration = asFiniteNumber(payload.duration);
  if (scalarDuration != null) {
    return scalarDuration;
  }

  return (
    secondsBetween(payload.recording_started_at, payload.recording_ended_at) ??
    secondsBetween(payload.start_time, payload.end_time) ??
    0
  );
}

export function extractTelnyxRecordingUrl(payload: Record<string, unknown>) {
  const downloadUrls = isRecord(payload.download_urls) ? payload.download_urls : {};
  const publicRecordingUrls = isRecord(payload.public_recording_urls)
    ? payload.public_recording_urls
    : {};
  const recordingUrls = isRecord(payload.recording_urls) ? payload.recording_urls : {};

  return (
    asString(downloadUrls.mp3) ||
    asString(downloadUrls.wav) ||
    asString(publicRecordingUrls.mp3) ||
    asString(publicRecordingUrls.wav) ||
    asString(recordingUrls.mp3) ||
    asString(recordingUrls.wav) ||
    asString(payload.recording_url)
  );
}

export async function fetchTelnyxRecordingMetadata(recordingId: string) {
  if (!recordingId) {
    return null;
  }

  const response = await getTelnyxRecording(recordingId);

  if (!response.ok) {
    return null;
  }

  const body: unknown = await response.json();
  const data = isRecord(body) && isRecord(body.data) ? body.data : null;

  if (!data) {
    return null;
  }

  return {
    durationSec: Math.max(0, Math.round(extractTelnyxRecordingDurationSec(data))),
    recordingUrl: extractTelnyxRecordingUrl(data),
  };
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

function encodeClientState(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function telnyxSipUri(sipUsername: string | null) {
  const username = sipUsername?.trim() ?? "";

  if (!username) {
    return "";
  }

  if (username.startsWith("sip:")) {
    return username;
  }

  return username.includes("@") ? `sip:${username}` : `sip:${username}@sip.telnyx.com`;
}

function extractTelnyxCallControlId(result: unknown) {
  if (!isRecord(result) || !isRecord(result.data)) {
    return "";
  }

  return asString(result.data.call_control_id);
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
  return getCurrentPortalPracticeContext();
}

export async function setCallCenterEnabledForCurrentPractice(enabled: boolean) {
  const context = await getCurrentPracticeCallCenterContext();

  if (!context) {
    throw new TelnyxError("Unauthorized", 401);
  }

  if (!context.hasAllLocationAccess) {
    throw new TelnyxError(
      "Only practice administrators can change call center settings",
      403,
    );
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
  locationId?: string | null;
  locationIds?: string[];
  outboundNumber: string;
};

export type PortalOutboundCallerNumber = {
  label: string;
  phoneNumber: string;
};

export type PortalCallCenterSeat = {
  extension: string | null;
  hasCredential: boolean;
  id: string;
  label: string;
  locationId: string | null;
  queueKey: string | null;
  sipUsername: string | null;
};

export type PortalCallQueueItem = {
  enteredAt: Date;
  fromPhone: string | null;
  id: string;
  locationName: string | null;
  ringAttempts: Array<{
    id: string;
    seatLabel: string;
    status: string;
  }>;
  status: string;
  toPhone: string | null;
};

export type PortalRecentCallItem = {
  answeredBy: string | null;
  fromPhone: string | null;
  id: string;
  locationName: string | null;
  occurredAt: Date;
  startedAt: Date;
  status: CallCenterSessionStatus;
};

export type AvailableCallCenterSeat = {
  extension: string | null;
  id: string;
  locationId?: string | null;
  label: string;
  queueKey?: string | null;
  sipUsername: string | null;
  telnyxCredentialId: string | null;
};

export function getPresenceExpirationCutoff(now = new Date()) {
  return new Date(now.getTime() - PRESENCE_EXPIRATION_MS);
}

function getPortalCallCenterLocations(
  practice: {
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
  },
  options: { allowFallback: boolean } = { allowFallback: true },
): PortalCallCenterLocation[] {
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

  if (!locations.length && options.allowFallback) {
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

function isAbitaSouthFloridaLocationName(name: string) {
  return ABITA_SOUTH_FLORIDA_LOCATION_NAMES.has(name.trim().toLowerCase());
}

function isAbitaPractice(practice: { name: string }) {
  return practice.name.trim().toLowerCase() === ABITA_PRACTICE_NAME.toLowerCase();
}

export function isAbitaSouthFloridaCallCenterContext(
  context: Pick<PortalPracticeAccessContext, "practice" | "session">,
) {
  return Boolean(
    context &&
    isAbitaPractice(context.practice) &&
    context.session.user.email?.trim().toLowerCase() ===
      ABITA_SOUTH_FLORIDA_CALL_CENTER_EMAIL,
  );
}

export function isAbitaSweetwaterOpticalCallCenterContext(
  context: Pick<PortalPracticeAccessContext, "practice" | "session">,
) {
  return Boolean(
    context &&
    isAbitaPractice(context.practice) &&
    context.session.user.email?.trim().toLowerCase() === ABITA_SWEETWATER_OPTICAL_EMAIL,
  );
}

export function isSpecialAbitaCallCenterContext(
  context: Pick<PortalPracticeAccessContext, "practice" | "session">,
) {
  return (
    isAbitaSouthFloridaCallCenterContext(context) ||
    isAbitaSweetwaterOpticalCallCenterContext(context)
  );
}

export function allowsSharedCallCenterStation(
  context: Pick<PortalPracticeAccessContext, "practice" | "session">,
  seat: { queueKey?: string | null },
) {
  return (
    isAbitaSweetwaterOpticalCallCenterContext(context) &&
    seat.queueKey === ABITA_SWEETWATER_OPTICAL_QUEUE_KEY
  );
}

function getAbitaSouthFloridaLocationIds(practice: {
  locations: Array<{ id: string; name: string }>;
}) {
  return practice.locations
    .filter((location) => isAbitaSouthFloridaLocationName(location.name))
    .map((location) => location.id);
}

function getAbitaSweetwaterLocationIds(practice: {
  locations: Array<{ id: string; name: string }>;
}) {
  return practice.locations
    .filter((location) => location.name.trim().toLowerCase() === "sweetwater")
    .map((location) => location.id);
}

function opticalPhoneVariants() {
  return phoneLookupVariants(ABITA_SWEETWATER_OPTICAL_PHONE);
}

function southFloridaTransferPhoneVariants() {
  return phoneLookupVariants(ABITA_SOUTH_FLORIDA_TRANSFER_PHONE);
}

function getAbitaSouthFloridaCallCenterLocation(practice: {
  locations: Array<{ id: string; name: string }>;
  phoneNumbers: Array<{
    isPrimary: boolean;
    locationId: string | null;
    phoneNumber: string;
  }>;
}): PortalCallCenterLocation | null {
  const locationIds = getAbitaSouthFloridaLocationIds(practice);

  if (!locationIds.length) {
    return null;
  }

  const hollywood = practice.locations.find(
    (location) => location.name.trim().toLowerCase() === "hollywood",
  );
  const outboundNumber =
    practice.phoneNumbers.find(
      (phone) => phone.locationId === hollywood?.id && phone.isPrimary,
    )?.phoneNumber ??
    practice.phoneNumbers.find(
      (phone) => phone.locationId && locationIds.includes(phone.locationId),
    )?.phoneNumber ??
    "";

  return {
    id: "abita-south-florida",
    label: "Hollywood / Sweetwater",
    locationIds,
    outboundNumber,
  };
}

function getAbitaSweetwaterOpticalCallCenterLocation(practice: {
  locations: Array<{ id: string; name: string }>;
}): PortalCallCenterLocation | null {
  const locationIds = getAbitaSweetwaterLocationIds(practice);

  if (!locationIds.length) {
    return null;
  }

  return {
    id: "abita-sweetwater-optical",
    label: "Sweetwater Optical",
    locationIds,
    outboundNumber: ABITA_SWEETWATER_OPTICAL_PHONE,
  };
}

function getOutboundCallerNumbers({
  fallbackNumber,
  phoneNumbers,
  selectedLocation,
  visibleLocations,
}: {
  fallbackNumber: string;
  phoneNumbers: Array<{
    isPrimary: boolean;
    label: string | null;
    locationId: string | null;
    phoneNumber: string;
  }>;
  selectedLocation: PortalCallCenterLocation | null;
  visibleLocations: Array<{ id: string; name: string }>;
}): PortalOutboundCallerNumber[] {
  if (selectedLocation?.id === "abita-sweetwater-optical") {
    return [
      {
        label: "Sweetwater Optical",
        phoneNumber: ABITA_SWEETWATER_OPTICAL_PHONE,
      },
    ];
  }

  const locationIds = selectedLocation?.locationIds?.length
    ? selectedLocation.locationIds
    : selectedLocation?.locationId
      ? [selectedLocation.locationId]
      : [];
  const locationNameById = new Map(
    visibleLocations.map((location) => [location.id, location.name]),
  );
  const sortedNumbers = locationIds.length
    ? locationIds.flatMap((locationId) => {
        const numbers = phoneNumbers.filter((phone) => phone.locationId === locationId);
        const primary = numbers.find((phone) => phone.isPrimary) ?? numbers[0] ?? null;

        return primary ? [primary] : [];
      })
    : [...phoneNumbers].sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) {
          return a.isPrimary ? -1 : 1;
        }

        return (a.label || a.phoneNumber).localeCompare(b.label || b.phoneNumber);
      });
  const seen = new Set<string>();
  const choices: PortalOutboundCallerNumber[] = [];

  for (const phone of sortedNumbers) {
    if (seen.has(phone.phoneNumber)) {
      continue;
    }

    seen.add(phone.phoneNumber);
    choices.push({
      label:
        (phone.locationId ? locationNameById.get(phone.locationId) : null) ||
        phone.label ||
        phone.phoneNumber,
      phoneNumber: phone.phoneNumber,
    });
  }

  if (!choices.length && fallbackNumber) {
    choices.push({
      label: "Practice",
      phoneNumber: fallbackNumber,
    });
  }

  return choices;
}

function getCallCenterSeatQueueKeyForContext(context: PortalPracticeAccessContext) {
  if (isAbitaSouthFloridaCallCenterContext(context)) {
    return ABITA_SOUTH_FLORIDA_QUEUE_KEY;
  }

  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return ABITA_SWEETWATER_OPTICAL_QUEUE_KEY;
  }

  return null;
}

function queueScopeForSpecialAbitaProfile(
  context: PortalPracticeAccessContext,
): Prisma.CallCenterQueueItemWhereInput | null {
  const opticalVariants = opticalPhoneVariants();

  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return {
      toPhone: {
        in: opticalVariants,
      },
    };
  }

  if (isAbitaSouthFloridaCallCenterContext(context)) {
    return {
      OR: [
        {
          toPhone: {
            in: southFloridaTransferPhoneVariants(),
          },
        },
        {
          NOT: {
            toPhone: {
              in: opticalVariants,
            },
          },
          locationId: {
            in: getAbitaSouthFloridaLocationIds(context.practice),
          },
        },
      ],
    };
  }

  return null;
}

function activityScopeForSpecialAbitaProfile(context: PortalPracticeAccessContext) {
  const opticalVariants = opticalPhoneVariants();

  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return {
      session: {
        is: {
          toPhone: {
            in: opticalVariants,
          },
        },
      },
    };
  }

  if (isAbitaSouthFloridaCallCenterContext(context)) {
    return {
      OR: [
        {
          session: {
            is: {
              toPhone: {
                in: southFloridaTransferPhoneVariants(),
              },
            },
          },
        },
        {
          NOT: {
            session: {
              is: {
                toPhone: {
                  in: opticalVariants,
                },
              },
            },
          },
          locationId: {
            in: getAbitaSouthFloridaLocationIds(context.practice),
          },
        },
      ],
    };
  }

  return null;
}

export function buildCallCenterQueueScopeWhere(
  context: PortalPracticeAccessContext,
  selectedLocation?: PortalCallCenterLocation | null,
) {
  return (
    queueScopeForSpecialAbitaProfile(context) ??
    callCenterLocationWhere(selectedLocation ?? null, context)
  );
}

export function buildCallCenterActivityScopeWhere(
  context: PortalPracticeAccessContext,
  selectedLocation?: PortalCallCenterLocation | null,
) {
  return (
    activityScopeForSpecialAbitaProfile(context) ??
    callCenterLocationWhere(selectedLocation ?? null, context)
  );
}

export function buildCallCenterSessionScopeWhere(
  context: PortalPracticeAccessContext,
  selectedLocation?: PortalCallCenterLocation | null,
) {
  const opticalVariants = opticalPhoneVariants();

  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return {
      toPhone: {
        in: opticalVariants,
      },
    };
  }

  if (isAbitaSouthFloridaCallCenterContext(context)) {
    return {
      OR: [
        {
          toPhone: {
            in: southFloridaTransferPhoneVariants(),
          },
        },
        {
          NOT: {
            toPhone: {
              in: opticalVariants,
            },
          },
          locationId: {
            in: getAbitaSouthFloridaLocationIds(context.practice),
          },
        },
      ],
    };
  }

  return callCenterLocationWhere(selectedLocation ?? null, context);
}

export function getAllowedCallCenterOutboundPhoneNumbers(
  context: PortalPracticeAccessContext,
) {
  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return [{ phoneNumber: ABITA_SWEETWATER_OPTICAL_PHONE }];
  }

  if (isAbitaSouthFloridaCallCenterContext(context)) {
    const locationIds = getAbitaSouthFloridaLocationIds(context.practice);

    return locationIds
      .flatMap((locationId) => {
        const numbers = context.allowedPhoneNumbers.filter(
          (phone) => phone.locationId === locationId,
        );
        const primary = numbers.find((phone) => phone.isPrimary) ?? numbers[0] ?? null;

        return primary ? [{ phoneNumber: primary.phoneNumber }] : [];
      })
      .filter(
        (phone) =>
          !phoneLookupVariants(phone.phoneNumber).some((variant) =>
            opticalPhoneVariants().includes(variant),
          ),
      );
  }

  return context.allowedPhoneNumbers;
}

function callCenterLocationWhere(
  selectedLocation: PortalCallCenterLocation | null,
  context: PortalPracticeAccessContext,
) {
  if (selectedLocation?.locationIds?.length) {
    return {
      locationId: {
        in: selectedLocation.locationIds,
      },
    };
  }

  if (selectedLocation && "locationId" in selectedLocation) {
    return { locationId: selectedLocation.locationId ?? null };
  }

  return buildPortalLocationScopeWhere(context);
}

export function buildCallCenterSeatAccessWhere(
  context: PortalPracticeAccessContext | null,
) {
  if (!context || context.hasAllLocationAccess) {
    return {};
  }

  if (isAbitaSouthFloridaCallCenterContext(context)) {
    return {
      queueKey: ABITA_SOUTH_FLORIDA_QUEUE_KEY,
    };
  }

  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return {
      queueKey: ABITA_SWEETWATER_OPTICAL_QUEUE_KEY,
    };
  }

  return buildPortalLocationScopeWhere(context);
}

function getDefaultPortalCallCenterLocation(locations: PortalCallCenterLocation[]) {
  return (
    locations.find((location) => /spring\s*hill/i.test(location.label)) ??
    locations[0] ??
    null
  );
}

export async function getPortalCallCenterData(options?: { locationId?: string }) {
  const context = await getCurrentPracticeCallCenterContext();

  if (!context) {
    return null;
  }

  const { practice } = context;
  const visibleLocations = filterPortalLocationsForAccess(context, practice.locations);
  const visiblePhoneNumbers = context.allowedPhoneNumbers;
  const southFloridaCombinedLocation = isAbitaSouthFloridaCallCenterContext(context)
    ? getAbitaSouthFloridaCallCenterLocation({
        locations: visibleLocations,
        phoneNumbers: visiblePhoneNumbers,
      })
    : null;
  const sweetwaterOpticalLocation = isAbitaSweetwaterOpticalCallCenterContext(context)
    ? getAbitaSweetwaterOpticalCallCenterLocation({
        locations: visibleLocations,
      })
    : null;
  const locations = southFloridaCombinedLocation
    ? [southFloridaCombinedLocation]
    : sweetwaterOpticalLocation
      ? [sweetwaterOpticalLocation]
      : getPortalCallCenterLocations(
          {
            locations: visibleLocations,
            phoneNumbers: visiblePhoneNumbers,
          },
          { allowFallback: context.hasAllLocationAccess },
        );
  const selectedLocation =
    locations.find((location) => location.id === options?.locationId) ??
    getDefaultPortalCallCenterLocation(locations);
  const queueFilter = buildCallCenterQueueScopeWhere(context, selectedLocation);
  const activityFilter = buildCallCenterActivityScopeWhere(context, selectedLocation);
  const sessionFilter = buildCallCenterSessionScopeWhere(context, selectedLocation);
  const seatQueueKey = getCallCenterSeatQueueKeyForContext(context);

  const seatWhere = selectedLocation
    ? seatQueueKey
      ? {
          practiceId: practice.id,
          queueKey: seatQueueKey,
        }
      : selectedLocation.locationIds?.length
        ? {
            locationId: null,
            practiceId: practice.id,
          }
        : {
            locationId: selectedLocation.locationId ?? null,
            practiceId: practice.id,
          }
    : {
        ...buildCallCenterSeatAccessWhere(context),
        practiceId: practice.id,
      };
  const outboundCallerNumbers = getOutboundCallerNumbers({
    fallbackNumber: selectedLocation?.outboundNumber ?? "",
    phoneNumbers: visiblePhoneNumbers,
    selectedLocation,
    visibleLocations,
  });

  const [
    missedCallCount,
    voicemailCount,
    missedCalls,
    voicemails,
    seats,
    queue,
    recentSessions,
  ] = await Promise.all([
    prisma.callCenterMissedCall.count({
      where: {
        calledBack: false,
        practiceId: practice.id,
        resolvedAt: null,
        ...activityFilter,
      },
    }),
    prisma.callCenterVoicemail.count({
      where: {
        practiceId: practice.id,
        resolvedAt: null,
        ...activityFilter,
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
        ...activityFilter,
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
        ...activityFilter,
      },
    }),
    prisma.callCenterAgentSeat.findMany({
      orderBy: [{ extension: "asc" }, { label: "asc" }],
      select: {
        extension: true,
        id: true,
        label: true,
        locationId: true,
        queueKey: true,
        sipUsername: true,
        telnyxCredentialId: true,
      },
      where: {
        ...seatWhere,
        enabled: true,
      },
    }),
    prisma.callCenterQueueItem.findMany({
      orderBy: [{ priority: "desc" }, { enteredAt: "asc" }],
      select: {
        enteredAt: true,
        fromPhone: true,
        id: true,
        location: {
          select: {
            name: true,
          },
        },
        ringAttempts: {
          orderBy: {
            startedAt: "asc",
          },
          select: {
            id: true,
            seat: {
              select: {
                label: true,
              },
            },
            status: true,
          },
        },
        status: true,
        toPhone: true,
      },
      take: 20,
      where: {
        practiceId: practice.id,
        status: {
          in: ["RINGING", "WAITING", "ASSIGNED", "ACTIVE"],
        },
        ...queueFilter,
      },
    }),
    prisma.callCenterSession.findMany({
      orderBy: [{ updatedAt: "desc" }, { startedAt: "desc" }],
      select: {
        answeredAt: true,
        endedAt: true,
        fromPhone: true,
        id: true,
        location: {
          select: {
            name: true,
          },
        },
        queueItems: {
          orderBy: {
            createdAt: "desc",
          },
          select: {
            ringAttempts: {
              orderBy: [{ answeredAt: "desc" }, { startedAt: "desc" }],
              select: {
                answeredAt: true,
                seat: {
                  select: {
                    extension: true,
                    label: true,
                  },
                },
                status: true,
              },
            },
          },
          take: 2,
        },
        startedAt: true,
        status: true,
        updatedAt: true,
      },
      take: 25,
      where: {
        answeredAt: {
          not: null,
        },
        direction: CallCenterSessionDirection.INBOUND,
        fromPhone: {
          not: null,
          notIn: ["anonymous", "anonymous@anonymous", "anonymous@anonymous.invalid"],
        },
        practiceId: practice.id,
        status: "COMPLETED",
        ...sessionFilter,
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

  const inboundEnabled = seats.length > 0 || isSpecialAbitaCallCenterContext(context);

  return {
    activity: activity.slice(0, 60),
    branding: getPracticeBranding(practice),
    hasAllLocationAccess: context.hasAllLocationAccess,
    inboundEnabled,
    locations,
    missedCalls,
    outboundCallerNumbers,
    phoneNumbers: visiblePhoneNumbers,
    practiceId: practice.id,
    practiceName: practice.name,
    queue: queue.map((item) => ({
      enteredAt: item.enteredAt,
      fromPhone: item.fromPhone,
      id: item.id,
      locationName: item.location?.name ?? null,
      ringAttempts: item.ringAttempts.map((attempt) => ({
        id: attempt.id,
        seatLabel: attempt.seat.label,
        status: attempt.status,
      })),
      status: item.status,
      toPhone: item.toPhone,
    })),
    recentCalls: recentSessions.map((session) => {
      const answeredAttempt = session.queueItems
        .flatMap((item) => item.ringAttempts)
        .find(
          (attempt) =>
            attempt.answeredAt ||
            attempt.status === "ANSWERED" ||
            attempt.status === "BRIDGED",
        );
      const seat = answeredAttempt?.seat ?? null;
      const answeredBy = seat
        ? seat.extension
          ? seat.extension + " - " + seat.label
          : seat.label
        : null;

      return {
        answeredBy,
        fromPhone: session.fromPhone,
        id: session.id,
        locationName: session.location?.name ?? null,
        occurredAt: session.endedAt ?? session.answeredAt ?? session.startedAt,
        startedAt: session.startedAt,
        status: session.status,
      };
    }),
    selectedLocation,
    seats: seats.map((seat) => ({
      extension: seat.extension,
      hasCredential: Boolean(seat.telnyxCredentialId),
      id: seat.id,
      label: seat.label,
      locationId: seat.locationId,
      queueKey: seat.queueKey,
      sipUsername: seat.sipUsername,
    })),
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

  const locationMapping = await prisma.practiceLocation.findFirst({
    include: {
      practice: {
        include: {
          callCenterSettings: true,
        },
      },
    },
    where: {
      phone: {
        in: practicePhoneVariants,
      },
      practice: {
        callCenterSettings: {
          enabled: true,
        },
      },
    },
  });

  if (locationMapping?.practice.callCenterSettings) {
    return {
      ...locationMapping.practice.callCenterSettings,
      practice: locationMapping.practice,
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
  const handoff = extractAcuityLiveKitHandoff(payload);

  // Agent dial legs carry our ringAttemptId / queueItemId in client_state.
  // Resolve the practice through that linkage — most reliable for outbound legs
  // where the SIP URI ("to") isn't a phone number we can look up.
  const clientState = decodeClientState(payload.client_state);
  const ringAttemptId = asString(clientState?.ringAttemptId);
  const queueItemId = asString(clientState?.queueItemId);

  if (ringAttemptId || queueItemId) {
    const queueItem = ringAttemptId
      ? await prisma.callCenterRingAttempt.findUnique({
          select: { queueItem: { select: { practiceId: true } } },
          where: { id: ringAttemptId },
        })
      : await prisma.callCenterQueueItem.findUnique({
          select: { practiceId: true },
          where: { id: queueItemId },
        });

    const resolvedPracticeId = ringAttemptId
      ? (queueItem as { queueItem?: { practiceId?: string } } | null)?.queueItem
          ?.practiceId
      : (queueItem as { practiceId?: string } | null)?.practiceId;

    if (resolvedPracticeId) {
      const settings = await prisma.practiceCallCenterSettings.findFirst({
        include: { practice: true },
        where: {
          enabled: true,
          practiceId: resolvedPracticeId,
        },
      });

      if (settings) {
        return settings;
      }
    }
  }

  if (handoff.isCallCenterHandoff && handoff.trunkPhone) {
    const settings = await findSettingsByPracticePhone(
      phoneLookupVariants(handoff.trunkPhone),
    );

    if (settings) {
      return settings;
    }
  }

  // Try whichever side of the call is a recognized practice phone number.
  const phoneCandidates = [
    getPracticeSidePhone(payload),
    asString(payload.to),
    asString(payload.from),
  ].filter(Boolean);

  for (const phone of phoneCandidates) {
    const variants = phoneLookupVariants(phone);
    if (!variants.length) {
      continue;
    }
    const settings = await findSettingsByPracticePhone(variants);
    if (settings) {
      return settings;
    }
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

  if (mapping?.locationId) {
    return mapping.locationId;
  }

  const location = await prisma.practiceLocation.findFirst({
    select: {
      id: true,
    },
    where: {
      phone: {
        in: variants,
      },
      practiceId,
    },
  });

  return location?.id ?? null;
}

function getPracticeSidePhone(payload: Record<string, unknown>) {
  const handoff = extractAcuityLiveKitHandoff(payload);
  if (handoff.isCallCenterHandoff && handoff.trunkPhone) {
    return handoff.trunkPhone;
  }

  const direction = asString(payload.direction);
  const from = asString(payload.from);
  const to = asString(payload.to);

  if (direction === "outgoing" || direction === "outbound") {
    return from;
  }

  return to || from;
}

function getCallerSidePhone(payload: Record<string, unknown>) {
  const handoff = extractAcuityLiveKitHandoff(payload);
  if (handoff.isCallCenterHandoff && handoff.callerPhone) {
    return handoff.callerPhone;
  }

  return asString(payload.from);
}

async function resolveAgentCallIdFromPayload(
  practiceId: string,
  payload: Record<string, unknown>,
) {
  const clientState = decodeClientState(payload.client_state);
  const handoff = extractAcuityLiveKitHandoff(payload);
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

  for (const externalCallId of [callId, handoff.liveKitCallId].filter(Boolean)) {
    const call = await prisma.agentCall.findFirst({
      select: { id: true },
      where: {
        callId: externalCallId,
        practiceId,
      },
    });

    if (call) {
      return call.id;
    }
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

export function telnyxSessionDirectionFromPayload(payload: Record<string, unknown>) {
  const handoff = extractAcuityLiveKitHandoff(payload);
  if (handoff.isCallCenterHandoff) {
    return CallCenterSessionDirection.INBOUND;
  }

  return toSessionDirection(asString(payload.direction));
}

function mergeSessionDirection({
  existingDirection,
  payloadDirection,
}: {
  existingDirection?: CallCenterSessionDirection | null;
  payloadDirection: CallCenterSessionDirection;
}) {
  if (payloadDirection !== CallCenterSessionDirection.UNKNOWN) {
    return payloadDirection;
  }

  return existingDirection ?? CallCenterSessionDirection.UNKNOWN;
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
  const handoff = extractAcuityLiveKitHandoff(payload);
  const payloadDirection = telnyxSessionDirectionFromPayload(payload);
  const existingSession = callControlId
    ? await prisma.callCenterSession.findUnique({
        select: {
          direction: true,
          fromPhone: true,
          locationId: true,
          toPhone: true,
        },
        where: {
          telnyxCallControlId: callControlId,
        },
      })
    : callSessionId
      ? await prisma.callCenterSession.findFirst({
          select: {
            direction: true,
            fromPhone: true,
            locationId: true,
            toPhone: true,
          },
          where: {
            practiceId,
            telnyxCallSessionId: callSessionId,
          },
        })
      : null;
  // Some Telnyx event payloads (notably call.recording.saved and
  // call.playback.ended) don't include from/to/direction. Don't clobber
  // the values that were already set on the original call.initiated event.
  const payloadFromPhone =
    normalizePhone(
      handoff.isCallCenterHandoff && handoff.callerPhone
        ? handoff.callerPhone
        : asString(payload.from),
    ) || null;
  const payloadToPhone =
    normalizePhone(
      handoff.isCallCenterHandoff && handoff.trunkPhone
        ? handoff.trunkPhone
        : asString(payload.to),
    ) || null;
  const baseData = {
    agentCallId,
    callerName: asString(payload.caller_id_name) || null,
    direction: mergeSessionDirection({
      existingDirection: existingSession?.direction,
      payloadDirection,
    }),
    endedAt:
      status === "COMPLETED" || status === "MISSED" || status === "FAILED"
        ? eventAt
        : undefined,
    fromPhone: payloadFromPhone ?? existingSession?.fromPhone ?? null,
    locationId: locationId ?? existingSession?.locationId ?? null,
    metadata: jsonInput({
      lastEventType: eventType,
      payload,
    }),
    status,
    telnyxCallSessionId: callSessionId || null,
    toPhone: payloadToPhone ?? existingSession?.toPhone ?? null,
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

function isInboundSession(session: { direction: CallCenterSessionDirection }) {
  return session.direction === CallCenterSessionDirection.INBOUND;
}

async function wasInboundQueueUnanswered(sessionId: string) {
  const queueItem = await prisma.callCenterQueueItem.findUnique({
    select: {
      answeredAt: true,
      status: true,
    },
    where: {
      callerSessionId: sessionId,
    },
  });

  return Boolean(
    queueItem &&
    !queueItem.answeredAt &&
    !["COMPLETED", "ABANDONED"].includes(queueItem.status),
  );
}

async function upsertQueueItemForSession({
  eventType,
  payload,
  session,
  status,
}: {
  eventType: string;
  payload: Record<string, unknown>;
  session: Awaited<ReturnType<typeof upsertSessionFromPayload>>;
  status: CallCenterQueueStatus;
}) {
  if (!isInboundSession(session)) {
    return null;
  }

  const eventAt = asDate(payload.occurred_at) ?? new Date();
  const existing = await prisma.callCenterQueueItem.findUnique({
    select: {
      status: true,
    },
    where: {
      callerSessionId: session.id,
    },
  });
  const nextStatus = existing ? mergeQueueStatus(existing.status, status) : status;
  const terminal =
    nextStatus === "COMPLETED" ||
    nextStatus === "ABANDONED" ||
    nextStatus === "VOICEMAIL";

  const data = {
    fromPhone: session.fromPhone,
    locationId: session.locationId,
    metadata: jsonInput({
      lastEventType: eventType,
      payload,
    }),
    status: nextStatus,
    toPhone: session.toPhone,
    ...(nextStatus === "ASSIGNED" ? { assignedAt: eventAt } : {}),
    ...(nextStatus === "ACTIVE" ? { answeredAt: eventAt } : {}),
    ...(nextStatus === "VOICEMAIL" ? { voicemailStartedAt: eventAt } : {}),
    ...(terminal ? { endedAt: eventAt } : {}),
  };

  return prisma.callCenterQueueItem.upsert({
    create: {
      ...data,
      practiceId: session.practiceId,
      callerSessionId: session.id,
      enteredAt: session.startedAt,
    },
    update: data,
    where: {
      callerSessionId: session.id,
    },
  });
}

function mergeQueueStatus(
  existing: CallCenterQueueStatus,
  next: CallCenterQueueStatus,
): CallCenterQueueStatus {
  if (existing === "VOICEMAIL" || existing === "COMPLETED" || existing === "ABANDONED") {
    return existing;
  }

  if (next === "VOICEMAIL" || next === "COMPLETED" || next === "ABANDONED") {
    return next;
  }

  const rank: Record<CallCenterQueueStatus, number> = {
    WAITING: 1,
    RINGING: 2,
    ASSIGNED: 3,
    ACTIVE: 4,
    VOICEMAIL: 5,
    COMPLETED: 5,
    ABANDONED: 5,
  };

  return rank[next] >= rank[existing] ? next : existing;
}

function ringAttemptHangupStatus(hangupCause: string) {
  if (["no_answer", "timeout", "user_busy"].includes(hangupCause)) {
    return "NO_ANSWER" as const;
  }

  if (["call_rejected", "originator_cancel"].includes(hangupCause)) {
    return "CANCELED" as const;
  }

  return "FAILED" as const;
}

async function updateRingAttemptFromPayload({
  payload,
  status,
}: {
  payload: Record<string, unknown>;
  status: "ANSWERED" | "BRIDGED" | "CANCELED" | "FAILED" | "NO_ANSWER" | "RINGING";
}) {
  const clientState = decodeClientState(payload.client_state);
  const ringAttemptId = asString(clientState?.ringAttemptId);
  const callControlId = asString(payload.call_control_id);
  const eventAt = asDate(payload.occurred_at) ?? new Date();

  if (!ringAttemptId && !callControlId) {
    return null;
  }

  const existing = await prisma.callCenterRingAttempt.findFirst({
    select: {
      id: true,
      queueItemId: true,
      status: true,
      telnyxCallControlId: true,
    },
    where: ringAttemptId
      ? {
          id: ringAttemptId,
        }
      : {
          telnyxCallControlId: callControlId,
        },
  });

  if (!existing) {
    return null;
  }

  const terminal = ["CANCELED", "FAILED", "NO_ANSWER"].includes(status);
  const previouslyAnswered =
    existing.status === "ANSWERED" || existing.status === "BRIDGED";

  // Terminal hangup of a connected agent leg → end of call, mark queue COMPLETED.
  if (terminal && previouslyAnswered) {
    const attempt = await prisma.callCenterRingAttempt.update({
      data: {
        endedAt: eventAt,
        hangupCause: asString(payload.hangup_cause) || null,
        status: existing.status,
        telnyxCallControlId: callControlId || undefined,
      },
      where: {
        id: existing.id,
      },
    });

    await prisma.callCenterQueueItem.update({
      data: {
        endedAt: eventAt,
        status: "COMPLETED",
      },
      where: {
        id: existing.queueItemId,
      },
    });

    return attempt;
  }

  // Don't downgrade an attempt's status (e.g., late RINGING after ANSWERED, or
  // late ANSWERED after BRIDGED). Telnyx sometimes delivers events out of order.
  let nextStatus: typeof status | typeof existing.status = status;
  if (previouslyAnswered && (status === "RINGING" || status === "ANSWERED")) {
    nextStatus = existing.status;
  }

  return prisma.callCenterRingAttempt.update({
    data: {
      status: nextStatus,
      telnyxCallControlId: callControlId || undefined,
      ...(status === "ANSWERED" || status === "BRIDGED" ? { answeredAt: eventAt } : {}),
      ...(terminal
        ? {
            endedAt: eventAt,
            hangupCause: asString(payload.hangup_cause) || null,
          }
        : {}),
    },
    where: {
      id: existing.id,
    },
  });
}

async function ringAvailableSeatsForQueueItem({
  availableSeats,
  callerCallControlId,
  connectionId,
  callerNumber,
  from,
  queueItemId,
  timeoutSecs,
}: {
  availableSeats: AvailableCallCenterSeat[];
  callerCallControlId: string;
  connectionId: string;
  callerNumber?: string | null;
  from: string;
  queueItemId: string;
  timeoutSecs?: number;
}) {
  if (!availableSeats.length || !callerCallControlId || !connectionId || !from) {
    return 0;
  }

  const results = await Promise.all(
    availableSeats.map(async (seat) => {
      let attempt: { id: string } | null = null;

      try {
        attempt = await prisma.callCenterRingAttempt.create({
          data: {
            queueItemId,
            seatId: seat.id,
            status: "DIALING",
          },
          select: {
            id: true,
          },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }

        const existingAttempt = await prisma.callCenterRingAttempt.findFirst({
          select: {
            id: true,
            status: true,
          },
          where: {
            queueItemId,
            seatId: seat.id,
          },
        });

        if (
          existingAttempt &&
          RETRYABLE_RING_ATTEMPT_STATUSES.has(existingAttempt.status)
        ) {
          await prisma.callCenterRingAttempt.delete({
            where: {
              id: existingAttempt.id,
            },
          });
          attempt = await prisma.callCenterRingAttempt.create({
            data: {
              queueItemId,
              seatId: seat.id,
              status: "DIALING",
            },
            select: {
              id: true,
            },
          });
        } else {
          console.info("[call-center] skipping active duplicate station ring", {
            queueItemId,
            seatId: seat.id,
            seatLabel: seat.label,
            status: existingAttempt?.status ?? null,
          });
          return false;
        }
      }

      if (!attempt) {
        return false;
      }

      const to = telnyxSipUri(seat.sipUsername);

      if (!to) {
        await prisma.callCenterRingAttempt.update({
          data: {
            endedAt: new Date(),
            hangupCause: "missing_sip_username",
            status: "FAILED",
          },
          where: {
            id: attempt.id,
          },
        });
        return false;
      }

      try {
        const result = await dialTelnyxCall({
          bridgeIntent: true,
          bridgeOnAnswer: true,
          clientState: encodeClientState({
            callerNumber: callerNumber || undefined,
            queueItemId,
            ringAttemptId: attempt.id,
            seatId: seat.id,
          }),
          commandId: `ring-${queueItemId}-${seat.id}`,
          connectionId,
          from,
          linkTo: callerCallControlId,
          preventDoubleBridge: true,
          timeoutSecs,
          to,
        });
        const telnyxCallControlId = extractTelnyxCallControlId(result);

        await prisma.callCenterRingAttempt.update({
          data: {
            status: "RINGING",
            telnyxCallControlId: telnyxCallControlId || undefined,
          },
          where: {
            id: attempt.id,
          },
        });
        return true;
      } catch (error) {
        const telnyxDetail =
          error instanceof TelnyxError && error.detail
            ? `${error.message}: ${error.detail}`
            : null;
        await prisma.callCenterRingAttempt.update({
          data: {
            endedAt: new Date(),
            hangupCause:
              telnyxDetail ??
              (error instanceof Error ? error.message : "failed_to_dial_station"),
            status: "FAILED",
          },
          where: {
            id: attempt.id,
          },
        });
        return false;
      }
    }),
  );

  return results.filter(Boolean).length;
}

async function restoreQueueItemAfterFailedStationTake({
  previousStatus,
  queueItemId,
}: {
  previousStatus: CallCenterQueueStatus;
  queueItemId: string;
}) {
  await prisma.callCenterQueueItem.updateMany({
    data: {
      assignedAt: null,
      status: previousStatus === "ASSIGNED" ? "WAITING" : previousStatus,
    },
    where: {
      id: queueItemId,
      ringAttempts: {
        none: {
          status: {
            in: LIVE_RING_ATTEMPT_STATUSES,
          },
        },
      },
      status: "ASSIGNED",
    },
  });
}

async function getQueueItemForStationTake({
  practiceId,
  queueItemId,
}: {
  practiceId: string;
  queueItemId: string;
}) {
  return prisma.callCenterQueueItem.findFirst({
    include: {
      callerSession: {
        select: {
          telnyxCallControlId: true,
        },
      },
    },
    where: {
      id: queueItemId,
      practiceId,
      status: {
        in: ["RINGING", "WAITING", "ASSIGNED"],
      },
    },
  });
}

export async function ringStationForQueuedCall({
  browserSessionId,
  queueItemId,
  seatId,
}: {
  browserSessionId: string;
  queueItemId: string;
  seatId: string;
}) {
  const context = await getCurrentPracticeCallCenterContext();

  if (!context) {
    throw new TelnyxError("Unauthorized", 401);
  }

  const settings = context.practice.callCenterSettings;

  if (!settings?.enabled) {
    throw new TelnyxError("Call center is not enabled for this practice", 403);
  }

  const [queueItem, seat] = await Promise.all([
    getQueueItemForStationTake({
      practiceId: context.practice.id,
      queueItemId,
    }),
    prisma.callCenterAgentSeat.findFirst({
      select: {
        extension: true,
        id: true,
        label: true,
        locationId: true,
        queueKey: true,
        sipUsername: true,
        telnyxCredentialId: true,
      },
      where: {
        enabled: true,
        id: seatId,
        ...buildCallCenterSeatAccessWhere(context),
        practiceId: context.practice.id,
      },
    }),
  ]);

  if (!queueItem) {
    throw new TelnyxError("Queued call is not available", 404);
  }

  if (
    !isSpecialAbitaCallCenterContext(context) &&
    !canAccessPortalLocation(context, queueItem.locationId)
  ) {
    throw new TelnyxError("Queued call is not available", 404);
  }

  const scopedQueueMatch = await prisma.callCenterQueueItem.count({
    where: {
      id: queueItem.id,
      practiceId: context.practice.id,
      ...buildCallCenterQueueScopeWhere(context),
    },
  });

  if (scopedQueueMatch === 0) {
    throw new TelnyxError("Queued call is not available", 404);
  }

  if (!seat) {
    throw new TelnyxError("Call center station not found", 404);
  }

  if (seat.locationId && queueItem.locationId !== seat.locationId) {
    throw new TelnyxError("Station does not belong to this queued call location", 422);
  }

  const presenceCutoff = getPresenceExpirationCutoff();
  const allowsSharedStation = allowsSharedCallCenterStation(context, seat);
  const [availablePresence, competingPresence] = await Promise.all([
    prisma.callCenterPresence.count({
      where: {
        browserSessionId,
        lastSeenAt: {
          gte: presenceCutoff,
        },
        seatId: seat.id,
        status: CallCenterPresenceStatus.AVAILABLE,
        userId: context.session.user.id,
      },
    }),
    allowsSharedStation
      ? Promise.resolve(0)
      : prisma.callCenterPresence.count({
          where: {
            browserSessionId: {
              not: browserSessionId,
            },
            lastSeenAt: {
              gte: presenceCutoff,
            },
            seatId: seat.id,
            status: {
              not: CallCenterPresenceStatus.OFFLINE,
            },
          },
        }),
  ]);

  if (competingPresence > 0) {
    throw new TelnyxError("Station is active in another browser", 409);
  }

  if (availablePresence === 0) {
    throw new TelnyxError("Station is not available", 409);
  }

  const runtimeSettings = resolveTelnyxRuntimeSettings(settings);
  const callerCallControlId = queueItem.callerSession?.telnyxCallControlId || "";
  const callerNumber = normalizePhone(queueItem.fromPhone);
  // Show the caller's number as the SIP From on the agent's leg.
  const from =
    callerNumber ||
    normalizePhone(queueItem.toPhone) ||
    normalizePhone(runtimeSettings.outboundCallerNumber);

  if (!callerCallControlId) {
    throw new TelnyxError("Queued caller leg is missing Telnyx call control ID", 422);
  }

  const previousStatus = queueItem.status;

  const claimedForStation = await prisma.callCenterQueueItem.updateMany({
    data: {
      assignedAt: new Date(),
      status: "ASSIGNED",
    },
    where: {
      endedAt: null,
      id: queueItem.id,
      status: {
        in: ["RINGING", "WAITING", "ASSIGNED"],
      },
      voicemailStartedAt: null,
    },
  });

  if (claimedForStation.count === 0) {
    throw new TelnyxError("Queued call is no longer available", 409);
  }

  let dialedAttemptCount = 0;

  try {
    dialedAttemptCount = await ringAvailableSeatsForQueueItem({
      availableSeats: [seat],
      callerCallControlId,
      callerNumber,
      connectionId: runtimeSettings.connectionId,
      from: from || "",
      queueItemId: queueItem.id,
      timeoutSecs: AGENT_RING_TIMEOUT_SEC,
    });
  } catch (error) {
    await restoreQueueItemAfterFailedStationTake({
      previousStatus,
      queueItemId: queueItem.id,
    });
    throw error;
  }

  if (dialedAttemptCount === 0) {
    await restoreQueueItemAfterFailedStationTake({
      previousStatus,
      queueItemId: queueItem.id,
    });
    throw new TelnyxError("No station leg could be dialed", 502);
  }

  return {
    ok: true,
  };
}

async function markQueueVoicemailError({
  error,
  queueItemId,
}: {
  error: unknown;
  queueItemId: string;
}) {
  await prisma.callCenterQueueItem.update({
    data: {
      metadata: jsonInput({
        voicemailError:
          error instanceof Error ? error.message : "failed_to_start_voicemail",
      }),
    },
    where: {
      id: queueItemId,
    },
  });
}

async function startCallerRingback({
  callControlId,
  queueItemId,
  timeoutSec,
}: {
  callControlId: string;
  queueItemId: string;
  timeoutSec: number;
}) {
  // Looping the generated ringback WAV once makes playback end when the
  // queue-wait window closes; call.playback.ended then routes unanswered
  // callers to voicemail.
  try {
    const response = await startTelnyxPlayback({
      callControlId,
      commandId: `ringback-${queueItemId}`,
      loop: 1,
      playbackContent: ringbackWavBase64For(timeoutSec),
    });
    console.info("[call-center] ringback started", {
      callControlId,
      ok: response?.ok ?? null,
      queueItemId,
      status: response?.status ?? null,
    });
    return response?.ok === true;
  } catch (error) {
    console.error("[call-center] ringback start failed", {
      callControlId,
      error,
      queueItemId,
    });
    return false;
  }
}

async function stopCallerRingback(callControlId: string) {
  await stopTelnyxPlayback(callControlId).catch(() => null);
}

async function queueInboundCallForStaff({
  eventType,
  payload,
  session,
  settings,
}: {
  eventType: string;
  payload: Record<string, unknown>;
  session: Awaited<ReturnType<typeof upsertSessionFromPayload>>;
  settings: CallCenterVoicemailSettings;
}) {
  if (!isInboundSession(session)) {
    return null;
  }

  const callerCallControlId =
    asString(payload.call_control_id) || session.telnyxCallControlId || "";

  if (!callerCallControlId) {
    return null;
  }

  const queueItem = await upsertQueueItemForSession({
    eventType,
    payload,
    session,
    status: "WAITING",
  });

  if (!queueItem) {
    return null;
  }

  if (queueItem.status !== "WAITING") {
    console.info("[call-center] inbound queue item already routed, skipping ring", {
      queueItemId: queueItem.id,
      status: queueItem.status,
    });
    return queueItem;
  }

  const answerResponse = await answerTelnyxCall(callerCallControlId).catch((error) => {
    console.error("[call-center] Failed to answer inbound caller leg", {
      callControlId: callerCallControlId,
      error,
      queueItemId: queueItem.id,
    });
    return null;
  });

  if (!answerResponse || !answerResponse.ok) {
    console.error("[call-center] Failed to answer inbound caller leg", {
      callControlId: callerCallControlId,
      queueItemId: queueItem.id,
      status: answerResponse?.status ?? null,
    });
    await startQueueVoicemail({
      queueItemId: queueItem.id,
      settings,
    });
    return queueItem;
  }

  const ringbackStarted = await startCallerRingback({
    callControlId: callerCallControlId,
    queueItemId: queueItem.id,
    timeoutSec: settings.voicemailTimeoutSec,
  });

  if (!ringbackStarted) {
    await startQueueVoicemail({
      queueItemId: queueItem.id,
      settings,
    });
    return queueItem;
  }

  console.info("[call-center] queued inbound caller for manual staff take", {
    queueItemId: queueItem.id,
  });

  return queueItem;
}

async function onAgentBridgeWon({
  queueItemId,
  winnerAttemptId,
}: {
  queueItemId: string;
  winnerAttemptId: string;
}) {
  const eventAt = new Date();

  await prisma.callCenterQueueItem.updateMany({
    data: {
      answeredAt: eventAt,
      assignedAt: eventAt,
      status: "ACTIVE",
    },
    where: {
      id: queueItemId,
      status: {
        in: ["RINGING", "WAITING", "ASSIGNED"],
      },
    },
  });

  const losing = await prisma.callCenterRingAttempt.findMany({
    select: {
      id: true,
      telnyxCallControlId: true,
    },
    where: {
      id: {
        not: winnerAttemptId,
      },
      queueItemId,
      status: {
        in: ["DIALING", "RINGING", "ANSWERED"],
      },
    },
  });

  if (losing.length) {
    await prisma.callCenterRingAttempt.updateMany({
      data: {
        endedAt: eventAt,
        hangupCause: "answered_elsewhere",
        status: "CANCELED",
      },
      where: {
        id: {
          in: losing.map((attempt) => attempt.id),
        },
      },
    });

    await Promise.all(
      losing
        .map((attempt) => attempt.telnyxCallControlId)
        .filter((cc): cc is string => Boolean(cc))
        .map((cc) =>
          hangupTelnyxCall(cc).catch((hangupError) => {
            console.error(
              "[call-center] Failed to hang up losing agent leg",
              cc,
              hangupError,
            );
            return null;
          }),
        ),
    );
  }

  const queueItem = await prisma.callCenterQueueItem.findUnique({
    select: {
      callerSession: {
        select: {
          telnyxCallControlId: true,
        },
      },
    },
    where: {
      id: queueItemId,
    },
  });

  const callerCallControlId = queueItem?.callerSession?.telnyxCallControlId;

  if (callerCallControlId) {
    await stopCallerRingback(callerCallControlId);
  }
}

async function cancelPendingRingAttempts({
  cause,
  eventAt,
  queueItemId,
}: {
  cause: string;
  eventAt: Date;
  queueItemId: string;
}) {
  const pending = await prisma.callCenterRingAttempt.findMany({
    select: {
      id: true,
      telnyxCallControlId: true,
    },
    where: {
      queueItemId,
      status: {
        in: ["DIALING", "RINGING"],
      },
    },
  });

  if (!pending.length) {
    return;
  }

  await prisma.callCenterRingAttempt.updateMany({
    data: {
      endedAt: eventAt,
      hangupCause: cause,
      status: "CANCELED",
    },
    where: {
      id: {
        in: pending.map((attempt) => attempt.id),
      },
    },
  });

  await Promise.all(
    pending
      .map((attempt) => attempt.telnyxCallControlId)
      .filter((cc): cc is string => Boolean(cc))
      .map((cc) =>
        hangupTelnyxCall(cc).catch((hangupError) => {
          console.error(
            "[call-center] Failed to hang up pending ring attempt leg",
            cc,
            hangupError,
          );
          return null;
        }),
      ),
  );
}

async function startQueueVoicemail({
  queueItemId,
  settings,
}: {
  queueItemId: string;
  settings: CallCenterVoicemailSettings;
}) {
  const queueItem = await prisma.callCenterQueueItem.findUnique({
    include: {
      callerSession: {
        select: {
          agentCallId: true,
          callerName: true,
          fromPhone: true,
          telnyxCallControlId: true,
        },
      },
      ringAttempts: {
        select: {
          id: true,
          status: true,
          telnyxCallControlId: true,
        },
      },
    },
    where: {
      id: queueItemId,
    },
  });

  if (!queueItem) {
    return null;
  }

  const callerCallControlId = queueItem.callerSession?.telnyxCallControlId;

  if (!callerCallControlId) {
    return null;
  }

  const claimed = await prisma.callCenterQueueItem.updateMany({
    data: {
      status: "VOICEMAIL",
      voicemailStartedAt: new Date(),
    },
    where: {
      answeredAt: null,
      endedAt: null,
      id: queueItemId,
      ringAttempts: {
        none: {
          status: {
            in: LIVE_RING_ATTEMPT_STATUSES,
          },
        },
      },
      status: {
        in: ["WAITING", "RINGING", "ASSIGNED"],
      },
      voicemailStartedAt: null,
    },
  });

  if (claimed.count === 0) {
    return null;
  }

  const missedCall = await recordMissedCall({
    agentCallId: queueItem.callerSession?.agentCallId ?? null,
    locationId: queueItem.locationId,
    payload: {
      caller_id_name: queueItem.callerSession?.callerName ?? "",
      from: queueItem.callerSession?.fromPhone ?? queueItem.fromPhone ?? "",
    },
    practiceId: queueItem.practiceId,
    sessionId: queueItem.callerSessionId,
  });

  const liveAttempts = queueItem.ringAttempts.filter((attempt) =>
    ["DIALING", "RINGING", "ANSWERED", "BRIDGED"].includes(attempt.status),
  );

  if (liveAttempts.length) {
    await prisma.callCenterRingAttempt.updateMany({
      data: {
        endedAt: new Date(),
        hangupCause: "voicemail_started",
        status: "CANCELED",
      },
      where: {
        id: {
          in: liveAttempts.map((attempt) => attempt.id),
        },
      },
    });

    await Promise.all(
      liveAttempts
        .map((attempt) => attempt.telnyxCallControlId)
        .filter((cc): cc is string => Boolean(cc))
        .map((cc) =>
          hangupTelnyxCall(cc).catch((hangupError) => {
            console.error(
              "[call-center] Failed to hang up agent leg before voicemail",
              cc,
              hangupError,
            );
            return null;
          }),
        ),
    );
  }

  try {
    await answerTelnyxCall(callerCallControlId).catch(() => null);
    await stopCallerRingback(callerCallControlId);
    await triggerTelnyxVoicemailPrompt(settings, callerCallControlId);
    console.info("[call-center] caller routed to voicemail", {
      missedCallId: missedCall.id,
      queueItemId,
    });
  } catch (error) {
    await markQueueVoicemailError({
      error,
      queueItemId,
    });
  }

  return queueItemId;
}

async function routeUnansweredQueueItemToVoicemail({
  queueItemId,
  settings,
}: {
  queueItemId: string;
  settings: CallCenterVoicemailSettings;
}) {
  // When an agent ring attempt finishes without being answered, check whether
  // the queue item is still waiting on someone. If there are no other live
  // attempts and it hasn't been answered/abandoned yet, hand the caller leg
  // off to voicemail. Otherwise leave it alone (a parallel ring may still be
  // alive, or the caller already moved on).
  const queueItem = await prisma.callCenterQueueItem.findUnique({
    select: {
      id: true,
      ringAttempts: {
        select: {
          status: true,
        },
      },
      status: true,
    },
    where: {
      id: queueItemId,
    },
  });

  if (!queueItem || !["WAITING", "RINGING", "ASSIGNED"].includes(queueItem.status)) {
    return;
  }

  const hasLiveAttempt = queueItem.ringAttempts.some((attempt) =>
    ["DIALING", "RINGING", "ANSWERED", "BRIDGED"].includes(attempt.status),
  );

  if (hasLiveAttempt) {
    return;
  }

  await startQueueVoicemail({ queueItemId, settings });
}

async function releaseQueueItemAfterNoAnswer({ queueItemId }: { queueItemId: string }) {
  const queueItem = await prisma.callCenterQueueItem.findUnique({
    select: {
      id: true,
      ringAttempts: {
        select: {
          status: true,
        },
      },
      status: true,
    },
    where: {
      id: queueItemId,
    },
  });

  if (!queueItem || !["WAITING", "RINGING", "ASSIGNED"].includes(queueItem.status)) {
    return;
  }

  const hasLiveAttempt = queueItem.ringAttempts.some((attempt) =>
    ["DIALING", "RINGING", "ANSWERED", "BRIDGED"].includes(attempt.status),
  );

  if (hasLiveAttempt || queueItem.ringAttempts.length === 0) {
    return;
  }

  await prisma.callCenterQueueItem.updateMany({
    data: {
      assignedAt: null,
      status: "WAITING",
    },
    where: {
      id: queueItemId,
      status: {
        in: ["RINGING", "ASSIGNED"],
      },
    },
  });
}

export async function getPortalCallCenterOperationalState(options?: {
  locationId?: string | null;
}) {
  const context = await getCurrentPracticeCallCenterContext();

  if (!context) {
    return null;
  }

  const { practice } = context;
  const useExplicitLocationScope =
    options && "locationId" in options && !isSpecialAbitaCallCenterContext(context);
  if (useExplicitLocationScope && !canAccessPortalLocation(context, options.locationId)) {
    return null;
  }

  const locationFilter = useExplicitLocationScope
    ? { locationId: options.locationId }
    : buildPortalLocationScopeWhere(context);
  const queueFilter = useExplicitLocationScope
    ? { locationId: options.locationId }
    : buildCallCenterQueueScopeWhere(context);
  const sessionFilter = useExplicitLocationScope
    ? { locationId: options.locationId }
    : buildCallCenterSessionScopeWhere(context);

  const [seats, queueItems, sessions] = await Promise.all([
    prisma.callCenterAgentSeat.findMany({
      orderBy: [{ locationId: "asc" }, { extension: "asc" }, { label: "asc" }],
      select: {
        enabled: true,
        extension: true,
        id: true,
        label: true,
        location: {
          select: {
            name: true,
          },
        },
        locationId: true,
        queueKey: true,
        presence: {
          orderBy: {
            lastSeenAt: "desc",
          },
          select: {
            browserSessionId: true,
            currentSessionId: true,
            lastSeenAt: true,
            status: true,
            user: {
              select: {
                email: true,
                name: true,
              },
            },
          },
          take: 5,
        },
        sipUsername: true,
        telnyxCredentialId: true,
        updatedAt: true,
      },
      where: {
        practiceId: practice.id,
        ...(useExplicitLocationScope
          ? locationFilter
          : buildCallCenterSeatAccessWhere(context)),
      },
    }),
    prisma.callCenterQueueItem.findMany({
      orderBy: [{ enteredAt: "desc" }],
      select: {
        answeredAt: true,
        endedAt: true,
        enteredAt: true,
        fromPhone: true,
        id: true,
        location: {
          select: {
            name: true,
          },
        },
        locationId: true,
        ringAttempts: {
          orderBy: {
            startedAt: "asc",
          },
          select: {
            answeredAt: true,
            endedAt: true,
            hangupCause: true,
            id: true,
            seat: {
              select: {
                extension: true,
                label: true,
              },
            },
            startedAt: true,
            status: true,
            telnyxCallControlId: true,
          },
        },
        status: true,
        toPhone: true,
        updatedAt: true,
        voicemailStartedAt: true,
      },
      take: 25,
      where: {
        practiceId: practice.id,
        ...queueFilter,
      },
    }),
    prisma.callCenterSession.findMany({
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        direction: true,
        endedAt: true,
        fromPhone: true,
        id: true,
        location: {
          select: {
            name: true,
          },
        },
        startedAt: true,
        status: true,
        telnyxCallControlId: true,
        telnyxCallSessionId: true,
        toPhone: true,
        updatedAt: true,
      },
      take: 25,
      where: {
        practiceId: practice.id,
        ...sessionFilter,
      },
    }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    locationId: options?.locationId ?? null,
    practiceId: practice.id,
    practiceName: practice.name,
    queueItems: queueItems.map((item) => ({
      ...item,
      ringAttempts: item.ringAttempts.map((attempt) => ({
        ...attempt,
        telnyxCallControlId: attempt.telnyxCallControlId ? "present" : null,
      })),
    })),
    seats: seats.map((seat) => ({
      ...seat,
      hasCredential: Boolean(seat.telnyxCredentialId),
      telnyxCredentialId: seat.telnyxCredentialId ? "present" : null,
    })),
    sessions: sessions.map((session) => ({
      ...session,
      telnyxCallControlId: session.telnyxCallControlId ? "present" : null,
    })),
  };
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

  const fromPhone = normalizePhone(getCallerSidePhone(payload)) || "Unknown";
  const recentDuplicate = await prisma.callCenterMissedCall.findFirst({
    orderBy: {
      createdAt: "desc",
    },
    where: {
      calledBack: false,
      createdAt: {
        gte: new Date(Date.now() - 90_000),
      },
      fromPhone,
      locationId,
      practiceId,
      resolvedAt: null,
    },
  });

  if (recentDuplicate) {
    return recentDuplicate;
  }

  return prisma.callCenterMissedCall.create({
    data: {
      agentCallId,
      callerName: asString(payload.caller_id_name) || null,
      fromPhone,
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
  let recordingUrl = extractTelnyxRecordingUrl(payload);
  let duration = extractTelnyxRecordingDurationSec(payload);

  if (recordingId && (!recordingUrl || duration <= 0)) {
    const recordingMetadata = await fetchTelnyxRecordingMetadata(recordingId);
    recordingUrl = recordingUrl || recordingMetadata?.recordingUrl || "";
    duration = duration > 0 ? duration : (recordingMetadata?.durationSec ?? duration);
  }

  if (!recordingId || !recordingUrl) {
    return null;
  }

  const [missedCall, sourceSession] = await Promise.all([
    sessionId
      ? prisma.callCenterMissedCall.findFirst({
          where: { sessionId },
        })
      : Promise.resolve(null),
    sessionId
      ? prisma.callCenterSession.findUnique({
          select: {
            fromPhone: true,
            locationId: true,
          },
          where: { id: sessionId },
        })
      : Promise.resolve(null),
  ]);

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

  // The recording.saved payload often lacks `from`; fall back to the source
  // session's fromPhone (and locationId) so voicemails are attributable to
  // a specific caller and location.
  const fromPhone =
    normalizePhone(getCallerSidePhone(payload)) || sourceSession?.fromPhone || "Unknown";
  const resolvedLocationId = locationId ?? sourceSession?.locationId ?? null;

  return prisma.callCenterVoicemail.upsert({
    create: {
      callerName: asString(payload.caller_id_name) || null,
      durationSec: Math.max(0, Math.round(duration)),
      fromPhone,
      locationId: resolvedLocationId,
      missedCallId: missedCall?.id ?? null,
      practiceId,
      recordingId,
      recordingUrl,
      sessionId,
    },
    update: {
      callerName: asString(payload.caller_id_name) || null,
      durationSec: Math.max(0, Math.round(duration)),
      fromPhone,
      locationId: resolvedLocationId,
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

  console.info("[call-center] webhook event", {
    eventType,
    callControlId: asString(payload.call_control_id),
    direction: asString(payload.direction),
    reason: asString(payload.reason) || undefined,
  });

  if (!settings) {
    console.warn("[call-center] webhook ignored — no enabled practice", { eventType });
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
      if (isInboundSession(session) && asString(payload.call_control_id)) {
        await queueInboundCallForStaff({
          eventType,
          payload,
          session,
          settings,
        });
      }
      await updateRingAttemptFromPayload({
        payload,
        status: "RINGING",
      });
      break;

    case "call.answered": {
      session = await upsertSessionFromPayload({
        eventType,
        locationId,
        payload,
        practiceId,
        status: "ACTIVE",
      });
      const ringAttempt = await updateRingAttemptFromPayload({
        payload,
        status: "ANSWERED",
      });

      if (ringAttempt) {
        console.info("[call-center] agent leg answered, waiting for auto-bridge", {
          queueItemId: ringAttempt.queueItemId,
          ringAttemptId: ringAttempt.id,
        });
      }
      break;
    }

    case "call.enqueued":
      session = await upsertSessionFromPayload({
        eventType,
        locationId,
        payload,
        practiceId,
        status: "ACTIVE",
      });
      console.info("[call-center] ignored Telnyx native queue event in Call Control V1", {
        eventType,
      });
      break;

    case "call.dequeued":
    case "call.left_queue":
      session = await upsertSessionFromPayload({
        eventType,
        locationId,
        payload,
        practiceId,
        status: "ACTIVE",
      });
      console.info("[call-center] ignored Telnyx native queue event in manual V1", {
        eventType,
      });
      break;

    case "call.hangup": {
      const hangupCause = asString(payload.hangup_cause);
      const ringAttempt = await updateRingAttemptFromPayload({
        payload,
        status: ringAttemptHangupStatus(hangupCause),
      });
      const preliminarySession = await upsertSessionFromPayload({
        eventType,
        locationId,
        payload,
        practiceId,
        status: "COMPLETED",
      });
      const missed =
        isInboundSession(preliminarySession) &&
        (MISSED_CAUSES.has(hangupCause) ||
          (await wasInboundQueueUnanswered(preliminarySession.id)));

      session = missed
        ? await upsertSessionFromPayload({
            eventType,
            locationId,
            payload,
            practiceId,
            status: "MISSED",
          })
        : preliminarySession;

      if (missed && isInboundSession(session)) {
        await recordMissedCall({
          agentCallId: session.agentCallId,
          locationId,
          payload,
          practiceId,
          sessionId: session.id,
        });
      }
      const queueItem = await upsertQueueItemForSession({
        eventType,
        payload,
        session,
        status: missed ? "ABANDONED" : "COMPLETED",
      });
      if (queueItem && isInboundSession(session)) {
        await cancelPendingRingAttempts({
          cause: hangupCause || "caller_hangup",
          eventAt: asDate(payload.occurred_at) ?? new Date(),
          queueItemId: queueItem.id,
        });
      }
      if (ringAttempt) {
        await routeUnansweredQueueItemToVoicemail({
          queueItemId: ringAttempt.queueItemId,
          settings,
        });
      }
      break;
    }

    case "call.playback.ended": {
      // The queued-caller ringback playback ends naturally after the practice's
      // voicemail timeout (loop: 1). When that happens we route the call to
      // voicemail. If the playback ended because an agent
      // bridged, the routing helper sees the queue item is no longer
      // pending and skips voicemail.
      //
      // Prefer matching on commandId (`ringback-<queueItemId>`); fall back to
      // resolving the queue item by the caller leg's call_control_id, since
      // some Telnyx event variants drop command_id from the payload.
      const commandId = asString(payload.command_id);
      const callControlId = asString(payload.call_control_id);

      let queueItemId = commandId.startsWith("ringback-")
        ? commandId.slice("ringback-".length)
        : "";

      if (!queueItemId && callControlId) {
        const item = await prisma.callCenterQueueItem.findFirst({
          select: { id: true },
          where: {
            callerSession: {
              telnyxCallControlId: callControlId,
            },
            status: { in: ["WAITING", "RINGING", "ASSIGNED"] },
          },
        });
        queueItemId = item?.id ?? "";
      }

      console.info("[call-center] playback ended", {
        callControlId,
        commandId,
        playbackStatus: asString(payload.status),
        resolvedQueueItemId: queueItemId || null,
      });

      if (queueItemId) {
        await routeUnansweredQueueItemToVoicemail({
          queueItemId,
          settings,
        });
      }
      break;
    }

    case "call.speak.ended": {
      // After the voicemail greeting finishes:
      //   1. Fire the short beep playback (fire-and-forget — we don't wait
      //      for call.playback.ended).
      //   2. Wait long enough for the beep to play out (~beep duration).
      //   3. Start recording. The brief gap means the beep itself is mostly
      //      not captured in the recording, so the caller can speak naturally.
      const callControlId = asString(payload.call_control_id);
      if (settings.recordingEnabled && callControlId) {
        startTelnyxPlayback({
          callControlId,
          commandId: `voicemail-beep-${callControlId}`,
          loop: 1,
          playbackContent: VOICEMAIL_BEEP_WAV_BASE64,
        }).catch((error) => {
          console.warn("[call-center] voicemail beep failed (continuing)", {
            callControlId,
            error,
          });
        });

        // Beep is ~0.4s; wait a touch longer so it lands on the caller's line
        // before we start recording.
        await new Promise((resolve) => setTimeout(resolve, 500));

        await startTelnyxRecording(callControlId).catch((error) => {
          console.error("[call-center] failed to start voicemail recording", {
            callControlId,
            error,
          });
        });
      }
      break;
    }

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
      await upsertQueueItemForSession({
        eventType,
        payload,
        session,
        status: "VOICEMAIL",
      });
      break;

    case "call.bridged": {
      session = await upsertSessionFromPayload({
        eventType,
        locationId,
        payload,
        practiceId,
        status: "ACTIVE",
      });
      const bridgedAttempt = await updateRingAttemptFromPayload({
        payload,
        status: "BRIDGED",
      });
      if (bridgedAttempt) {
        await onAgentBridgeWon({
          queueItemId: bridgedAttempt.queueItemId,
          winnerAttemptId: bridgedAttempt.id,
        });
      }
      break;
    }

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
