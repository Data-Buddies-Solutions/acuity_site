import {
  CallCenterNoteDisposition,
  CallCenterPresenceStatus,
  Prisma,
  type CallCenterQueueStatus,
  type CallCenterRingAttemptStatus,
  CallCenterSessionDirection,
  type CallCenterSessionStatus,
} from "@/generated/prisma/client";

import {
  buildPortalLocationScopeWhere,
  canAccessPortalLocation,
  filterPortalLocationsForAccess,
  getCurrentPortalPracticeContext,
  type PortalPracticeAccessContext,
} from "@/lib/portal-access";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { getPracticeBranding } from "@/lib/practice-branding";
import {
  allowsSharedCallCenterStation,
  buildCallCenterActivityScopeForProfile,
  buildCallCenterNoteScopeForProfile,
  buildCallCenterPatientSessionScopeForProfile,
  buildCallCenterQueueScopeForProfile,
  buildCallCenterSeatAccessWhereForProfile,
  buildCallCenterSessionScopeForProfile,
  getAllowedCallCenterOutboundPhoneNumbersForProfile,
  getCallCenterProfileLocations,
  getCallCenterProfileOutboundCallerNumbers,
  getCallCenterSeatQueueKeyForProfile,
  isAbitaSouthFloridaCallCenterContext,
  isAbitaSweetwaterOpticalCallCenterContext,
  isSpecialAbitaCallCenterContext,
} from "@/lib/call-center-profiles";
import { isLegacyPresenceReadyForCalls } from "@/lib/call-center/legacy-presence";
import { getAllowedSmsPracticeNumberIdsForContext } from "@/lib/sms/service";
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
const TERMINAL_SESSION_STATUSES = new Set<CallCenterSessionStatus>([
  "COMPLETED",
  "FAILED",
  "MISSED",
  "VOICEMAIL",
]);
const PRESENCE_EXPIRATION_MS = 45_000;
const AGENT_RING_TIMEOUT_SEC = 20;
const CALL_SETUP_COMMAND_TIMEOUT_MS = 5_000;
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
const CONNECTED_RING_ATTEMPT_STATUSES: CallCenterRingAttemptStatus[] = [
  "ANSWERED",
  "BRIDGED",
];
const TERMINAL_RING_ATTEMPT_STATUSES = new Set<CallCenterRingAttemptStatus>([
  "CANCELED",
  "FAILED",
  "NO_ANSWER",
]);
const RING_ATTEMPT_STATUS_RANK: Record<CallCenterRingAttemptStatus, number> = {
  DIALING: 1,
  RINGING: 2,
  ANSWERED: 3,
  BRIDGED: 4,
  CANCELED: 5,
  NO_ANSWER: 5,
  FAILED: 5,
};

export function nextRingAttemptGeneration(
  existing: {
    generation: number;
    hangupCause: string | null;
    status: CallCenterRingAttemptStatus;
  } | null,
) {
  if (!existing) {
    return 1;
  }

  if (existing.status === "CANCELED" || existing.status === "NO_ANSWER") {
    return existing.generation + 1;
  }

  if (existing.status !== "FAILED") {
    return null;
  }

  return isDefinitiveRingAttemptFailureCode(existing.hangupCause)
    ? existing.generation + 1
    : null;
}

export function isDefinitiveRingAttemptFailureCode(errorCode: string | null) {
  if (errorCode === "missing_sip_username") {
    return true;
  }

  const httpStatus = /^(?:telnyx_dial|telnyx_transfer)_http_(\d{3})$/.exec(
    errorCode ?? "",
  )?.[1];
  const status = httpStatus ? Number(httpStatus) : 0;

  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function ringAttemptCommandId(
  attemptId: string,
  purpose: "ring" | "transfer-ring" = "ring",
) {
  return `${purpose}-${attemptId}`;
}
const DEFAULT_QUEUE_WAIT_TIMEOUT_SEC = 30;
const MAX_QUEUE_WAIT_TIMEOUT_SEC = 120;
const RINGBACK_TONE_DURATION_SEC = 2;
const RINGBACK_CYCLE_SEC = 6;
const ringbackWavCache = new Map<number, string>();
const VOICEMAIL_BEEP_WAV_BASE64 = createVoicemailBeepWavBase64();

export {
  allowsSharedCallCenterStation,
  isAbitaSouthFloridaCallCenterContext,
  isAbitaSweetwaterOpticalCallCenterContext,
  isSpecialAbitaCallCenterContext,
} from "@/lib/call-center-profiles";

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
  inboundPhoneNumber: string | null;
  recordingEnabled: boolean;
  outboundCallerNumber: string | null;
  telnyxConnectionId: string | null;
  telnyxCredentialId: string | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function categoricalError(error: unknown) {
  return {
    errorCode: error instanceof TelnyxError ? error.status : undefined,
    errorName: error instanceof Error ? error.name : "UnknownError",
  };
}

export function buildTelnyxWebhookLogContext(
  eventType: string,
  payload: Record<string, unknown>,
) {
  return {
    direction: asString(payload.direction) || undefined,
    eventType,
    hangupCause: asString(payload.hangup_cause) || undefined,
    hasClientState: Boolean(asString(payload.client_state)),
  };
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
    throw new TelnyxError("Telnyx recording metadata is unavailable", response.status);
  }

  const body: unknown = await response.json();
  const data = isRecord(body) && isRecord(body.data) ? body.data : null;

  if (!data) {
    throw new TelnyxError("Telnyx recording metadata is invalid", 502);
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

function isCallCenterAgentLegClientState(clientState: Record<string, unknown> | null) {
  return Boolean(
    clientState &&
    (clientState.internalSeatLeg === true ||
      asString(clientState.queueItemId) ||
      asString(clientState.ringAttemptId) ||
      asString(clientState.seatId)),
  );
}

function encodeClientState(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function callControlIdVariants(callControlId: string) {
  const trimmed = callControlId.trim();

  if (!trimmed) {
    return [];
  }

  const variants = new Set([trimmed]);

  if (trimmed.startsWith("v3:")) {
    variants.add(trimmed.slice(3));
  } else {
    variants.add(`v3:${trimmed}`);
  }

  return [...variants];
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

function objectMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function projectionMetadata(
  value: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const metadata = objectMetadata(value);
  delete metadata.payload;
  return { ...metadata, ...patch };
}

function pendingBlindTransfer(value: unknown) {
  const metadata = isRecord(value) ? value : {};
  const transfer = metadata.blindTransferPending;

  return isRecord(transfer) ? transfer : null;
}

function winningRingAttemptId(value: unknown) {
  return asString(isRecord(value) ? value.winningRingAttemptId : null);
}

function metadataWithWinningRingAttempt(value: unknown, ringAttemptId: string) {
  return {
    ...objectMetadata(value),
    winningRingAttemptId: ringAttemptId,
  };
}

function metadataWithoutPendingBlindTransfer(
  value: unknown,
  details?: { endedAt: Date; reason: string },
) {
  const metadata = objectMetadata(value);

  delete metadata.blindTransferPending;

  if (details) {
    metadata.blindTransferLastEndedAt = details.endedAt.toISOString();
    metadata.blindTransferLastEndReason = details.reason;
  }

  return metadata;
}

export function metadataWithPendingBlindTransferSourceEnded(
  value: unknown,
  details: { endedAt: Date; reason: string },
) {
  const metadata = objectMetadata(value);
  const transfer = pendingBlindTransfer(metadata);

  if (!transfer) {
    return metadata;
  }

  metadata.blindTransferPending = {
    ...transfer,
    sourceEndedAt: details.endedAt.toISOString(),
    sourceEndReason: details.reason,
  };

  return metadata;
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

export type PortalCallActivityKind = "missed" | "note" | "voicemail";

export type PortalCallActivityItem = {
  callerName: string | null;
  createdAt: Date;
  disposition: CallCenterNoteDisposition | null;
  durationSec: number | null;
  fromPhone: string | null;
  id: string;
  kind: PortalCallActivityKind;
  locationName: string | null;
  recordingId: string | null;
  recordId: string;
  resolved: boolean;
};

export type PortalNeedsActionGroup = {
  callerName: string | null;
  eventCount: number;
  fromPhone: string | null;
  id: string;
  lastActivityAt: Date;
  latestKind: PortalCallActivityKind;
  latestVoicemailDurationSec: number | null;
  latestVoicemailRecordingId: string | null;
  locationNames: string[];
  noteCount: number;
  callbackNeededCount: number;
  followUpRequiredCount: number;
  missedCount: number;
  voicemailCount: number;
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
  presenceLastSeenAt: Date | null;
  presenceStatus: CallCenterPresenceStatus;
  presenceUserLabel: string | null;
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
  transferRequest: {
    fromSeatLabel: string | null;
    targetSeatId: string;
  } | null;
};

export type PortalRecentCallItem = {
  answeredBy: string | null;
  direction: CallCenterSessionDirection;
  durationSec: number | null;
  fromPhone: string | null;
  id: string;
  locationName: string | null;
  occurredAt: Date;
  startedAt: Date;
  status: CallCenterSessionStatus;
  toPhone: string | null;
};

export type PortalCallCenterHistoryTotals = {
  inboundCalls: number;
  outboundDialedCalls: number;
  outboundCalls: number;
  totalCalls: number;
};

export type PortalCallCenterHistoryRange = "24h" | "7d" | "all";

export type PortalCallerTimelineItem = {
  body: string | null;
  connectedLaterAt?: Date | null;
  direction: "inbound" | "outbound" | null;
  durationSec: number | null;
  id: string;
  kind: "call" | "missed" | "note" | "text" | "voicemail";
  locationName: string | null;
  note: string | null;
  occurredAt: Date;
  phone: string | null;
  recordId: string | null;
  recordingId: string | null;
  stationLabel: string | null;
  status: string | null;
  title: string;
};

export type PortalCallerTimeline = {
  branding: ReturnType<typeof getPracticeBranding>;
  callerName: string | null;
  items: PortalCallerTimelineItem[];
  latestItem: PortalCallerTimelineItem | null;
  latestNeedsActionItem: PortalCallerTimelineItem | null;
  page: number;
  pageSize: number;
  phone: string;
  practiceName: string;
  range: PortalCallCenterHistoryRange;
  totalPages: number;
  totals: {
    inboundItems: number;
    outboundConnectedCalls: number;
    outboundDialedCalls: number;
    totalItems: number;
  };
};

export type PortalCallCenterTotals = {
  activeCalls: number;
  availableStations: number;
  busyStations: number;
  historyCalls: number;
  missedCallers: number;
  missedCalls: number;
  needsActionCallers: number;
  needsActionEvents: number;
  pausedStations: number;
  voicemailCallers: number;
  voicemails: number;
  waitingCalls: number;
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

export function isInboundSeatEligibleForAutomaticRing({
  profileCanAccessQueue,
  profileQueueKey,
  queueLocationId,
  seatLocationId,
  seatQueueKey,
}: {
  profileCanAccessQueue: boolean;
  profileQueueKey: string | null;
  queueLocationId: string | null;
  seatLocationId: string | null;
  seatQueueKey: string | null;
}) {
  if (profileQueueKey) {
    return (
      profileCanAccessQueue &&
      profileQueueKey === seatQueueKey &&
      (!seatLocationId || seatLocationId === queueLocationId)
    );
  }

  if (seatQueueKey) {
    return false;
  }

  return Boolean(queueLocationId && seatLocationId === queueLocationId);
}

export function mergeRingAttemptStatus(
  existing: CallCenterRingAttemptStatus,
  next: CallCenterRingAttemptStatus,
) {
  if (existing === "BRIDGED" || TERMINAL_RING_ATTEMPT_STATUSES.has(existing)) {
    return existing;
  }

  if (next === "BRIDGED" || TERMINAL_RING_ATTEMPT_STATUSES.has(next)) {
    return next;
  }

  return RING_ATTEMPT_STATUS_RANK[next] >= RING_ATTEMPT_STATUS_RANK[existing]
    ? next
    : existing;
}

export function canClaimQueueForVoicemail(
  attemptStatuses: CallCenterRingAttemptStatus[],
) {
  return !attemptStatuses.some((status) =>
    CONNECTED_RING_ATTEMPT_STATUSES.includes(status),
  );
}

export function telnyxDialFailureCode(error: unknown) {
  return error instanceof TelnyxError
    ? `telnyx_dial_http_${error.status}`
    : "telnyx_dial_failed";
}

export function voicemailFailureCode(error: unknown) {
  return error instanceof TelnyxError
    ? `telnyx_voicemail_http_${error.status}`
    : "failed_to_start_voicemail";
}

export function transferFailureCode(error: unknown) {
  return error instanceof TelnyxError
    ? `telnyx_transfer_http_${error.status}`
    : "failed_to_transfer_call";
}

export function getPresenceExpirationCutoff(now = new Date()) {
  return new Date(now.getTime() - PRESENCE_EXPIRATION_MS);
}

export function canUseClientStateLocationForPresence({
  locationId,
  membershipLocationIds,
  membershipLocationScope,
  seatLocationId,
}: {
  locationId: string;
  membershipLocationIds: string[];
  membershipLocationScope: "ALL" | "SELECTED" | string | null | undefined;
  seatLocationId?: string | null;
}) {
  if (!locationId || !membershipLocationScope) {
    return false;
  }

  if (
    membershipLocationScope === "SELECTED" &&
    !membershipLocationIds.includes(locationId)
  ) {
    return false;
  }

  if (membershipLocationScope !== "ALL" && membershipLocationScope !== "SELECTED") {
    return false;
  }

  return seatLocationId ? seatLocationId === locationId : true;
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
  const profileNumbers = getCallCenterProfileOutboundCallerNumbers(selectedLocation);

  if (profileNumbers) {
    return profileNumbers;
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

export function buildCallCenterQueueScopeWhere(
  context: PortalPracticeAccessContext,
  selectedLocation?: PortalCallCenterLocation | null,
) {
  return (
    buildCallCenterQueueScopeForProfile(context, selectedLocation) ??
    callCenterLocationWhere(selectedLocation ?? null, context)
  );
}

export function buildCallCenterActivityScopeWhere(
  context: PortalPracticeAccessContext,
  selectedLocation?: PortalCallCenterLocation | null,
) {
  return (
    buildCallCenterActivityScopeForProfile(context, selectedLocation) ??
    callCenterLocationWhere(selectedLocation ?? null, context)
  );
}

export function buildCallCenterNoteScopeWhere(
  context: PortalPracticeAccessContext,
  selectedLocation?: PortalCallCenterLocation | null,
): Prisma.CallCenterNoteWhereInput {
  return (
    buildCallCenterNoteScopeForProfile(context, selectedLocation) ??
    buildCallCenterActivityScopeWhere(context, selectedLocation)
  );
}

export function buildCallCenterSessionScopeWhere(
  context: PortalPracticeAccessContext,
  selectedLocation?: PortalCallCenterLocation | null,
) {
  return (
    buildCallCenterSessionScopeForProfile(context, selectedLocation) ??
    callCenterLocationWhere(selectedLocation ?? null, context)
  );
}

export function buildCallCenterPatientSessionScopeWhere(
  context: PortalPracticeAccessContext,
  selectedLocation?: PortalCallCenterLocation | null,
): Prisma.CallCenterSessionWhereInput {
  return (
    buildCallCenterPatientSessionScopeForProfile(context, selectedLocation) ??
    buildCallCenterSessionScopeWhere(context, selectedLocation)
  );
}

export function getAllowedCallCenterOutboundPhoneNumbers(
  context: PortalPracticeAccessContext,
) {
  return (
    getAllowedCallCenterOutboundPhoneNumbersForProfile(context) ??
    context.allowedPhoneNumbers
  );
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

  return (
    buildCallCenterSeatAccessWhereForProfile(context) ??
    buildPortalLocationScopeWhere(context)
  );
}

function getDefaultPortalCallCenterLocation(locations: PortalCallCenterLocation[]) {
  return (
    locations.find((location) => /spring\s*hill/i.test(location.label)) ??
    locations[0] ??
    null
  );
}

export function getPortalCallCenterLocationState(
  context: PortalPracticeAccessContext,
  options?: { locationId?: string },
) {
  const { practice } = context;
  const visibleLocations = filterPortalLocationsForAccess(context, practice.locations);
  const visiblePhoneNumbers = context.allowedPhoneNumbers;
  const profileLocations = getCallCenterProfileLocations({
    context,
    visibleLocations,
    visiblePhoneNumbers,
  });
  const locations =
    profileLocations ??
    getPortalCallCenterLocations(
      {
        locations: visibleLocations,
        phoneNumbers: visiblePhoneNumbers,
      },
      { allowFallback: context.hasAllLocationAccess },
    );
  const selectedLocation =
    locations.find((location) => location.id === options?.locationId) ??
    getDefaultPortalCallCenterLocation(locations);

  return {
    locations,
    selectedLocation,
    visibleLocations,
    visiblePhoneNumbers,
  };
}

export function buildPortalHistorySessionWhere({
  practiceId,
  sessionFilter,
}: {
  practiceId: string;
  sessionFilter: Prisma.CallCenterSessionWhereInput;
}): Prisma.CallCenterSessionWhereInput {
  return {
    AND: [
      sessionFilter,
      buildPortalPatientSessionWhere(),
      portalConnectedCallSignalWhere(),
      {
        OR: [
          {
            direction: CallCenterSessionDirection.INBOUND,
            fromPhone: {
              not: null,
              notIn: ["anonymous", "anonymous@anonymous", "anonymous@anonymous.invalid"],
            },
          },
          {
            direction: CallCenterSessionDirection.OUTBOUND,
            toPhone: {
              not: null,
              notIn: ["anonymous", "anonymous@anonymous", "anonymous@anonymous.invalid"],
            },
          },
        ],
      },
    ],
    practiceId,
    status: "COMPLETED",
  };
}

function buildPortalOutboundDialedSessionWhere({
  practiceId,
  sessionFilter,
}: {
  practiceId: string;
  sessionFilter: Prisma.CallCenterSessionWhereInput;
}): Prisma.CallCenterSessionWhereInput {
  return {
    AND: [
      sessionFilter,
      buildPortalPatientSessionWhere(),
      {
        direction: CallCenterSessionDirection.OUTBOUND,
        toPhone: {
          not: null,
          notIn: ["anonymous", "anonymous@anonymous", "anonymous@anonymous.invalid"],
        },
      },
    ],
    practiceId,
  };
}

export function buildPortalPatientSessionWhere(): Prisma.CallCenterSessionWhereInput {
  return {
    NOT: {
      toPhone: {
        mode: "insensitive",
        startsWith: "sip:",
      },
    },
  };
}

function applyPortalCallHistoryRange(
  where: Prisma.CallCenterSessionWhereInput,
  range: PortalCallCenterHistoryRange,
) {
  const rangeCutoff = callCenterHistoryRangeCutoff(range);

  if (!rangeCutoff) {
    return where;
  }

  return {
    AND: [
      where,
      {
        OR: [
          {
            startedAt: {
              gte: rangeCutoff,
            },
          },
          {
            answeredAt: {
              gte: rangeCutoff,
            },
          },
          {
            endedAt: {
              gte: rangeCutoff,
            },
          },
        ],
      },
    ],
  } satisfies Prisma.CallCenterSessionWhereInput;
}

function applyCreatedAtRange<T>(where: T, range: PortalCallCenterHistoryRange) {
  const rangeCutoff = callCenterHistoryRangeCutoff(range);

  if (!rangeCutoff) {
    return where;
  }

  return {
    AND: [
      where,
      {
        createdAt: {
          gte: rangeCutoff,
        },
      },
    ],
  };
}

type PortalRecentCallSession = {
  answeredAt: Date | null;
  direction: CallCenterSessionDirection;
  endedAt: Date | null;
  fromPhone: string | null;
  id: string;
  location: { name: string } | null;
  metadata: unknown;
  queueItems: Array<{
    ringAttempts: Array<{
      answeredAt: Date | null;
      seat: {
        extension: string | null;
        label: string;
      } | null;
      status: string;
    }>;
  }>;
  startedAt: Date;
  status: CallCenterSessionStatus;
  toPhone: string | null;
};

type PortalAnswerSignalSession = {
  answeredAt: Date | null;
  direction: CallCenterSessionDirection;
  queueItems?: Array<{
    answeredAt?: Date | null;
    ringAttempts: Array<{
      answeredAt: Date | null;
      status: CallCenterRingAttemptStatus | string;
    }>;
  }>;
};

const portalRecentCallSessionSelect = {
  answeredAt: true,
  direction: true,
  endedAt: true,
  fromPhone: true,
  id: true,
  location: {
    select: {
      name: true,
    },
  },
  metadata: true,
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
  toPhone: true,
} satisfies Prisma.CallCenterSessionSelect;

function callDurationSec({
  answeredAt,
  endedAt,
  startedAt,
}: {
  answeredAt: Date | null;
  endedAt: Date | null;
  startedAt: Date;
}) {
  if (!endedAt) {
    return null;
  }

  const start = answeredAt ?? startedAt;
  const durationMs = endedAt.getTime() - start.getTime();

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }

  return Math.round(durationMs / 1000);
}

function portalRecentCallFromSession(
  session: PortalRecentCallSession,
): PortalRecentCallItem {
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
    : stationLabelFromSessionMetadata(session.metadata);

  return {
    answeredBy,
    direction: session.direction,
    durationSec: callDurationSec(session),
    fromPhone: session.fromPhone,
    id: session.id,
    locationName: session.location?.name ?? null,
    occurredAt: session.endedAt ?? session.answeredAt ?? session.startedAt,
    startedAt: session.startedAt,
    status: session.status,
    toPhone: session.toPhone,
  };
}

export function hasPortalConnectedCallSignal(session: PortalAnswerSignalSession) {
  if (session.direction === CallCenterSessionDirection.OUTBOUND && session.answeredAt) {
    return true;
  }

  return Boolean(
    session.queueItems?.some(
      (item) =>
        item.answeredAt ||
        item.ringAttempts.some(
          (attempt) =>
            attempt.answeredAt ||
            attempt.status === "ANSWERED" ||
            attempt.status === "BRIDGED",
        ),
    ),
  );
}

function portalConnectedCallSignalWhere(): Prisma.CallCenterSessionWhereInput {
  return {
    OR: [
      {
        answeredAt: {
          not: null,
        },
        direction: CallCenterSessionDirection.OUTBOUND,
      },
      {
        queueItems: {
          some: {
            OR: [
              {
                answeredAt: {
                  not: null,
                },
              },
              {
                ringAttempts: {
                  some: {
                    OR: [
                      {
                        answeredAt: {
                          not: null,
                        },
                      },
                      {
                        status: {
                          in: ["ANSWERED", "BRIDGED"],
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    ],
  };
}

async function findPortalCallHistorySessions({
  skip = 0,
  take,
  where,
}: {
  skip?: number;
  take?: number;
  where: Prisma.CallCenterSessionWhereInput;
}) {
  const [total, page] = await Promise.all([
    prisma.callCenterSession.count({ where }),
    prisma.callCenterSession.findMany({
      orderBy: [{ updatedAt: "desc" }, { startedAt: "desc" }],
      select: portalRecentCallSessionSelect,
      skip,
      take,
      where,
    }),
  ]);

  return {
    page,
    total,
  };
}

type NeedsActionConnectedCall = {
  direction: CallCenterSessionDirection | string | null;
  fromPhone: string | null;
  occurredAt: Date;
  toPhone: string | null;
};

function needsActionPhoneKey(phone: string | null | undefined) {
  return normalizePhone(phone) || phone?.trim() || "Unknown";
}

function connectedCallPatientPhone(call: NeedsActionConnectedCall) {
  if (call.direction === CallCenterSessionDirection.OUTBOUND) {
    return call.toPhone || call.fromPhone;
  }

  return call.fromPhone || call.toPhone;
}

function latestConnectedCallByPhone(calls: NeedsActionConnectedCall[]) {
  const latestByPhone = new Map<string, Date>();

  for (const call of calls) {
    const phone = connectedCallPatientPhone(call);

    if (!phone) {
      continue;
    }

    const key = needsActionPhoneKey(phone);
    const existing = latestByPhone.get(key);

    if (!existing || call.occurredAt > existing) {
      latestByPhone.set(key, call.occurredAt);
    }
  }

  return latestByPhone;
}

export function buildPortalNeedsActionGroups(
  events: PortalCallActivityItem[],
  connectedCalls: NeedsActionConnectedCall[] = [],
) {
  const latestConnectedAt = latestConnectedCallByPhone(connectedCalls);
  const groups = new Map<string, PortalNeedsActionGroup>();

  for (const event of events) {
    const phoneKey = needsActionPhoneKey(event.fromPhone);
    const connectedAt = latestConnectedAt.get(phoneKey);

    if (event.kind !== "note" && connectedAt && connectedAt > event.createdAt) {
      continue;
    }

    const existing = groups.get(phoneKey);
    const isLatest = !existing || event.createdAt > existing.lastActivityAt;
    const next: PortalNeedsActionGroup = existing ?? {
      callbackNeededCount: 0,
      callerName: event.callerName,
      eventCount: 0,
      followUpRequiredCount: 0,
      fromPhone: event.fromPhone,
      id: `needs-action:${phoneKey}`,
      lastActivityAt: event.createdAt,
      latestKind: event.kind,
      latestVoicemailDurationSec: null,
      latestVoicemailRecordingId: null,
      locationNames: [],
      missedCount: 0,
      noteCount: 0,
      voicemailCount: 0,
    };

    next.eventCount += 1;
    next.missedCount += event.kind === "missed" ? 1 : 0;
    next.noteCount += event.kind === "note" ? 1 : 0;
    next.callbackNeededCount +=
      event.disposition === CallCenterNoteDisposition.CALLBACK_NEEDED ? 1 : 0;
    next.followUpRequiredCount +=
      event.disposition === CallCenterNoteDisposition.FOLLOW_UP_REQUIRED ? 1 : 0;
    next.voicemailCount += event.kind === "voicemail" ? 1 : 0;

    if (event.locationName && !next.locationNames.includes(event.locationName)) {
      next.locationNames.push(event.locationName);
    }

    if (!next.callerName && event.callerName) {
      next.callerName = event.callerName;
    }

    if (!next.fromPhone && event.fromPhone) {
      next.fromPhone = event.fromPhone;
    }

    if (event.kind === "voicemail" && (!next.latestVoicemailRecordingId || isLatest)) {
      next.latestVoicemailDurationSec = event.durationSec;
      next.latestVoicemailRecordingId = event.recordingId;
    }

    if (isLatest) {
      next.lastActivityAt = event.createdAt;
      next.latestKind = event.kind;
    }

    groups.set(phoneKey, next);
  }

  return Array.from(groups.values()).sort(
    (a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime(),
  );
}

function needsActionGroupToTimelineItem(
  group: PortalNeedsActionGroup,
): PortalCallerTimelineItem {
  const isVoicemail = group.latestKind === "voicemail";
  const isMissed = group.latestKind === "missed";
  const noteDisposition =
    group.followUpRequiredCount > 0
      ? CallCenterNoteDisposition.FOLLOW_UP_REQUIRED
      : CallCenterNoteDisposition.CALLBACK_NEEDED;
  const status = group.latestKind === "note" ? noteDisposition : "NEEDS_ACTION";

  return {
    body: null,
    direction: isMissed || isVoicemail ? "inbound" : null,
    durationSec: isVoicemail ? group.latestVoicemailDurationSec : null,
    id: group.id,
    kind: group.latestKind,
    locationName: group.locationNames[0] ?? null,
    note: formatNeedsActionSummary(group) || "Needs response",
    occurredAt: group.lastActivityAt,
    phone: group.fromPhone,
    recordId: null,
    recordingId: isVoicemail ? group.latestVoicemailRecordingId : null,
    stationLabel: null,
    status,
    title: isVoicemail
      ? "Voicemail"
      : isMissed
        ? "Missed call"
        : dispositionLabel(noteDisposition),
  };
}

function formatNeedsActionSummary(group: PortalNeedsActionGroup) {
  const parts: string[] = [];

  if (group.voicemailCount) {
    parts.push(
      `${group.voicemailCount} voicemail${group.voicemailCount === 1 ? "" : "s"}`,
    );
  }

  if (group.missedCount) {
    parts.push(`${group.missedCount} missed call${group.missedCount === 1 ? "" : "s"}`);
  }

  if (group.callbackNeededCount) {
    parts.push(
      `${group.callbackNeededCount} callback${group.callbackNeededCount === 1 ? "" : "s"} needed`,
    );
  }

  if (group.followUpRequiredCount) {
    parts.push(
      `${group.followUpRequiredCount} follow-up${group.followUpRequiredCount === 1 ? "" : "s"} required`,
    );
  }

  return parts.join(" · ");
}

export async function getPortalCallCenterData(options?: {
  locationId?: string;
  needsActionPage?: number;
  needsActionPageSize?: number;
}) {
  const context = await getCurrentPracticeCallCenterContext();

  if (!context) {
    return null;
  }

  const { practice } = context;
  const { locations, selectedLocation, visibleLocations, visiblePhoneNumbers } =
    getPortalCallCenterLocationState(context, options);
  const queueFilter = buildCallCenterQueueScopeWhere(context, selectedLocation);
  const activityFilter = buildCallCenterActivityScopeWhere(context, selectedLocation);
  const noteFilter = buildCallCenterNoteScopeWhere(context, selectedLocation);
  const sessionFilter = buildCallCenterPatientSessionScopeWhere(
    context,
    selectedLocation,
  );
  const seatQueueKey = getCallCenterSeatQueueKeyForProfile(context);
  const presenceCutoff = getPresenceExpirationCutoff();
  const historySessionWhere = buildPortalHistorySessionWhere({
    practiceId: practice.id,
    sessionFilter,
  });
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
  const needsActionPage = Math.max(1, Math.round(options?.needsActionPage ?? 1));
  const needsActionPageSize = options?.needsActionPageSize
    ? Math.min(100, Math.max(1, Math.round(options.needsActionPageSize)))
    : null;

  const [missedCalls, voicemails, unresolvedNotes, seats, queue, recentHistory] =
    await Promise.all([
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
          sessionId: true,
        },
        where: {
          calledBack: false,
          practiceId: practice.id,
          resolvedAt: null,
          voicemails: {
            none: {},
          },
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
          missedCallId: true,
          recordingId: true,
          resolvedAt: true,
          sessionId: true,
        },
        where: {
          practiceId: practice.id,
          resolvedAt: null,
          ...activityFilter,
        },
      }),
      prisma.callCenterNote.findMany({
        orderBy: {
          createdAt: "desc",
        },
        select: {
          createdAt: true,
          disposition: true,
          fromPhone: true,
          id: true,
          location: {
            select: {
              name: true,
            },
          },
        },
        where: {
          disposition: {
            in: [
              CallCenterNoteDisposition.CALLBACK_NEEDED,
              CallCenterNoteDisposition.FOLLOW_UP_REQUIRED,
            ],
          },
          practiceId: practice.id,
          resolvedThread: false,
          ...noteFilter,
        },
      }),
      prisma.callCenterAgentSeat.findMany({
        orderBy: [{ extension: "asc" }, { label: "asc" }],
        select: {
          extension: true,
          id: true,
          label: true,
          locationId: true,
          presence: {
            orderBy: {
              lastSeenAt: "desc",
            },
            select: {
              lastSeenAt: true,
              readyForCalls: true,
              status: true,
              user: {
                select: {
                  email: true,
                  name: true,
                },
              },
            },
            where: {
              lastSeenAt: {
                gte: presenceCutoff,
              },
              status: {
                not: CallCenterPresenceStatus.OFFLINE,
              },
            },
          },
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
          metadata: true,
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
      findPortalCallHistorySessions({
        take: 50,
        where: historySessionWhere,
      }),
    ]);

  const activity: PortalCallActivityItem[] = [];

  for (const missed of missedCalls) {
    activity.push({
      callerName: missed.callerName,
      createdAt: missed.createdAt,
      disposition: null,
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
      disposition: null,
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

  for (const note of unresolvedNotes) {
    activity.push({
      callerName: null,
      createdAt: note.createdAt,
      disposition: note.disposition,
      durationSec: null,
      fromPhone: note.fromPhone,
      id: `note:${note.id}`,
      kind: "note",
      locationName: note.location?.name ?? null,
      recordingId: null,
      recordId: note.id,
      resolved: false,
    });
  }

  activity.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const activityPhoneVariants = Array.from(
    new Set(activity.flatMap((item) => phoneLookupVariants(item.fromPhone ?? ""))),
  );
  const connectedSessionsForActivity = activityPhoneVariants.length
    ? await prisma.callCenterSession.findMany({
        select: {
          answeredAt: true,
          direction: true,
          endedAt: true,
          fromPhone: true,
          metadata: true,
          queueItems: {
            select: {
              answeredAt: true,
              ringAttempts: {
                select: {
                  answeredAt: true,
                  status: true,
                },
              },
            },
          },
          startedAt: true,
          toPhone: true,
        },
        where: {
          AND: [
            historySessionWhere,
            {
              OR: [
                {
                  fromPhone: {
                    in: activityPhoneVariants,
                  },
                },
                {
                  toPhone: {
                    in: activityPhoneVariants,
                  },
                },
              ],
            },
          ],
        },
      })
    : [];
  const needsAction = buildPortalNeedsActionGroups(
    activity,
    filterPortalPatientCallSessions(connectedSessionsForActivity)
      .filter(hasPortalConnectedCallSignal)
      .map((session) => ({
        direction: session.direction,
        fromPhone: session.fromPhone,
        occurredAt: session.endedAt ?? session.answeredAt ?? session.startedAt,
        toPhone: session.toPhone,
      })),
  );
  const needsActionTotal = needsAction.length;
  const pagedNeedsAction = needsActionPageSize
    ? needsAction.slice(
        (needsActionPage - 1) * needsActionPageSize,
        needsActionPage * needsActionPageSize,
      )
    : needsAction;
  const missedCallCount = needsAction.reduce(
    (total, group) => total + group.missedCount,
    0,
  );
  const voicemailCount = needsAction.reduce(
    (total, group) => total + group.voicemailCount,
    0,
  );
  const noteCount = needsAction.reduce((total, group) => total + group.noteCount, 0);
  const missedCallerCount = needsAction.filter((group) => group.missedCount > 0).length;
  const voicemailCallerCount = needsAction.filter(
    (group) => group.voicemailCount > 0,
  ).length;

  const inboundEnabled = seats.length > 0 || isSpecialAbitaCallCenterContext(context);
  const stationTotals = countStationPresence(seats);

  return {
    branding: getPracticeBranding(practice),
    hasAllLocationAccess: context.hasAllLocationAccess,
    inboundEnabled,
    locations,
    missedCalls,
    needsAction: pagedNeedsAction,
    needsActionTotal,
    outboundCallerNumbers,
    phoneNumbers: visiblePhoneNumbers,
    practiceId: practice.id,
    practiceName: practice.name,
    queue: queue.map((item) => {
      const transfer = pendingBlindTransfer(item.metadata);
      const targetSeatId = asString(transfer?.targetSeatId);

      return {
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
        transferRequest: targetSeatId
          ? {
              fromSeatLabel: asString(transfer?.fromSeatLabel) || null,
              targetSeatId,
            }
          : null,
      };
    }),
    recentCalls: recentHistory.page.map(portalRecentCallFromSession),
    selectedLocation,
    seats: seats.map((seat) => {
      const primaryPresence = primaryPresenceForSeat(seat.presence);

      return {
        extension: seat.extension,
        hasCredential: Boolean(seat.telnyxCredentialId),
        id: seat.id,
        label: seat.label,
        locationId: seat.locationId,
        presenceLastSeenAt: primaryPresence?.lastSeenAt ?? null,
        presenceStatus: primaryPresence?.status ?? CallCenterPresenceStatus.OFFLINE,
        presenceUserLabel:
          primaryPresence?.user?.name || primaryPresence?.user?.email || null,
        queueKey: seat.queueKey,
        sipUsername: seat.sipUsername,
      };
    }),
    settings: practice.callCenterSettings,
    totals: {
      activeCalls: queue.filter((item) => item.status === "ACTIVE").length,
      availableStations: stationTotals.available,
      busyStations: stationTotals.busy,
      historyCalls: recentHistory.total,
      missedCallers: missedCallerCount,
      missedCalls: missedCallCount,
      needsActionCallers: needsAction.length,
      needsActionEvents: missedCallCount + voicemailCount + noteCount,
      pausedStations: stationTotals.paused,
      voicemailCallers: voicemailCallerCount,
      voicemails: voicemailCount,
      waitingCalls: queue.filter((item) =>
        ["RINGING", "WAITING", "ASSIGNED"].includes(item.status),
      ).length,
    },
    voicemails,
  };
}

export async function getPortalCallCenterHistoryData(options?: {
  page?: number;
  pageSize?: number;
  range?: PortalCallCenterHistoryRange;
}) {
  const context = await getCurrentPracticeCallCenterContext();

  if (!context) {
    return null;
  }

  const page = Math.max(1, Math.round(options?.page ?? 1));
  const pageSize = Math.min(100, Math.max(25, Math.round(options?.pageSize ?? 100)));
  const range = options?.range ?? "24h";
  const { practice } = context;
  const sessionFilter = buildCallCenterPatientSessionScopeWhere(context, null);
  const baseHistorySessionWhere = buildPortalHistorySessionWhere({
    practiceId: practice.id,
    sessionFilter,
  });
  const historySessionWhere = applyPortalCallHistoryRange(baseHistorySessionWhere, range);
  const outboundDialedSessionWhere = applyPortalCallHistoryRange(
    buildPortalOutboundDialedSessionWhere({
      practiceId: practice.id,
      sessionFilter,
    }),
    range,
  );

  const [history, inboundCalls, outboundCalls, outboundDialedCalls] = await Promise.all([
    findPortalCallHistorySessions({
      skip: (page - 1) * pageSize,
      take: pageSize,
      where: historySessionWhere,
    }),
    prisma.callCenterSession.count({
      where: {
        AND: [historySessionWhere, { direction: CallCenterSessionDirection.INBOUND }],
      },
    }),
    prisma.callCenterSession.count({
      where: {
        AND: [historySessionWhere, { direction: CallCenterSessionDirection.OUTBOUND }],
      },
    }),
    prisma.callCenterSession.count({
      where: outboundDialedSessionWhere,
    }),
  ]);

  return {
    branding: getPracticeBranding(practice),
    calls: history.page.map(portalRecentCallFromSession),
    page,
    pageSize,
    practiceName: practice.name,
    range,
    totals: {
      inboundCalls,
      outboundDialedCalls,
      outboundCalls,
      totalCalls: history.total,
    } satisfies PortalCallCenterHistoryTotals,
  };
}

function callCenterHistoryRangeCutoff(range: PortalCallCenterHistoryRange) {
  const now = Date.now();

  if (range === "24h") {
    return new Date(now - 24 * 60 * 60 * 1000);
  }

  if (range === "7d") {
    return new Date(now - 7 * 24 * 60 * 60 * 1000);
  }

  return null;
}

function primaryPresenceForSeat<
  T extends {
    lastSeenAt: Date;
    readyForCalls: boolean;
    status: CallCenterPresenceStatus;
  },
>(presence: T[]) {
  return (
    presence.find((item) => item.status === CallCenterPresenceStatus.BUSY) ??
    presence.find(isLegacyPresenceReadyForCalls) ??
    presence.find((item) => item.status === CallCenterPresenceStatus.PAUSED) ??
    null
  );
}

function countStationPresence(
  seats: Array<{
    presence: Array<{
      readyForCalls: boolean;
      status: CallCenterPresenceStatus;
    }>;
  }>,
) {
  return seats.reduce(
    (totals, seat) => {
      if (
        seat.presence.some(
          (presence) => presence.status === CallCenterPresenceStatus.BUSY,
        )
      ) {
        totals.busy += 1;
      } else if (seat.presence.some(isLegacyPresenceReadyForCalls)) {
        totals.available += 1;
      } else if (
        seat.presence.some(
          (presence) => presence.status === CallCenterPresenceStatus.PAUSED,
        )
      ) {
        totals.paused += 1;
      }

      return totals;
    },
    { available: 0, busy: 0, paused: 0 },
  );
}

function clientStateFromSessionMetadata(metadata: unknown) {
  if (!isRecord(metadata)) {
    return null;
  }

  if (isRecord(metadata.clientState)) {
    return metadata.clientState;
  }

  const payload = isRecord(metadata.payload) ? metadata.payload : null;
  return decodeClientState(payload?.client_state);
}

function isCallCenterAgentLegSessionMetadata(metadata: unknown) {
  return isCallCenterAgentLegClientState(clientStateFromSessionMetadata(metadata));
}

export function isPortalPatientCallSessionMetadata(metadata: unknown) {
  return !isCallCenterAgentLegSessionMetadata(metadata);
}

function filterPortalPatientCallSessions<T extends { metadata: unknown }>(sessions: T[]) {
  return sessions.filter((session) =>
    isPortalPatientCallSessionMetadata(session.metadata),
  );
}

function stationLabelFromSessionMetadata(metadata: unknown) {
  const clientState = clientStateFromSessionMetadata(metadata);

  if (!clientState) {
    return null;
  }

  return (
    asString(clientState.stationLabel) || asString(clientState.stationSeatId) || null
  );
}

function dispositionLabel(disposition: CallCenterNoteDisposition) {
  switch (disposition) {
    case CallCenterNoteDisposition.CALLBACK_NEEDED:
      return "Callback needed";
    case CallCenterNoteDisposition.FOLLOW_UP_REQUIRED:
      return "Follow-up required";
    case CallCenterNoteDisposition.WRONG_NUMBER:
      return "Wrong number";
    case CallCenterNoteDisposition.OTHER:
      return "Other outcome";
    case CallCenterNoteDisposition.RESOLVED:
    default:
      return "Resolved";
  }
}

function isNeedsActionTimelineItem(item: PortalCallerTimelineItem) {
  return (
    item.status === CallCenterNoteDisposition.CALLBACK_NEEDED ||
    item.status === CallCenterNoteDisposition.FOLLOW_UP_REQUIRED ||
    item.status === "NEEDS_ACTION"
  );
}

export async function getPortalCallCenterCallerTimeline(
  phone: string,
  options?: {
    locationId?: string;
    page?: number;
    pageSize?: number;
    range?: PortalCallCenterHistoryRange;
  },
) {
  const context = await getCurrentPracticeCallCenterContext();

  if (!context) {
    return null;
  }

  const requestedPage = Math.max(1, Math.round(options?.page ?? 1));
  const pageSize = Math.min(100, Math.max(25, Math.round(options?.pageSize ?? 100)));
  const range = options?.range ?? "all";
  const { practice } = context;
  const normalizedPhone = normalizePhone(phone) || phone.trim();
  const variants = phoneLookupVariants(normalizedPhone).filter(Boolean);

  if (!variants.length) {
    return {
      branding: getPracticeBranding(practice),
      callerName: null,
      items: [],
      latestItem: null,
      latestNeedsActionItem: null,
      page: 1,
      pageSize,
      phone: phone.trim(),
      practiceName: practice.name,
      range,
      totalPages: 1,
      totals: {
        inboundItems: 0,
        outboundConnectedCalls: 0,
        outboundDialedCalls: 0,
        totalItems: 0,
      },
    } satisfies PortalCallerTimeline;
  }

  const locationState =
    options?.locationId === undefined
      ? null
      : getPortalCallCenterLocationState(context, {
          locationId: options.locationId,
        });
  const selectedLocation =
    locationState?.locations.find((location) => location.id === options?.locationId) ??
    null;

  if (options?.locationId !== undefined && !selectedLocation) {
    return null;
  }

  const activityFilter = buildCallCenterActivityScopeWhere(context, selectedLocation);
  const noteFilter = buildCallCenterNoteScopeWhere(context, selectedLocation);
  const sessionFilter = buildCallCenterPatientSessionScopeWhere(
    context,
    selectedLocation,
  );
  const portalLocationFilter = selectedLocation
    ? callCenterLocationWhere(selectedLocation, context)
    : buildPortalLocationScopeWhere(context);
  const allowedSmsPracticeNumberIds =
    await getAllowedSmsPracticeNumberIdsForContext(context);
  const phoneSessionFilter = {
    OR: [
      {
        fromPhone: {
          in: variants,
        },
      },
      {
        toPhone: {
          in: variants,
        },
      },
    ],
  };
  const fromPhoneFilter = {
    fromPhone: {
      in: variants,
    },
  };
  const sessionWhere = {
    AND: [
      sessionFilter,
      phoneSessionFilter,
      buildPortalPatientSessionWhere(),
      {
        direction: {
          in: [CallCenterSessionDirection.INBOUND, CallCenterSessionDirection.OUTBOUND],
        },
      },
      {
        NOT: [
          {
            AND: [{ status: "MISSED" as const }, { missedCalls: { some: {} } }],
          },
          {
            AND: [{ status: "VOICEMAIL" as const }, { voicemails: { some: {} } }],
          },
        ],
      },
    ],
    practiceId: practice.id,
  } satisfies Prisma.CallCenterSessionWhereInput;
  const rangedSessionWhere = applyPortalCallHistoryRange(sessionWhere, range);
  const openMissedCallWhere = {
    AND: [
      activityFilter,
      fromPhoneFilter,
      {
        voicemails: {
          none: {},
        },
      },
    ],
    calledBack: false,
    practiceId: practice.id,
    resolvedAt: null,
  } satisfies Prisma.CallCenterMissedCallWhereInput;
  const openVoicemailWhere = {
    AND: [activityFilter, fromPhoneFilter],
    practiceId: practice.id,
    resolvedAt: null,
  } satisfies Prisma.CallCenterVoicemailWhereInput;
  const openNoteWhere = {
    AND: [noteFilter, fromPhoneFilter],
    disposition: {
      in: [
        CallCenterNoteDisposition.CALLBACK_NEEDED,
        CallCenterNoteDisposition.FOLLOW_UP_REQUIRED,
      ],
    },
    practiceId: practice.id,
    resolvedThread: false,
  } satisfies Prisma.CallCenterNoteWhereInput;
  const missedCallWhere = applyCreatedAtRange(
    {
      AND: [
        activityFilter,
        fromPhoneFilter,
        {
          voicemails: {
            none: {},
          },
        },
      ],
      practiceId: practice.id,
    } satisfies Prisma.CallCenterMissedCallWhereInput,
    range,
  ) satisfies Prisma.CallCenterMissedCallWhereInput;
  const voicemailWhere = applyCreatedAtRange(
    {
      AND: [activityFilter, fromPhoneFilter],
      practiceId: practice.id,
    } satisfies Prisma.CallCenterVoicemailWhereInput,
    range,
  ) satisfies Prisma.CallCenterVoicemailWhereInput;
  const noteWhere = applyCreatedAtRange(
    {
      AND: [noteFilter, fromPhoneFilter],
      practiceId: practice.id,
    } satisfies Prisma.CallCenterNoteWhereInput,
    range,
  ) satisfies Prisma.CallCenterNoteWhereInput;
  const currentConnectedSessionWhere = {
    AND: [
      sessionFilter,
      phoneSessionFilter,
      buildPortalPatientSessionWhere(),
      portalConnectedCallSignalWhere(),
    ],
    practiceId: practice.id,
    status: "COMPLETED",
  } satisfies Prisma.CallCenterSessionWhereInput;
  const smsMessageWhere = applyCreatedAtRange(
    {
      conversation: {
        AND: [
          portalLocationFilter,
          {
            practiceNumberId: {
              in: allowedSmsPracticeNumberIds,
            },
          },
          {
            patientPhoneNumber: {
              in: variants,
            },
          },
        ],
        practiceId: practice.id,
      },
    } satisfies Prisma.SmsMessageWhereInput,
    range,
  ) satisfies Prisma.SmsMessageWhereInput;

  const [
    sessionCount,
    missedCallCount,
    voicemailCount,
    noteCount,
    smsMessageCount,
    inboundSessionCount,
    inboundSmsMessageCount,
    outboundDialedCallCount,
    outboundConnectedCallCount,
  ] = await Promise.all([
    prisma.callCenterSession.count({
      where: rangedSessionWhere,
    }),
    prisma.callCenterMissedCall.count({
      where: missedCallWhere,
    }),
    prisma.callCenterVoicemail.count({
      where: voicemailWhere,
    }),
    prisma.callCenterNote.count({
      where: noteWhere,
    }),
    prisma.smsMessage.count({
      where: smsMessageWhere,
    }),
    prisma.callCenterSession.count({
      where: {
        AND: [rangedSessionWhere, { direction: CallCenterSessionDirection.INBOUND }],
      },
    }),
    prisma.smsMessage.count({
      where: {
        AND: [smsMessageWhere, { direction: "INBOUND" }],
      },
    }),
    prisma.callCenterSession.count({
      where: {
        AND: [rangedSessionWhere, { direction: CallCenterSessionDirection.OUTBOUND }],
      },
    }),
    prisma.callCenterSession.count({
      where: {
        AND: [
          rangedSessionWhere,
          {
            answeredAt: {
              not: null,
            },
            direction: CallCenterSessionDirection.OUTBOUND,
            status: "COMPLETED",
          },
        ],
      },
    }),
  ]);
  const totalItems =
    sessionCount + missedCallCount + voicemailCount + noteCount + smsMessageCount;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const sourceTake = page * pageSize;

  const [
    sessions,
    missedCalls,
    voicemails,
    notes,
    smsMessages,
    callerNameSource,
    currentMissedCalls,
    currentVoicemails,
    currentNotes,
    currentConnectedSession,
  ] = await Promise.all([
    prisma.callCenterSession.findMany({
      orderBy: [{ startedAt: "desc" }],
      select: {
        answeredAt: true,
        callerName: true,
        direction: true,
        endedAt: true,
        fromPhone: true,
        id: true,
        location: {
          select: {
            name: true,
          },
        },
        metadata: true,
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
          take: 3,
        },
        startedAt: true,
        status: true,
        toPhone: true,
      },
      take: sourceTake,
      where: rangedSessionWhere,
    }),
    prisma.callCenterMissedCall.findMany({
      orderBy: [{ createdAt: "desc" }],
      select: {
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
        sessionId: true,
      },
      take: sourceTake,
      where: missedCallWhere,
    }),
    prisma.callCenterVoicemail.findMany({
      orderBy: [{ createdAt: "desc" }],
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
        missedCallId: true,
        recordingId: true,
        resolvedAt: true,
        sessionId: true,
      },
      take: sourceTake,
      where: voicemailWhere,
    }),
    prisma.callCenterNote.findMany({
      orderBy: [{ createdAt: "desc" }],
      select: {
        body: true,
        createdAt: true,
        createdBy: {
          select: {
            email: true,
            name: true,
          },
        },
        createdByLabel: true,
        disposition: true,
        fromPhone: true,
        id: true,
        location: {
          select: {
            name: true,
          },
        },
        resolvedThread: true,
        stationLabelSnapshot: true,
      },
      take: sourceTake,
      where: noteWhere,
    }),
    prisma.smsMessage.findMany({
      orderBy: [{ createdAt: "desc" }],
      select: {
        body: true,
        createdAt: true,
        direction: true,
        fromNumber: true,
        id: true,
        status: true,
        toNumber: true,
        conversation: {
          select: {
            location: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      take: sourceTake,
      where: smsMessageWhere,
    }),
    prisma.callCenterSession.findFirst({
      orderBy: [{ startedAt: "desc" }],
      select: {
        callerName: true,
      },
      where: {
        AND: [
          sessionFilter,
          phoneSessionFilter,
          buildPortalPatientSessionWhere(),
          {
            callerName: {
              not: null,
            },
          },
        ],
        practiceId: practice.id,
      },
    }),
    prisma.callCenterMissedCall.findMany({
      orderBy: [{ createdAt: "desc" }],
      select: {
        callerName: true,
        createdAt: true,
        fromPhone: true,
        id: true,
        location: {
          select: {
            name: true,
          },
        },
      },
      where: openMissedCallWhere,
    }),
    prisma.callCenterVoicemail.findMany({
      orderBy: [{ createdAt: "desc" }],
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
      },
      where: openVoicemailWhere,
    }),
    prisma.callCenterNote.findMany({
      orderBy: [{ createdAt: "desc" }],
      select: {
        createdAt: true,
        disposition: true,
        fromPhone: true,
        id: true,
        location: {
          select: {
            name: true,
          },
        },
      },
      where: openNoteWhere,
    }),
    prisma.callCenterSession.findFirst({
      orderBy: [{ endedAt: "desc" }, { answeredAt: "desc" }, { startedAt: "desc" }],
      select: {
        answeredAt: true,
        direction: true,
        endedAt: true,
        fromPhone: true,
        startedAt: true,
        toPhone: true,
      },
      where: currentConnectedSessionWhere,
    }),
  ]);

  const currentActivity: PortalCallActivityItem[] = [
    ...currentMissedCalls.map((missed) => ({
      callerName: missed.callerName,
      createdAt: missed.createdAt,
      disposition: null,
      durationSec: null,
      fromPhone: missed.fromPhone,
      id: `missed:${missed.id}`,
      kind: "missed" as const,
      locationName: missed.location?.name ?? null,
      recordingId: null,
      recordId: missed.id,
      resolved: false,
    })),
    ...currentVoicemails.map((voicemail) => ({
      callerName: voicemail.callerName,
      createdAt: voicemail.createdAt,
      disposition: null,
      durationSec: voicemail.durationSec,
      fromPhone: voicemail.fromPhone,
      id: `voicemail:${voicemail.id}`,
      kind: "voicemail" as const,
      locationName: voicemail.location?.name ?? null,
      recordingId: voicemail.recordingId,
      recordId: voicemail.id,
      resolved: false,
    })),
    ...currentNotes.map((note) => ({
      callerName: null,
      createdAt: note.createdAt,
      disposition: note.disposition,
      durationSec: null,
      fromPhone: note.fromPhone,
      id: `note:${note.id}`,
      kind: "note" as const,
      locationName: note.location?.name ?? null,
      recordingId: null,
      recordId: note.id,
      resolved: false,
    })),
  ];
  const currentNeedsActionGroup =
    buildPortalNeedsActionGroups(
      currentActivity,
      currentConnectedSession
        ? [
            {
              direction: currentConnectedSession.direction,
              fromPhone: currentConnectedSession.fromPhone,
              occurredAt:
                currentConnectedSession.endedAt ??
                currentConnectedSession.answeredAt ??
                currentConnectedSession.startedAt,
              toPhone: currentConnectedSession.toPhone,
            },
          ]
        : [],
    )[0] ?? null;
  const currentNeedsActionItem = currentNeedsActionGroup
    ? needsActionGroupToTimelineItem(currentNeedsActionGroup)
    : null;

  const voicemailMissedCallIds = new Set(
    voicemails
      .map((voicemail) => voicemail.missedCallId)
      .filter((id): id is string => Boolean(id)),
  );
  const missedSessionIds = new Set(
    missedCalls
      .map((missed) => missed.sessionId)
      .filter((id): id is string => Boolean(id)),
  );
  const voicemailSessionIds = new Set(
    voicemails
      .map((voicemail) => voicemail.sessionId)
      .filter((id): id is string => Boolean(id)),
  );
  const patientSessions = sessions.filter(
    (session) => !isCallCenterAgentLegSessionMetadata(session.metadata),
  );
  const connectedCallTimes = patientSessions
    .filter(
      (session) =>
        session.status === "COMPLETED" && hasPortalConnectedCallSignal(session),
    )
    .map((session) => session.endedAt ?? session.answeredAt ?? session.startedAt)
    .sort((a, b) => a.getTime() - b.getTime());
  const laterConnectedCallAt = (occurredAt: Date) =>
    connectedCallTimes.find((connectedAt) => connectedAt > occurredAt) ?? null;
  const items: PortalCallerTimelineItem[] = [];

  for (const session of patientSessions) {
    const occurredAt = session.endedAt ?? session.answeredAt ?? session.startedAt;
    const sessionPhone =
      session.direction === CallCenterSessionDirection.OUTBOUND
        ? session.toPhone
        : session.fromPhone;
    const sessionPhoneKey = needsActionPhoneKey(sessionPhone);
    const hasMatchingMissedCall =
      missedSessionIds.has(session.id) ||
      missedCalls.some(
        (missed) =>
          needsActionPhoneKey(missed.fromPhone) === sessionPhoneKey &&
          Math.abs(missed.createdAt.getTime() - occurredAt.getTime()) <= 90_000,
      );
    const hasMatchingVoicemail =
      voicemailSessionIds.has(session.id) ||
      voicemails.some(
        (voicemail) =>
          needsActionPhoneKey(voicemail.fromPhone) === sessionPhoneKey &&
          Math.abs(voicemail.createdAt.getTime() - occurredAt.getTime()) <= 90_000,
      );

    if (session.status === "MISSED" && hasMatchingMissedCall) {
      continue;
    }

    if (session.status === "VOICEMAIL" && hasMatchingVoicemail) {
      continue;
    }

    const answeredAttempt = session.queueItems
      .flatMap((item) => item.ringAttempts)
      .find(
        (attempt) =>
          attempt.answeredAt ||
          attempt.status === "ANSWERED" ||
          attempt.status === "BRIDGED",
      );
    const seat = answeredAttempt?.seat ?? null;
    const stationLabel = seat
      ? seat.extension
        ? `${seat.extension} - ${seat.label}`
        : seat.label
      : stationLabelFromSessionMetadata(session.metadata);
    const direction =
      session.direction === CallCenterSessionDirection.OUTBOUND ? "outbound" : "inbound";
    const kind =
      session.status === "MISSED"
        ? "missed"
        : session.status === "VOICEMAIL"
          ? "voicemail"
          : "call";
    const title =
      session.status === "MISSED"
        ? "Missed call"
        : session.status === "VOICEMAIL"
          ? "Voicemail"
          : direction === "outbound"
            ? "Outbound"
            : "Inbound";

    items.push({
      body: null,
      direction,
      durationSec: callDurationSec(session),
      id: `session:${session.id}`,
      kind,
      locationName: session.location?.name ?? null,
      note: null,
      occurredAt,
      phone: direction === "outbound" ? session.toPhone : session.fromPhone,
      recordId: null,
      recordingId: null,
      stationLabel,
      status: session.status,
      title,
    });
  }

  for (const missed of missedCalls) {
    if (voicemailMissedCallIds.has(missed.id)) {
      continue;
    }

    const clearedAt = missed.resolvedAt ? null : laterConnectedCallAt(missed.createdAt);

    items.push({
      body: null,
      direction: "inbound",
      durationSec: null,
      id: `missed:${missed.id}`,
      kind: "missed",
      locationName: missed.location?.name ?? null,
      note: missed.resolvedAt
        ? "Resolved"
        : clearedAt
          ? "A later call connected with staff."
          : "No voicemail was left.",
      connectedLaterAt: clearedAt,
      occurredAt: missed.createdAt,
      phone: missed.fromPhone,
      recordId: missed.id,
      recordingId: null,
      stationLabel: null,
      status: missed.resolvedAt
        ? "RESOLVED"
        : clearedAt
          ? "CLEARED_BY_LATER_CALL"
          : "NEEDS_ACTION",
      title: "Missed call",
    });
  }

  for (const voicemail of voicemails) {
    const clearedAt = voicemail.resolvedAt
      ? null
      : laterConnectedCallAt(voicemail.createdAt);

    items.push({
      body: null,
      direction: "inbound",
      durationSec: null,
      id: `voicemail:${voicemail.id}`,
      kind: "voicemail",
      locationName: voicemail.location?.name ?? null,
      note: voicemail.resolvedAt
        ? "Resolved"
        : clearedAt
          ? "A later call connected with staff."
          : `${voicemail.durationSec}s voicemail`,
      connectedLaterAt: clearedAt,
      occurredAt: voicemail.createdAt,
      phone: voicemail.fromPhone,
      recordId: voicemail.id,
      recordingId: voicemail.recordingId,
      stationLabel: null,
      status: voicemail.resolvedAt
        ? "RESOLVED"
        : clearedAt
          ? "CLEARED_BY_LATER_CALL"
          : "NEEDS_ACTION",
      title: "Voicemail",
    });
  }

  for (const message of smsMessages) {
    const outbound = message.direction === "OUTBOUND";

    items.push({
      body: message.body,
      direction: outbound ? "outbound" : "inbound",
      durationSec: null,
      id: `text:${message.id}`,
      kind: "text",
      locationName: message.conversation.location?.name ?? null,
      note: null,
      occurredAt: message.createdAt,
      phone: outbound ? message.toNumber : message.fromNumber,
      recordId: null,
      recordingId: null,
      stationLabel: null,
      status: message.status,
      title: outbound ? "Outbound text" : "Inbound text",
    });
  }

  for (const note of notes) {
    const createdBy =
      note.createdByLabel || note.createdBy?.name || note.createdBy?.email || null;

    items.push({
      body: note.body,
      direction: null,
      durationSec: null,
      id: `note:${note.id}`,
      kind: "note",
      locationName: note.location?.name ?? null,
      note: note.resolvedThread ? "Thread closed" : null,
      occurredAt: note.createdAt,
      phone: note.fromPhone,
      recordId: note.id,
      recordingId: null,
      stationLabel: note.stationLabelSnapshot || createdBy,
      status: note.resolvedThread ? CallCenterNoteDisposition.RESOLVED : note.disposition,
      title: dispositionLabel(note.disposition),
    });
  }

  items.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const pageStart = (page - 1) * pageSize;
  const latestItem = items[0] ?? null;
  const latestNeedsActionItem =
    currentNeedsActionItem ??
    items.find((item) => isNeedsActionTimelineItem(item)) ??
    null;

  return {
    branding: getPracticeBranding(practice),
    callerName:
      callerNameSource?.callerName ??
      patientSessions.find((session) => session.callerName)?.callerName ??
      missedCalls.find((missed) => missed.callerName)?.callerName ??
      voicemails.find((voicemail) => voicemail.callerName)?.callerName ??
      null,
    items: items.slice(pageStart, pageStart + pageSize),
    latestItem,
    latestNeedsActionItem,
    page,
    pageSize,
    phone: normalizedPhone,
    practiceName: practice.name,
    range,
    totalPages,
    totals: {
      inboundItems:
        inboundSessionCount + missedCallCount + voicemailCount + inboundSmsMessageCount,
      outboundConnectedCalls: outboundConnectedCallCount,
      outboundDialedCalls: outboundDialedCallCount,
      totalItems,
    },
  } satisfies PortalCallerTimeline;
}

type ResolvedCallCenterSettings = Prisma.PracticeCallCenterSettingsGetPayload<{
  include: { practice: true };
}>;

type CallCenterSettingsLookup =
  | { kind: "AMBIGUOUS" }
  | { kind: "FOUND"; settings: ResolvedCallCenterSettings }
  | { kind: "NOT_FOUND" }
  | { kind: "OWNER_BLOCKED" };

type WebhookSettingsSource =
  "client_state" | "connection" | "existing_session" | "handoff_trunk" | "practice_phone";

type ResolvedWebhookSettings = {
  settings: ResolvedCallCenterSettings;
  source: WebhookSettingsSource;
};

function settingsLookup(
  settings: ResolvedCallCenterSettings[],
): CallCenterSettingsLookup {
  if (settings.length === 0) {
    return { kind: "NOT_FOUND" };
  }

  return settings.length === 1
    ? { kind: "FOUND", settings: settings[0] }
    : { kind: "AMBIGUOUS" };
}

async function findSettingsByPracticePhone(
  practicePhoneVariants: string[],
  connectionId?: string,
): Promise<CallCenterSettingsLookup> {
  if (!practicePhoneVariants.length) {
    return { kind: "NOT_FOUND" };
  }

  const phoneMatch: Prisma.PracticeCallCenterSettingsWhereInput = {
    OR: [
      { inboundPhoneNumber: { in: practicePhoneVariants } },
      { outboundCallerNumber: { in: practicePhoneVariants } },
      {
        practice: {
          phoneNumbers: {
            some: { phoneNumber: { in: practicePhoneVariants } },
          },
        },
      },
      {
        practice: {
          locations: {
            some: { phone: { in: practicePhoneVariants } },
          },
        },
      },
    ],
  };
  const findMatches = (connection: string | null | undefined) =>
    prisma.practiceCallCenterSettings.findMany({
      include: { practice: true },
      orderBy: { id: "asc" },
      take: 2,
      where: {
        AND: [
          phoneMatch,
          ...(connection !== undefined ? [{ telnyxConnectionId: connection }] : []),
        ],
        enabled: true,
      },
    });

  if (connectionId) {
    const exact = settingsLookup(await findMatches(connectionId));
    if (exact.kind !== "NOT_FOUND") {
      return exact;
    }

    return connectionId === process.env.TELNYX_CONNECTION_ID?.trim()
      ? settingsLookup(await findMatches(null))
      : { kind: "NOT_FOUND" };
  }

  return settingsLookup(await findMatches(undefined));
}

async function findSettingsByConnectionId(
  connectionId: string,
): Promise<CallCenterSettingsLookup> {
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

  return settingsLookup(settings);
}

async function existingSessionPracticeIds(payload: Record<string, unknown>) {
  const callControlId = asString(payload.call_control_id);
  const callLegId = asString(payload.call_leg_id);
  const callSessionId = asString(payload.call_session_id);

  if (callControlId) {
    const session = await prisma.callCenterSession.findUnique({
      select: { practiceId: true },
      where: { telnyxCallControlId: callControlId },
    });
    return session ? [session.practiceId] : [];
  }

  if (callLegId) {
    const session = await prisma.callCenterSession.findUnique({
      select: { practiceId: true },
      where: { telnyxCallLegId: callLegId },
    });
    return session ? [session.practiceId] : [];
  }

  if (callSessionId) {
    const sessions = await prisma.callCenterSession.findMany({
      distinct: ["practiceId"],
      select: { practiceId: true },
      take: 2,
      where: { telnyxCallSessionId: callSessionId },
    });
    return sessions.map((session) => session.practiceId);
  }

  return [];
}

async function findSettingsForExistingSession(
  payload: Record<string, unknown>,
): Promise<CallCenterSettingsLookup> {
  const practiceIds = await existingSessionPracticeIds(payload);

  if (practiceIds.length !== 1) {
    return practiceIds.length > 1 ? { kind: "AMBIGUOUS" } : { kind: "NOT_FOUND" };
  }

  const settings = await prisma.practiceCallCenterSettings.findMany({
    include: { practice: true },
    take: 2,
    where: {
      enabled: true,
      practiceId: practiceIds[0],
    },
  });
  const result = settingsLookup(settings);
  return result.kind === "NOT_FOUND" ? { kind: "OWNER_BLOCKED" } : result;
}

function resolvedSettingsOrNull(
  result: CallCenterSettingsLookup,
  source: WebhookSettingsSource,
): ResolvedWebhookSettings | null {
  if (result.kind === "AMBIGUOUS" || result.kind === "OWNER_BLOCKED") {
    console.warn("[call-center] webhook practice resolution blocked", {
      reason: result.kind.toLowerCase(),
      source,
    });
  }

  return result.kind === "FOUND" ? { settings: result.settings, source } : null;
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
      const existingPracticeIds = await existingSessionPracticeIds(payload);
      if (
        existingPracticeIds.length > 1 ||
        (existingPracticeIds.length === 1 &&
          existingPracticeIds[0] !== resolvedPracticeId)
      ) {
        console.warn("[call-center] webhook practice resolution blocked", {
          reason: "owner_mismatch",
          source: "client_state",
        });
        return null;
      }

      const settings = await prisma.practiceCallCenterSettings.findFirst({
        include: { practice: true },
        where: {
          enabled: true,
          practiceId: resolvedPracticeId,
        },
      });

      return settings ? { settings, source: "client_state" as const } : null;
    }
  }

  const existingSession = await findSettingsForExistingSession(payload);
  if (existingSession.kind !== "NOT_FOUND") {
    return resolvedSettingsOrNull(existingSession, "existing_session");
  }

  if (handoff.isCallCenterHandoff && handoff.trunkPhone) {
    const handoffSettings = await findSettingsByPracticePhone(
      phoneLookupVariants(handoff.trunkPhone),
      connectionId,
    );

    if (handoffSettings.kind !== "NOT_FOUND") {
      return resolvedSettingsOrNull(handoffSettings, "handoff_trunk");
    }
  }

  const phoneCandidates = practicePhoneCandidatesForTelnyxPayload(payload);
  if (phoneCandidates.length) {
    const phoneSettings = await findSettingsByPracticePhone(
      [...new Set(phoneCandidates.flatMap(phoneLookupVariants))],
      connectionId,
    );
    if (phoneSettings.kind !== "NOT_FOUND") {
      return resolvedSettingsOrNull(phoneSettings, "practice_phone");
    }
  }

  if (connectionId) {
    return resolvedSettingsOrNull(
      await findSettingsByConnectionId(connectionId),
      "connection",
    );
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

async function resolveLocationIdFromClientState(
  practiceId: string,
  clientState: Record<string, unknown> | null,
) {
  const locationId = asString(clientState?.locationId);
  const browserSessionId = asString(clientState?.browserSessionId);
  const stationSeatId = asString(clientState?.stationSeatId);

  if (!locationId || !browserSessionId || !stationSeatId) {
    return null;
  }

  const [location, presence] = await Promise.all([
    prisma.practiceLocation.findFirst({
      select: {
        id: true,
      },
      where: {
        id: locationId,
        practiceId,
      },
    }),
    prisma.callCenterPresence.findFirst({
      select: {
        seat: {
          select: {
            locationId: true,
          },
        },
        user: {
          select: {
            memberships: {
              select: {
                locationScope: true,
                locations: {
                  select: {
                    locationId: true,
                  },
                },
              },
              where: {
                practiceId,
              },
            },
          },
        },
      },
      where: {
        browserSessionId,
        lastSeenAt: {
          gte: getPresenceExpirationCutoff(),
        },
        seat: {
          practiceId,
        },
        seatId: stationSeatId,
        status: {
          not: CallCenterPresenceStatus.OFFLINE,
        },
      },
    }),
  ]);
  const membership = presence?.user?.memberships[0] ?? null;
  if (!location || !presence || !membership) {
    return null;
  }

  const canUseLocation = canUseClientStateLocationForPresence({
    locationId: location.id,
    membershipLocationIds: membership.locations.map((item) => item.locationId),
    membershipLocationScope: membership.locationScope,
    seatLocationId: presence.seat.locationId,
  });

  return canUseLocation ? location.id : null;
}

function getPracticeSidePhone(payload: Record<string, unknown>) {
  const handoff = extractAcuityLiveKitHandoff(payload);
  if (handoff.isCallCenterHandoff && handoff.trunkPhone) {
    return handoff.trunkPhone;
  }

  const direction = telnyxSessionDirectionFromPayload(payload);
  const from = asString(payload.from);
  const to = asString(payload.to);

  if (direction === CallCenterSessionDirection.OUTBOUND) {
    return from;
  }

  return direction === CallCenterSessionDirection.INBOUND ? to : "";
}

export function practicePhoneCandidatesForTelnyxPayload(
  payload: Record<string, unknown>,
) {
  const handoff = extractAcuityLiveKitHandoff(payload);
  if (handoff.isCallCenterHandoff && handoff.trunkPhone) {
    return [handoff.trunkPhone];
  }

  const direction = telnyxSessionDirectionFromPayload(payload);
  const from = asString(payload.from);
  const to = asString(payload.to);

  if (direction === CallCenterSessionDirection.INBOUND) {
    return to ? [to] : [];
  }

  if (direction === CallCenterSessionDirection.OUTBOUND) {
    return from ? [from] : [];
  }

  return [];
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

export function isConnectionOnlyIncomingLeg(
  payload: Record<string, unknown>,
  source: WebhookSettingsSource,
) {
  return (
    source === "connection" &&
    !extractAcuityLiveKitHandoff(payload).isCallCenterHandoff &&
    telnyxSessionDirectionFromPayload(payload) === CallCenterSessionDirection.INBOUND
  );
}

function callCenterSessionDirectionFromPayloadClientState(
  payload: Record<string, unknown>,
  clientState: Record<string, unknown> | null,
) {
  if (isCallCenterAgentLegClientState(clientState)) {
    return CallCenterSessionDirection.INTERNAL;
  }

  return telnyxSessionDirectionFromPayload(payload);
}

export function callCenterSessionDirectionFromPayload(
  payload: Record<string, unknown>,
  existingMetadata?: unknown,
) {
  return callCenterSessionDirectionFromPayloadClientState(
    payload,
    decodeClientState(payload.client_state) ??
      clientStateFromSessionMetadata(existingMetadata),
  );
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

export function mergeCallCenterSessionStatus(
  existing: CallCenterSessionStatus | null | undefined,
  next: CallCenterSessionStatus,
) {
  if (!existing) {
    return next;
  }

  // A saved voicemail is more specific than an earlier hangup outcome. Once
  // observed, no delayed provider event may replace it.
  if (existing === "VOICEMAIL" || next === "VOICEMAIL") {
    return "VOICEMAIL" as const;
  }

  if (TERMINAL_SESSION_STATUSES.has(existing)) {
    return existing;
  }

  if (TERMINAL_SESSION_STATUSES.has(next)) {
    return next;
  }

  return existing === "ACTIVE" ? existing : next;
}

async function upsertSessionFromPayload({
  eventType,
  fallbackClientState = null,
  locationId,
  payload,
  practiceId,
  status,
}: {
  eventType: string;
  fallbackClientState?: Record<string, unknown> | null;
  locationId: string | null;
  payload: Record<string, unknown>;
  practiceId: string;
  status: CallCenterSessionStatus;
}) {
  const callControlId = asString(payload.call_control_id);
  const callLegId = asString(payload.call_leg_id);
  const callSessionId = asString(payload.call_session_id);
  const now = new Date();
  const eventAt = asDate(payload.occurred_at) ?? now;
  const agentCallId = await resolveAgentCallIdFromPayload(practiceId, payload);
  const handoff = extractAcuityLiveKitHandoff(payload);
  const clientState = decodeClientState(payload.client_state) ?? fallbackClientState;
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
  const callerName = asString(payload.caller_id_name) || null;

  if (!callControlId && !callLegId && !callSessionId) {
    throw new TelnyxError("Call event is missing a stable identity", 422);
  }

  for (let writeAttempt = 0; writeAttempt < 4; writeAttempt += 1) {
    let existingSession = callControlId
      ? await prisma.callCenterSession.findUnique({
          where: { telnyxCallControlId: callControlId },
        })
      : callLegId
        ? await prisma.callCenterSession.findUnique({
            where: { telnyxCallLegId: callLegId },
          })
        : null;

    if (existingSession && existingSession.practiceId !== practiceId) {
      throw new TelnyxError("Call identity belongs to another practice", 409);
    }

    if (!callControlId && !callLegId && callSessionId) {
      const matches = await prisma.callCenterSession.findMany({
        orderBy: { startedAt: "asc" },
        take: 2,
        where: {
          direction: CallCenterSessionDirection.INBOUND,
          practiceId,
          telnyxCallSessionId: callSessionId,
        },
      });

      if (
        matches.length > 1 ||
        (matches.length === 0 && eventType !== "call.initiated")
      ) {
        throw new TelnyxError("Call session identity is not unique", 409);
      }
      existingSession = matches[0] ?? null;
    }
    const existingClientState = clientStateFromSessionMetadata(existingSession?.metadata);
    const effectiveClientState = clientState ?? existingClientState;
    const sessionPayloadDirection = callCenterSessionDirectionFromPayloadClientState(
      payload,
      effectiveClientState,
    );
    const nextStatus = mergeCallCenterSessionStatus(existingSession?.status, status);
    const data = {
      agentCallId: agentCallId ?? existingSession?.agentCallId ?? null,
      callerName: callerName ?? existingSession?.callerName ?? null,
      direction: mergeSessionDirection({
        existingDirection: existingSession?.direction,
        payloadDirection: sessionPayloadDirection,
      }),
      endedAt: TERMINAL_SESSION_STATUSES.has(nextStatus)
        ? (existingSession?.endedAt ?? eventAt)
        : undefined,
      fromPhone: payloadFromPhone ?? existingSession?.fromPhone ?? null,
      locationId: locationId ?? existingSession?.locationId ?? null,
      metadata: jsonInput(
        projectionMetadata(existingSession?.metadata, {
          clientState: effectiveClientState,
          lastEventType: eventType,
        }),
      ),
      status: nextStatus,
      telnyxCallLegId: callLegId || existingSession?.telnyxCallLegId || null,
      telnyxCallSessionId: callSessionId || existingSession?.telnyxCallSessionId || null,
      toPhone: payloadToPhone ?? existingSession?.toPhone ?? null,
      ...(existingSession?.answeredAt
        ? { answeredAt: existingSession.answeredAt }
        : status === "ACTIVE"
          ? { answeredAt: eventAt }
          : {}),
    };

    if (existingSession) {
      const updated = await prisma.callCenterSession.updateMany({
        data,
        where: {
          id: existingSession.id,
          updatedAt: existingSession.updatedAt,
        },
      });

      if (updated.count === 1) {
        return prisma.callCenterSession.findUniqueOrThrow({
          where: { id: existingSession.id },
        });
      }
      continue;
    }

    try {
      return await prisma.callCenterSession.create({
        data: {
          ...data,
          practiceId,
          startedAt: eventAt,
          telnyxCallControlId: callControlId || null,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }
  }

  throw new TelnyxError("Failed to serialize call session transition", 503);
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
  for (let writeAttempt = 0; writeAttempt < 4; writeAttempt += 1) {
    const existing = await prisma.callCenterQueueItem.findUnique({
      where: { callerSessionId: session.id },
    });
    const nextStatus = existing ? mergeQueueStatus(existing.status, status) : status;
    const terminal = ["COMPLETED", "ABANDONED", "VOICEMAIL"].includes(nextStatus);
    const data = {
      fromPhone: session.fromPhone,
      locationId: session.locationId,
      metadata: jsonInput(
        projectionMetadata(existing?.metadata, {
          lastEventType: eventType,
        }),
      ),
      status: nextStatus,
      toPhone: session.toPhone,
      ...(nextStatus === "ASSIGNED"
        ? { assignedAt: existing?.assignedAt ?? eventAt }
        : {}),
      ...(nextStatus === "ACTIVE" ? { answeredAt: existing?.answeredAt ?? eventAt } : {}),
      ...(nextStatus === "VOICEMAIL"
        ? { voicemailStartedAt: existing?.voicemailStartedAt ?? eventAt }
        : {}),
      ...(terminal ? { endedAt: existing?.endedAt ?? eventAt } : {}),
    };

    if (existing) {
      const updated = await prisma.callCenterQueueItem.updateMany({
        data,
        where: {
          id: existing.id,
          updatedAt: existing.updatedAt,
        },
      });
      if (updated.count === 1) {
        return prisma.callCenterQueueItem.findUniqueOrThrow({
          where: { id: existing.id },
        });
      }
      continue;
    }

    try {
      return await prisma.callCenterQueueItem.create({
        data: {
          ...data,
          practiceId: session.practiceId,
          callerSessionId: session.id,
          enteredAt: session.startedAt,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }
  }

  throw new TelnyxError("Failed to serialize queue transition", 503);
}

export function mergeQueueStatus(
  existing: CallCenterQueueStatus,
  next: CallCenterQueueStatus,
): CallCenterQueueStatus {
  if (existing === "VOICEMAIL" || next === "VOICEMAIL") {
    return "VOICEMAIL";
  }

  if (existing === "COMPLETED" || existing === "ABANDONED") {
    return existing;
  }

  if (next === "COMPLETED" || next === "ABANDONED") {
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

export function shouldMarkLinkedInboundSessionCompleted(session: {
  direction: CallCenterSessionDirection;
  endedAt?: Date | null;
  status: CallCenterSessionStatus;
}) {
  if (session.direction !== CallCenterSessionDirection.INBOUND) {
    return false;
  }

  if (
    session.status === "MISSED" ||
    session.status === "VOICEMAIL" ||
    session.status === "FAILED"
  ) {
    return false;
  }

  return session.status !== "COMPLETED" || !session.endedAt;
}

async function markLinkedInboundSessionCompletedForQueueItem({
  eventAt,
  queueItemId,
}: {
  eventAt: Date;
  queueItemId: string;
}) {
  const queueItem = await prisma.callCenterQueueItem.findUnique({
    select: {
      answeredAt: true,
      callerSession: {
        select: {
          answeredAt: true,
          direction: true,
          endedAt: true,
          id: true,
          status: true,
        },
      },
    },
    where: {
      id: queueItemId,
    },
  });

  const session = queueItem?.callerSession;

  if (!session || !shouldMarkLinkedInboundSessionCompleted(session)) {
    return null;
  }

  return prisma.callCenterSession.updateMany({
    data: {
      answeredAt: session.answeredAt ?? queueItem.answeredAt ?? eventAt,
      endedAt: session.endedAt ?? eventAt,
      status: "COMPLETED",
    },
    where: {
      direction: CallCenterSessionDirection.INBOUND,
      id: session.id,
      status: {
        notIn: ["MISSED", "VOICEMAIL", "FAILED"],
      },
    },
  });
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
      queueItem: {
        select: {
          metadata: true,
          status: true,
        },
      },
      queueItemId: true,
      seatId: true,
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

  const providerLegIsLive = ["RINGING", "ANSWERED", "BRIDGED"].includes(status);
  if (providerLegIsLive && existing.queueItem.status === "VOICEMAIL") {
    await prisma.callCenterRingAttempt.update({
      data: {
        endedAt: eventAt,
        hangupCause: "voicemail_started",
        status: "CANCELED",
        telnyxCallControlId: callControlId || undefined,
      },
      where: { id: existing.id },
    });
    if (callControlId) {
      await hangupTelnyxCall(callControlId, `hangup-late-answer-${existing.id}`);
    }
    return prisma.callCenterRingAttempt.findUnique({
      where: { id: existing.id },
    });
  }

  const terminal = ["CANCELED", "FAILED", "NO_ANSWER"].includes(status);
  const previouslyAnswered =
    existing.status === "ANSWERED" || existing.status === "BRIDGED";

  // Terminal hangup of a connected agent leg → end of call, mark queue COMPLETED.
  if (terminal && previouslyAnswered) {
    const transfer = pendingBlindTransfer(existing.queueItem.metadata);
    const isTransferSourceHangup =
      transfer &&
      asString(transfer.fromSeatId) === existing.seatId &&
      (!asString(transfer.sourceCallControlId) ||
        callControlIdVariants(asString(transfer.sourceCallControlId)).includes(
          existing.telnyxCallControlId || callControlId,
        ));

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

    if (transfer && isTransferSourceHangup) {
      await prisma.callCenterQueueItem.update({
        data: {
          metadata: jsonInput(
            metadataWithPendingBlindTransferSourceEnded(existing.queueItem.metadata, {
              endedAt: eventAt,
              reason: asString(payload.hangup_cause) || "source_ended",
            }),
          ),
        },
        where: {
          id: existing.queueItemId,
        },
      });

      return attempt;
    }

    const queueCompleted = await prisma.callCenterQueueItem.updateMany({
      data: {
        endedAt: eventAt,
        status: "COMPLETED",
      },
      where: {
        id: existing.queueItemId,
        status: {
          in: ["RINGING", "ASSIGNED", "ACTIVE"],
        },
      },
    });
    if (queueCompleted.count === 1) {
      await markLinkedInboundSessionCompletedForQueueItem({
        eventAt,
        queueItemId: existing.queueItemId,
      });
    }

    return attempt;
  }

  const nextStatus = mergeRingAttemptStatus(existing.status, status);
  const connected = nextStatus === "ANSWERED" || nextStatus === "BRIDGED";
  const updated = await prisma.callCenterRingAttempt.updateMany({
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
      ...(connected
        ? {
            queueItem: {
              status: {
                not: "VOICEMAIL" as const,
              },
            },
          }
        : {}),
      status: existing.status,
    },
  });

  if (updated.count === 0 && connected) {
    const current = await prisma.callCenterRingAttempt.findUnique({
      include: {
        queueItem: {
          select: {
            status: true,
          },
        },
      },
      where: {
        id: existing.id,
      },
    });

    if (current?.queueItem.status === "VOICEMAIL") {
      await prisma.callCenterRingAttempt.updateMany({
        data: {
          endedAt: eventAt,
          hangupCause: "voicemail_started",
          status: "CANCELED",
        },
        where: {
          id: existing.id,
          status: {
            in: ["DIALING", "RINGING"],
          },
        },
      });

      if (callControlId) {
        await hangupTelnyxCall(callControlId, `hangup-late-answer-${existing.id}`).catch(
          (hangupError) => {
            console.error("[call-center] Failed to reject late agent answer", {
              ...categoricalError(hangupError),
              queueItemId: existing.queueItemId,
              ringAttemptId: existing.id,
            });
          },
        );
      }
    }
  }

  return prisma.callCenterRingAttempt.findUnique({
    where: {
      id: existing.id,
    },
  });
}

async function findAvailableSeatsForInboundQueueItem({
  locationId,
  practiceId,
  queueItemId,
}: {
  locationId: string | null;
  practiceId: string;
  queueItemId: string;
}) {
  const presenceCutoff = getPresenceExpirationCutoff();
  const [practice, profileUsers, seats] = await Promise.all([
    prisma.practice.findUnique({
      select: {
        locations: {
          select: {
            id: true,
            name: true,
          },
        },
        name: true,
      },
      where: {
        id: practiceId,
      },
    }),
    prisma.user.findMany({
      orderBy: {
        email: "asc",
      },
      select: {
        email: true,
        id: true,
        name: true,
      },
      where: {
        memberships: {
          some: {
            practiceId,
          },
        },
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
        enabled: true,
        practiceId,
        presence: {
          some: {
            lastSeenAt: {
              gte: presenceCutoff,
            },
            readyForCalls: true,
            status: CallCenterPresenceStatus.AVAILABLE,
          },
        },
        sipUsername: {
          not: null,
        },
      },
    }),
  ]);

  if (!practice) {
    return [];
  }

  const profileContexts = new Map<string, PortalPracticeAccessContext>();

  for (const user of profileUsers) {
    // The current shared-queue ownership lives in call-center-profiles. This
    // intentionally reuses that boundary until queue membership is modeled
    // directly in the database.
    const context = {
      practice,
      session: {
        user,
      },
    } as unknown as PortalPracticeAccessContext;
    const profileQueueKey = getCallCenterSeatQueueKeyForProfile(context);

    if (profileQueueKey) {
      profileContexts.set(profileQueueKey, context);
    }
  }

  const profileQueueMatches = new Map(
    await Promise.all(
      [...profileContexts].map(async ([queueKey, context]) => {
        const scope = buildCallCenterQueueScopeForProfile(context);
        const count = scope
          ? await prisma.callCenterQueueItem.count({
              where: {
                id: queueItemId,
                practiceId,
                ...scope,
              },
            })
          : 0;

        return [queueKey, count > 0] as const;
      }),
    ),
  );
  const matchingProfileQueueKey = [...profileQueueMatches]
    .filter(([, matches]) => matches)
    .map(([queueKey]) => queueKey)
    .sort()[0];

  return seats.filter((seat) =>
    isInboundSeatEligibleForAutomaticRing({
      profileCanAccessQueue: Boolean(matchingProfileQueueKey),
      profileQueueKey: matchingProfileQueueKey ?? null,
      queueLocationId: locationId,
      seatLocationId: seat.locationId,
      seatQueueKey: seat.queueKey,
    }),
  );
}

async function createNextRingAttempt({
  queueItemId,
  seatId,
}: {
  queueItemId: string;
  seatId: string;
}) {
  for (let conflictCount = 0; conflictCount < 3; conflictCount += 1) {
    const existing = await prisma.callCenterRingAttempt.findFirst({
      orderBy: {
        generation: "desc",
      },
      select: {
        generation: true,
        hangupCause: true,
        status: true,
      },
      where: {
        queueItemId,
        seatId,
      },
    });
    const generation = nextRingAttemptGeneration(existing);

    if (generation === null) {
      return null;
    }

    try {
      return await prisma.callCenterRingAttempt.create({
        data: {
          generation,
          queueItemId,
          seatId,
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
    }
  }

  return null;
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
      const attempt = await createNextRingAttempt({
        queueItemId,
        seatId: seat.id,
      });

      if (!attempt) {
        console.info("[call-center] skipping active duplicate station ring", {
          queueItemId,
          seatId: seat.id,
          seatLabel: seat.label,
        });
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
        const dialRequest: Parameters<typeof dialTelnyxCall>[0] = {
          bridgeIntent: true,
          bridgeOnAnswer: true,
          clientState: encodeClientState({
            callerNumber: callerNumber || undefined,
            queueItemId,
            ringAttemptId: attempt.id,
            seatId: seat.id,
          }),
          commandId: ringAttemptCommandId(attempt.id),
          connectionId,
          from,
          linkTo: callerCallControlId,
          preventDoubleBridge: true,
          timeoutSecs,
          to,
        };
        let result: Awaited<ReturnType<typeof dialTelnyxCall>> | null = null;
        let lastError: unknown = new Error("Telnyx dial did not complete");

        for (let sendAttempt = 1; sendAttempt <= 2; sendAttempt += 1) {
          try {
            result = await dialTelnyxCall({
              ...dialRequest,
              signal: AbortSignal.timeout(CALL_SETUP_COMMAND_TIMEOUT_MS),
            });
            break;
          } catch (error) {
            lastError = error;
            const errorCode = telnyxDialFailureCode(error);
            const retryable = !isDefinitiveRingAttemptFailureCode(errorCode);
            console.warn("[call-center] station dial attempt failed", {
              errorCode,
              queueItemId,
              retryable,
              ringAttemptId: attempt.id,
              sendAttempt,
            });
            if (!retryable || sendAttempt === 2) {
              throw error;
            }
          }
        }

        if (!result) {
          throw lastError;
        }
        const telnyxCallControlId = extractTelnyxCallControlId(result);

        await prisma.callCenterRingAttempt.updateMany({
          data: {
            status: "RINGING",
            telnyxCallControlId: telnyxCallControlId || undefined,
          },
          where: {
            id: attempt.id,
            status: {
              in: ["DIALING", "RINGING"],
            },
          },
        });
        return true;
      } catch (error) {
        const errorCode = telnyxDialFailureCode(error);
        const definitive = isDefinitiveRingAttemptFailureCode(errorCode);
        const recorded = await prisma.callCenterRingAttempt.updateMany({
          data: definitive
            ? {
                endedAt: new Date(),
                hangupCause: errorCode,
                status: "FAILED",
              }
            : {
                hangupCause: errorCode,
              },
          where: {
            id: attempt.id,
            status: "DIALING",
          },
        });

        if (recorded.count === 1) {
          return !definitive;
        }

        const current = await prisma.callCenterRingAttempt.findUnique({
          select: {
            status: true,
          },
          where: {
            id: attempt.id,
          },
        });

        return Boolean(current && LIVE_RING_ATTEMPT_STATUSES.includes(current.status));
      }
    }),
  );

  return results.filter(Boolean).length;
}

async function automaticallyRingAvailableSeatsForQueueItem({
  queueItem,
  session,
  settings,
}: {
  queueItem: {
    id: string;
    locationId: string | null;
  };
  session: Awaited<ReturnType<typeof upsertSessionFromPayload>>;
  settings: CallCenterVoicemailSettings;
}) {
  const runtimeSettings = resolveTelnyxRuntimeSettings(settings);
  const callerCallControlId = session.telnyxCallControlId || "";
  const callerNumber = normalizePhone(session.fromPhone);
  const from =
    callerNumber ||
    normalizePhone(session.toPhone) ||
    normalizePhone(runtimeSettings.outboundCallerNumber);

  if (!callerCallControlId || !runtimeSettings.connectionId || !from) {
    console.warn("[call-center] automatic ring skipped — incomplete routing setup", {
      hasCallerCallControlId: Boolean(callerCallControlId),
      hasConnectionId: Boolean(runtimeSettings.connectionId),
      hasFromNumber: Boolean(from),
      queueItemId: queueItem.id,
    });
    return 0;
  }

  const availableSeats = await findAvailableSeatsForInboundQueueItem({
    locationId: queueItem.locationId,
    practiceId: session.practiceId,
    queueItemId: queueItem.id,
  });
  const dialedAttemptCount = await ringAvailableSeatsForQueueItem({
    availableSeats,
    callerCallControlId,
    callerNumber,
    connectionId: runtimeSettings.connectionId,
    from,
    queueItemId: queueItem.id,
    timeoutSecs: AGENT_RING_TIMEOUT_SEC,
  });

  console.info("[call-center] automatic inbound routing complete", {
    eligibleSeatCount: availableSeats.length,
    ringAttemptCount: dialedAttemptCount,
    queueItemId: queueItem.id,
  });

  return dialedAttemptCount;
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
        readyForCalls: true,
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
  } catch {
    await restoreQueueItemAfterFailedStationTake({
      previousStatus,
      queueItemId: queueItem.id,
    });
    throw new TelnyxError("Failed to ring station", 502);
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

export async function blindTransferActiveCallToSeat({
  sourceCallControlId,
  targetSeatId,
}: {
  browserSessionId?: string;
  sourceCallControlId: string;
  targetSeatId: string;
}) {
  const context = await getCurrentPracticeCallCenterContext();

  if (!context) {
    throw new TelnyxError("Unauthorized", 401);
  }

  const settings = context.practice.callCenterSettings;

  if (!settings?.enabled) {
    throw new TelnyxError("Call center is not enabled for this practice", 403);
  }

  const callControlIds = callControlIdVariants(sourceCallControlId);

  if (!callControlIds.length || !targetSeatId) {
    throw new TelnyxError("sourceCallControlId and targetSeatId are required", 400);
  }

  const sourceAttempt = await prisma.callCenterRingAttempt.findFirst({
    select: {
      id: true,
      queueItem: {
        select: {
          callerSession: {
            select: {
              fromPhone: true,
              telnyxCallControlId: true,
            },
          },
          fromPhone: true,
          id: true,
          locationId: true,
          metadata: true,
          practiceId: true,
          status: true,
          toPhone: true,
        },
      },
      queueItemId: true,
      seat: {
        select: {
          extension: true,
          label: true,
        },
      },
      seatId: true,
      status: true,
      telnyxCallControlId: true,
    },
    where: {
      queueItem: {
        practiceId: context.practice.id,
      },
      endedAt: null,
      status: {
        in: ["ANSWERED", "BRIDGED"],
      },
      telnyxCallControlId: {
        in: callControlIds,
      },
    },
  });

  if (!sourceAttempt) {
    throw new TelnyxError("Active call is not available for transfer", 404);
  }

  const queueItem = sourceAttempt.queueItem;
  const callerCallControlId = queueItem.callerSession?.telnyxCallControlId || "";
  const runtimeSettings = resolveTelnyxRuntimeSettings(settings);
  const callerNumber = normalizePhone(
    queueItem.callerSession?.fromPhone || queueItem.fromPhone,
  );
  const from =
    callerNumber ||
    normalizePhone(queueItem.toPhone) ||
    normalizePhone(runtimeSettings.outboundCallerNumber);

  if (!["ACTIVE", "ASSIGNED"].includes(queueItem.status)) {
    throw new TelnyxError("Call is not active", 409);
  }

  if (!callerCallControlId) {
    throw new TelnyxError("Caller leg is missing Telnyx call control ID", 422);
  }

  if (
    !isSpecialAbitaCallCenterContext(context) &&
    !canAccessPortalLocation(context, queueItem.locationId)
  ) {
    throw new TelnyxError("Active call is not available for transfer", 404);
  }

  const scopedQueueMatch = await prisma.callCenterQueueItem.count({
    where: {
      id: queueItem.id,
      practiceId: context.practice.id,
      ...buildCallCenterQueueScopeWhere(context),
    },
  });

  if (scopedQueueMatch === 0) {
    throw new TelnyxError("Active call is not available for transfer", 404);
  }

  if (sourceAttempt.seatId === targetSeatId) {
    throw new TelnyxError("Choose a different station to transfer this call", 422);
  }

  const targetSeat = await prisma.callCenterAgentSeat.findFirst({
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
      id: targetSeatId,
      ...buildCallCenterSeatAccessWhere(context),
      practiceId: context.practice.id,
    },
  });

  if (!targetSeat) {
    throw new TelnyxError("Transfer station not found", 404);
  }

  if (!targetSeat.sipUsername) {
    throw new TelnyxError("Transfer station is missing a SIP username", 422);
  }

  const presenceCutoff = getPresenceExpirationCutoff();
  const targetPresence = await prisma.callCenterPresence.count({
    where: {
      lastSeenAt: {
        gte: presenceCutoff,
      },
      readyForCalls: true,
      seatId: targetSeat.id,
      status: CallCenterPresenceStatus.AVAILABLE,
    },
  });

  if (targetPresence === 0) {
    throw new TelnyxError("Transfer station is not available", 409);
  }

  if (!runtimeSettings.connectionId || !from) {
    throw new TelnyxError("Telnyx connection and caller number are required", 422);
  }

  const transferState = {
    fromSeatId: sourceAttempt.seatId,
    fromSeatLabel: sourceAttempt.seat.extension
      ? `${sourceAttempt.seat.extension} - ${sourceAttempt.seat.label}`
      : sourceAttempt.seat.label,
    callerCallControlId,
    queueItemId: queueItem.id,
    sourceCallControlId: sourceAttempt.telnyxCallControlId,
    sourceRingAttemptId: sourceAttempt.id,
    startedAt: new Date().toISOString(),
    targetSeatId: targetSeat.id,
    targetSeatLabel: targetSeat.extension
      ? `${targetSeat.extension} - ${targetSeat.label}`
      : targetSeat.label,
  };

  await prisma.callCenterQueueItem.update({
    data: {
      metadata: jsonInput({
        ...objectMetadata(queueItem.metadata),
        blindTransferPending: transferState,
      }),
    },
    where: {
      id: queueItem.id,
    },
  });

  return {
    ok: true,
  };
}

export async function takePendingBlindTransfer({
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

  if (!browserSessionId || !queueItemId || !seatId) {
    throw new TelnyxError("browserSessionId, queueItemId, and seatId are required", 400);
  }

  const queueItem = await prisma.callCenterQueueItem.findFirst({
    select: {
      callerSession: {
        select: {
          fromPhone: true,
          telnyxCallControlId: true,
        },
      },
      fromPhone: true,
      id: true,
      locationId: true,
      metadata: true,
      practiceId: true,
      status: true,
      toPhone: true,
    },
    where: {
      id: queueItemId,
      practiceId: context.practice.id,
      status: "ACTIVE",
    },
  });

  if (!queueItem) {
    throw new TelnyxError("Transfer is not available", 404);
  }

  if (
    !isSpecialAbitaCallCenterContext(context) &&
    !canAccessPortalLocation(context, queueItem.locationId)
  ) {
    throw new TelnyxError("Transfer is not available", 404);
  }

  const scopedQueueMatch = await prisma.callCenterQueueItem.count({
    where: {
      id: queueItem.id,
      practiceId: context.practice.id,
      ...buildCallCenterQueueScopeWhere(context),
    },
  });

  if (scopedQueueMatch === 0) {
    throw new TelnyxError("Transfer is not available", 404);
  }

  const transfer = pendingBlindTransfer(queueItem.metadata);

  if (!transfer || asString(transfer.targetSeatId) !== seatId) {
    throw new TelnyxError("Transfer is not assigned to this station", 409);
  }

  const sourceEndedAt = asString(transfer.sourceEndedAt);

  const targetSeat = await prisma.callCenterAgentSeat.findFirst({
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
  });

  if (!targetSeat) {
    throw new TelnyxError("Transfer station not found", 404);
  }

  if (!targetSeat.sipUsername) {
    throw new TelnyxError("Transfer station is missing a SIP username", 422);
  }

  const presenceCutoff = getPresenceExpirationCutoff();
  const allowsSharedStation = allowsSharedCallCenterStation(context, targetSeat);
  const [availablePresence, competingPresence] = await Promise.all([
    prisma.callCenterPresence.count({
      where: {
        browserSessionId,
        lastSeenAt: {
          gte: presenceCutoff,
        },
        readyForCalls: true,
        seatId: targetSeat.id,
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
            seatId: targetSeat.id,
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
  const callerCallControlId =
    asString(transfer.callerCallControlId) ||
    queueItem.callerSession?.telnyxCallControlId ||
    "";
  const callerNumber = normalizePhone(
    queueItem.callerSession?.fromPhone || queueItem.fromPhone,
  );
  const from =
    callerNumber ||
    normalizePhone(queueItem.toPhone) ||
    normalizePhone(runtimeSettings.outboundCallerNumber);

  if (!callerCallControlId) {
    throw new TelnyxError("Caller leg is missing Telnyx call control ID", 422);
  }

  if (!runtimeSettings.connectionId || !from) {
    throw new TelnyxError("Telnyx connection and caller number are required", 422);
  }

  const sourceAttemptId = asString(transfer.sourceRingAttemptId);
  const sourceAttempt = sourceEndedAt
    ? null
    : await prisma.callCenterRingAttempt.findFirst({
        select: {
          id: true,
        },
        where: {
          ...(sourceAttemptId ? { id: sourceAttemptId } : {}),
          endedAt: null,
          queueItemId: queueItem.id,
          status: {
            in: ["ANSWERED", "BRIDGED"],
          },
        },
      });

  if (!sourceEndedAt && !sourceAttempt) {
    throw new TelnyxError("Source call is no longer active", 409);
  }

  const targetAttempt = await createNextRingAttempt({
    queueItemId: queueItem.id,
    seatId: targetSeat.id,
  });

  if (!targetAttempt) {
    throw new TelnyxError("Transfer station already has a live call leg", 409);
  }

  const clientState = encodeClientState({
    blindTransfer: true,
    callerNumber: callerNumber || undefined,
    queueItemId: queueItem.id,
    ringAttemptId: targetAttempt.id,
    sourceRingAttemptId: sourceAttempt?.id || sourceAttemptId || undefined,
    targetSeatId: targetSeat.id,
  });

  try {
    const result = await dialTelnyxCall({
      bridgeIntent: true,
      bridgeOnAnswer: true,
      clientState,
      commandId: ringAttemptCommandId(targetAttempt.id, "transfer-ring"),
      connectionId: runtimeSettings.connectionId,
      from,
      linkTo: callerCallControlId,
      preventDoubleBridge: false,
      timeoutSecs: AGENT_RING_TIMEOUT_SEC,
      to: telnyxSipUri(targetSeat.sipUsername),
    });
    const telnyxCallControlId = extractTelnyxCallControlId(result);

    await prisma.callCenterRingAttempt.updateMany({
      data: {
        status: "RINGING",
        telnyxCallControlId: telnyxCallControlId || undefined,
      },
      where: {
        id: targetAttempt.id,
        status: {
          in: ["DIALING", "RINGING"],
        },
      },
    });
  } catch (error) {
    const errorCode = transferFailureCode(error);
    const definitive = isDefinitiveRingAttemptFailureCode(errorCode);
    const recorded = await prisma.callCenterRingAttempt.updateMany({
      data: definitive
        ? {
            endedAt: new Date(),
            hangupCause: errorCode,
            status: "FAILED",
          }
        : {
            hangupCause: errorCode,
          },
      where: {
        id: targetAttempt.id,
        status: "DIALING",
      },
    });

    if (recorded.count === 1) {
      await prisma.callCenterQueueItem.update({
        data: {
          metadata: jsonInput({
            ...objectMetadata(queueItem.metadata),
            blindTransferError: errorCode,
          }),
        },
        where: {
          id: queueItem.id,
        },
      });
    }
    throw new TelnyxError("Failed to transfer call", 502);
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
  const queueItem = await prisma.callCenterQueueItem.findUnique({
    select: {
      metadata: true,
    },
    where: {
      id: queueItemId,
    },
  });

  if (!queueItem) {
    return;
  }

  await prisma.callCenterQueueItem.update({
    data: {
      metadata: jsonInput({
        ...objectMetadata(queueItem.metadata),
        voicemailError: voicemailFailureCode(error),
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
  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
    try {
      const response = await startTelnyxPlayback({
        callControlId,
        commandId: `ringback-${queueItemId}`,
        loop: 1,
        playbackContent: ringbackWavBase64For(timeoutSec),
        signal: AbortSignal.timeout(CALL_SETUP_COMMAND_TIMEOUT_MS),
      });
      if (response.ok) {
        console.info("[call-center] ringback started", {
          attemptNumber,
          queueItemId,
        });
        return true;
      }

      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      console.error("[call-center] ringback start failed", {
        attemptNumber,
        errorCode: response.status,
        errorName: "TelnyxResponseError",
        queueItemId,
        retryable,
      });
      if (!retryable) {
        return false;
      }
    } catch (error) {
      console.error("[call-center] ringback start failed", {
        ...categoricalError(error),
        attemptNumber,
        queueItemId,
        retryable: true,
      });
    }
  }

  return false;
}

async function answerInboundCaller(callControlId: string, queueItemId: string) {
  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
    try {
      const response = await answerTelnyxCall(
        callControlId,
        `answer-inbound-${queueItemId}`,
        AbortSignal.timeout(CALL_SETUP_COMMAND_TIMEOUT_MS),
      );
      if (response.ok) {
        return response;
      }

      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      console.error("[call-center] Failed to answer inbound caller leg", {
        attemptNumber,
        errorCode: response.status,
        errorName: "TelnyxResponseError",
        queueItemId,
        retryable,
      });
      if (!retryable) {
        return response;
      }
    } catch (error) {
      console.error("[call-center] Failed to answer inbound caller leg", {
        ...categoricalError(error),
        attemptNumber,
        queueItemId,
        retryable: true,
      });
    }
  }

  return null;
}

async function stopCallerRingback(callControlId: string, queueItemId: string) {
  await stopTelnyxPlayback(callControlId, `stop-ringback-${queueItemId}`).catch(
    () => null,
  );
}

function queueRingbackUnavailable(metadata: unknown) {
  return isRecord(metadata) && metadata.ringbackUnavailable === true;
}

function queueRingbackStarted(metadata: unknown) {
  return isRecord(metadata) && metadata.ringbackStarted === true;
}

function queueCallerAnswered(metadata: unknown) {
  return isRecord(metadata) && metadata.callerAnswered === true;
}

function queueVoicemailRequested(metadata: unknown) {
  return isRecord(metadata) && metadata.voicemailRequested === true;
}

function queueVoicemailSetupComplete(metadata: unknown) {
  return isRecord(metadata) && metadata.voicemailSetupComplete === true;
}

async function mergeQueueRoutingMetadata(
  queueItemId: string,
  patch: Record<string, unknown>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const queueItem = await prisma.callCenterQueueItem.findUnique({
      select: {
        metadata: true,
        updatedAt: true,
      },
      where: {
        id: queueItemId,
      },
    });

    if (!queueItem) {
      return false;
    }

    const updated = await prisma.callCenterQueueItem.updateMany({
      data: {
        metadata: jsonInput({
          ...objectMetadata(queueItem.metadata),
          ...patch,
        }),
      },
      where: {
        id: queueItemId,
        updatedAt: queueItem.updatedAt,
      },
    });

    if (updated.count === 1) {
      return true;
    }
  }

  return false;
}

async function markQueueRingbackUnavailable(queueItemId: string) {
  return mergeQueueRoutingMetadata(queueItemId, {
    ringbackError: "ringback_unavailable",
    ringbackUnavailable: true,
  });
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

  if (queueItem.status === "VOICEMAIL") {
    if (!queueVoicemailSetupComplete(queueItem.metadata)) {
      await startQueueVoicemail({ queueItemId: queueItem.id, settings });
    }
    return queueItem;
  }

  if (
    !["WAITING", "RINGING", "ASSIGNED"].includes(queueItem.status) ||
    queueItem.answeredAt ||
    queueItem.endedAt
  ) {
    console.info("[call-center] inbound queue item already routed, skipping ring", {
      queueItemId: queueItem.id,
      status: queueItem.status,
    });
    return queueItem;
  }

  if (queueItem.status === "WAITING") {
    const claimed = await prisma.callCenterQueueItem.updateMany({
      data: {
        status: "RINGING",
      },
      where: {
        answeredAt: null,
        endedAt: null,
        id: queueItem.id,
        status: "WAITING",
        voicemailStartedAt: null,
      },
    });

    if (claimed.count === 0) {
      console.info("[call-center] inbound routing already claimed", {
        queueItemId: queueItem.id,
      });
      return queueItem;
    }
  }

  let callerAnswered =
    queueCallerAnswered(queueItem.metadata) || Boolean(session.answeredAt);

  if (!callerAnswered) {
    const answerResponse = await answerInboundCaller(callerCallControlId, queueItem.id);

    if (!answerResponse || !answerResponse.ok) {
      throw new TelnyxError(
        "Failed to answer inbound caller",
        answerResponse?.status ?? 502,
      );
    }

    callerAnswered = await mergeQueueRoutingMetadata(queueItem.id, {
      callerAnswered: true,
    });
    if (!callerAnswered) {
      throw new TelnyxError("Failed to persist inbound answer state", 503);
    }
  }

  let ringbackStarted = queueRingbackStarted(queueItem.metadata);
  let ringbackUnavailable = queueRingbackUnavailable(queueItem.metadata);

  if (!ringbackStarted && !ringbackUnavailable) {
    ringbackStarted = await startCallerRingback({
      callControlId: callerCallControlId,
      queueItemId: queueItem.id,
      timeoutSec: settings.voicemailTimeoutSec,
    });

    const ringbackStatePersisted = ringbackStarted
      ? await mergeQueueRoutingMetadata(queueItem.id, { ringbackStarted: true })
      : await markQueueRingbackUnavailable(queueItem.id);
    if (!ringbackStatePersisted) {
      throw new TelnyxError("Failed to persist inbound ringback state", 503);
    }
    ringbackUnavailable = !ringbackStarted;
  }

  if (queueItem.status !== "ASSIGNED") {
    await automaticallyRingAvailableSeatsForQueueItem({
      queueItem,
      session,
      settings,
    }).catch((error) => {
      console.error("[call-center] automatic inbound routing failed", {
        ...categoricalError(error),
        queueItemId: queueItem.id,
      });
      return 0;
    });
  }

  const liveAttemptCount = await prisma.callCenterRingAttempt.count({
    where: {
      queueItemId: queueItem.id,
      OR: [
        { status: { in: ["RINGING", "ANSWERED", "BRIDGED"] } },
        {
          hangupCause: null,
          status: "DIALING",
        },
        {
          status: "DIALING",
          telnyxCallControlId: { not: null },
        },
      ],
    },
  });

  if (ringbackUnavailable && liveAttemptCount === 0) {
    if (queueVoicemailRequested(queueItem.metadata)) {
      await startQueueVoicemail({ queueItemId: queueItem.id, settings });
    } else {
      const voicemailRequested = await mergeQueueRoutingMetadata(queueItem.id, {
        voicemailRequested: true,
      });
      if (!voicemailRequested) {
        throw new TelnyxError("Failed to persist voicemail request", 503);
      }

      // Let a fresh durable inbox attempt own voicemail setup instead of
      // extending a provider-call setup invocation past its execution budget.
      throw new TelnyxError("Inbound voicemail setup deferred", 503);
    }
  }

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
  const candidate = await prisma.callCenterRingAttempt.findUnique({
    select: {
      seatId: true,
      telnyxCallControlId: true,
    },
    where: {
      id: winnerAttemptId,
    },
  });

  if (!candidate) {
    return;
  }

  let queueItem: {
    callerSession: { telnyxCallControlId: string | null } | null;
    metadata: unknown;
    status: CallCenterQueueStatus;
    updatedAt: Date;
  } | null = null;
  let electedWinnerAttemptId = "";
  let targetWonTransfer = false;

  // updatedAt is the Phase 0 compare-and-set token. The durable call model
  // replaces this metadata winner in the schema migration.
  for (let claimAttempt = 0; claimAttempt < 3; claimAttempt += 1) {
    queueItem = await prisma.callCenterQueueItem.findUnique({
      select: {
        callerSession: {
          select: {
            telnyxCallControlId: true,
          },
        },
        metadata: true,
        status: true,
        updatedAt: true,
      },
      where: {
        id: queueItemId,
      },
    });

    if (!queueItem) {
      return;
    }

    const blindTransfer = pendingBlindTransfer(queueItem.metadata);
    targetWonTransfer =
      Boolean(blindTransfer) &&
      asString(blindTransfer?.targetSeatId) === candidate.seatId;
    const persistedWinnerAttemptId = winningRingAttemptId(queueItem.metadata);

    if (persistedWinnerAttemptId && !targetWonTransfer) {
      electedWinnerAttemptId = persistedWinnerAttemptId;
      break;
    }

    if (!["ACTIVE", "ASSIGNED", "RINGING", "WAITING"].includes(queueItem.status)) {
      electedWinnerAttemptId = persistedWinnerAttemptId;
      break;
    }

    const winnerMetadata = metadataWithWinningRingAttempt(
      queueItem.metadata,
      winnerAttemptId,
    );
    const claimed = await prisma.callCenterQueueItem.updateMany({
      data: {
        answeredAt: eventAt,
        assignedAt: eventAt,
        metadata: jsonInput(winnerMetadata),
        status: "ACTIVE",
      },
      where: {
        id: queueItemId,
        status: queueItem.status,
        updatedAt: queueItem.updatedAt,
      },
    });

    if (claimed.count === 1) {
      electedWinnerAttemptId = winnerAttemptId;
      queueItem = {
        ...queueItem,
        metadata: winnerMetadata,
        status: "ACTIVE",
      };
      break;
    }
  }

  if (electedWinnerAttemptId !== winnerAttemptId) {
    const canceled = await prisma.callCenterRingAttempt.updateMany({
      data: {
        endedAt: eventAt,
        hangupCause: "answered_elsewhere",
        status: "CANCELED",
      },
      where: {
        id: winnerAttemptId,
        status: {
          in: LIVE_RING_ATTEMPT_STATUSES,
        },
      },
    });

    if (canceled.count === 1 && candidate.telnyxCallControlId) {
      await hangupTelnyxCall(
        candidate.telnyxCallControlId,
        `hangup-losing-ring-${winnerAttemptId}`,
      ).catch((hangupError) => {
        console.error("[call-center] Failed to hang up losing agent leg", {
          ...categoricalError(hangupError),
          queueItemId,
          ringAttemptId: winnerAttemptId,
        });
      });
    }
    return;
  }

  const blindTransfer = pendingBlindTransfer(queueItem?.metadata);
  const transferTargetSeatId = asString(blindTransfer?.targetSeatId);
  const preserveTransferTarget =
    Boolean(blindTransfer) &&
    !targetWonTransfer &&
    transferTargetSeatId !== candidate.seatId;

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
      ...(preserveTransferTarget
        ? {
            seatId: {
              not: transferTargetSeatId,
            },
          }
        : {}),
      status: {
        in: LIVE_RING_ATTEMPT_STATUSES,
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
      losing.map((attempt) =>
        attempt.telnyxCallControlId
          ? hangupTelnyxCall(
              attempt.telnyxCallControlId,
              `hangup-losing-ring-${attempt.id}`,
            ).catch((hangupError) => {
              console.error("[call-center] Failed to hang up losing agent leg", {
                ...categoricalError(hangupError),
                queueItemId,
                ringAttemptId: attempt.id,
              });
              return null;
            })
          : null,
      ),
    );
  }

  const callerCallControlId = queueItem?.callerSession?.telnyxCallControlId;

  if (callerCallControlId) {
    await stopCallerRingback(callerCallControlId, queueItemId);
  }

  if (blindTransfer && targetWonTransfer) {
    await prisma.callCenterQueueItem.update({
      data: {
        metadata: jsonInput(
          metadataWithoutPendingBlindTransfer(queueItem?.metadata, {
            endedAt: eventAt,
            reason: "transfer_bridged",
          }),
        ),
      },
      where: {
        id: queueItemId,
      },
    });
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
    pending.map((attempt) =>
      attempt.telnyxCallControlId
        ? hangupTelnyxCall(
            attempt.telnyxCallControlId,
            `hangup-canceled-ring-${attempt.id}`,
          ).catch((hangupError) => {
            console.error("[call-center] Failed to hang up pending ring attempt leg", {
              ...categoricalError(hangupError),
              queueItemId,
              ringAttemptId: attempt.id,
            });
            return null;
          })
        : null,
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

  if (
    queueItem.status === "VOICEMAIL" &&
    queueVoicemailSetupComplete(queueItem.metadata)
  ) {
    return queueItemId;
  }

  const callerCallControlId = queueItem.callerSession?.telnyxCallControlId;

  if (!callerCallControlId) {
    return null;
  }

  const voicemailAlreadyClaimed = queueItem.status === "VOICEMAIL";

  if (
    !voicemailAlreadyClaimed &&
    !canClaimQueueForVoicemail(queueItem.ringAttempts.map((attempt) => attempt.status))
  ) {
    return null;
  }

  if (!voicemailAlreadyClaimed) {
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
              in: CONNECTED_RING_ATTEMPT_STATUSES,
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

  const pendingAttempts = await prisma.callCenterRingAttempt.findMany({
    select: {
      id: true,
      telnyxCallControlId: true,
    },
    where: {
      queueItemId,
      OR: [
        { status: { in: ["DIALING", "RINGING"] } },
        { hangupCause: "voicemail_started", status: "CANCELED" },
      ],
    },
  });

  if (pendingAttempts.length) {
    await prisma.callCenterRingAttempt.updateMany({
      data: {
        endedAt: new Date(),
        hangupCause: "voicemail_started",
        status: "CANCELED",
      },
      where: {
        id: {
          in: pendingAttempts.map((attempt) => attempt.id),
        },
        status: {
          in: ["DIALING", "RINGING"],
        },
      },
    });

    await Promise.all(
      pendingAttempts.map((attempt) =>
        attempt.telnyxCallControlId
          ? hangupTelnyxCall(
              attempt.telnyxCallControlId,
              `hangup-voicemail-ring-${attempt.id}`,
            ).catch((hangupError) => {
              if (
                hangupError instanceof TelnyxError &&
                [404, 422].includes(hangupError.status)
              ) {
                return null;
              }
              console.error(
                "[call-center] Failed to hang up agent leg before voicemail",
                {
                  ...categoricalError(hangupError),
                  queueItemId,
                  ringAttemptId: attempt.id,
                },
              );
              throw hangupError;
            })
          : null,
      ),
    );
  }

  try {
    if (!queueRingbackUnavailable(queueItem.metadata)) {
      await stopCallerRingback(callerCallControlId, queueItemId);
    }
    await triggerTelnyxVoicemailPrompt(
      settings,
      callerCallControlId,
      `voicemail-greeting-${queueItemId}`,
    );
    const completed = await mergeQueueRoutingMetadata(queueItemId, {
      voicemailSetupComplete: true,
    });
    if (!completed) {
      throw new TelnyxError("Failed to persist voicemail setup state", 503);
    }
    console.info("[call-center] caller routed to voicemail", {
      missedCallId: missedCall.id,
      queueItemId,
    });
  } catch (error) {
    await markQueueVoicemailError({
      error,
      queueItemId,
    });
    throw error;
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
      metadata: true,
      status: true,
    },
    where: {
      id: queueItemId,
    },
  });

  if (
    queueItem?.status === "VOICEMAIL" &&
    !queueVoicemailSetupComplete(queueItem.metadata)
  ) {
    await startQueueVoicemail({ queueItemId, settings });
    return;
  }

  if (!queueItem || !["WAITING", "RINGING", "ASSIGNED"].includes(queueItem.status)) {
    return;
  }

  // Natural ringback completion is the queue deadline. The voicemail claim
  // atomically refuses a connected attempt and cancels any still-pending leg.
  await startQueueVoicemail({ queueItemId, settings });
}

async function releaseQueueItemAfterNoAnswer({
  queueItemId,
  settings,
}: {
  queueItemId: string;
  settings: CallCenterVoicemailSettings;
}) {
  const queueItem = await prisma.callCenterQueueItem.findUnique({
    select: {
      enteredAt: true,
      id: true,
      metadata: true,
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

  if (
    queueItem?.status === "VOICEMAIL" &&
    !queueVoicemailSetupComplete(queueItem.metadata)
  ) {
    await startQueueVoicemail({ queueItemId, settings });
    return;
  }

  if (
    !queueItem ||
    !shouldReleaseQueueItemAfterNoAnswer({
      attemptStatuses: queueItem.ringAttempts.map((attempt) => attempt.status),
      queueStatus: queueItem.status,
    })
  ) {
    return;
  }

  if (
    shouldStartVoicemailAfterNoAnswer({
      deadlineElapsed: hasQueueWaitDeadlineElapsed({
        enteredAt: queueItem.enteredAt,
        now: new Date(),
        timeoutSec: settings.voicemailTimeoutSec,
      }),
      ringbackUnavailable: queueRingbackUnavailable(queueItem.metadata),
    })
  ) {
    await startQueueVoicemail({ queueItemId, settings });
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

export function shouldStartVoicemailAfterNoAnswer({
  deadlineElapsed,
  ringbackUnavailable,
}: {
  deadlineElapsed: boolean;
  ringbackUnavailable: boolean;
}) {
  return deadlineElapsed || ringbackUnavailable;
}

export function shouldReleaseQueueItemAfterNoAnswer({
  attemptStatuses,
  queueStatus,
}: {
  attemptStatuses: CallCenterRingAttemptStatus[];
  queueStatus: CallCenterQueueStatus;
}) {
  return (
    ["WAITING", "RINGING", "ASSIGNED"].includes(queueStatus) &&
    attemptStatuses.length > 0 &&
    !attemptStatuses.some((status) => LIVE_RING_ATTEMPT_STATUSES.includes(status))
  );
}

export function hasQueueWaitDeadlineElapsed({
  enteredAt,
  now,
  timeoutSec,
}: {
  enteredAt: Date;
  now: Date;
  timeoutSec: number;
}) {
  return (
    now.getTime() >=
    enteredAt.getTime() + normalizeVoicemailTimeoutSec(timeoutSec) * 1_000
  );
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
    : buildCallCenterPatientSessionScopeWhere(context);

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
            readyForCalls: true,
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

  if (recordingId && !recordingUrl) {
    const recordingMetadata = await fetchTelnyxRecordingMetadata(recordingId);
    recordingUrl = recordingMetadata?.recordingUrl || "";
    duration = duration > 0 ? duration : (recordingMetadata?.durationSec ?? duration);
  }

  if (!recordingId) {
    return null;
  }

  if (!recordingUrl) {
    throw new TelnyxError("Telnyx recording URL is unavailable", 503);
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

  const clientState = decodeClientState(payload.client_state);
  const settingsResolution = await resolveCallCenterSettingsForWebhook(payload);

  console.info("[call-center] webhook event", {
    ...buildTelnyxWebhookLogContext(eventType, payload),
    settingsSource: settingsResolution?.source,
  });

  if (!settingsResolution) {
    console.warn("[call-center] webhook ignored — no enabled practice", { eventType });
    return { ignored: true, reason: "no_enabled_practice" };
  }

  const { settings, source: settingsSource } = settingsResolution;
  const practiceId = settings.practiceId;
  const locationId =
    (await resolveLocationIdFromClientState(practiceId, clientState)) ??
    (await resolveLocationIdForPhone(practiceId, getPracticeSidePhone(payload)));
  let session: Awaited<ReturnType<typeof upsertSessionFromPayload>> | null = null;

  switch (eventType) {
    case "call.initiated": {
      const connectionOnlyIncoming = isConnectionOnlyIncomingLeg(payload, settingsSource);
      session = await upsertSessionFromPayload({
        eventType,
        fallbackClientState: connectionOnlyIncoming ? { internalSeatLeg: true } : null,
        locationId,
        payload,
        practiceId,
        status: "RINGING",
      });
      if (connectionOnlyIncoming) {
        console.info("[call-center] connection-only incoming leg kept out of queue", {
          eventType,
        });
      }
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
    }

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
      const callControlId = asString(payload.call_control_id);
      const callSessionId = asString(payload.call_session_id);
      const existingSession = callControlId
        ? await prisma.callCenterSession.findUnique({
            select: {
              direction: true,
              id: true,
              metadata: true,
            },
            where: {
              telnyxCallControlId: callControlId,
            },
          })
        : callSessionId
          ? await prisma.callCenterSession.findFirst({
              select: {
                direction: true,
                id: true,
                metadata: true,
              },
              where: {
                practiceId,
                telnyxCallSessionId: callSessionId,
              },
            })
          : null;
      const direction = mergeSessionDirection({
        existingDirection: existingSession?.direction,
        payloadDirection: callCenterSessionDirectionFromPayload(
          payload,
          existingSession?.metadata,
        ),
      });
      const missed =
        direction === CallCenterSessionDirection.INBOUND &&
        (MISSED_CAUSES.has(hangupCause) ||
          (existingSession
            ? await wasInboundQueueUnanswered(existingSession.id)
            : false));

      session = await upsertSessionFromPayload({
        eventType,
        locationId,
        payload,
        practiceId,
        status: missed ? "MISSED" : "COMPLETED",
      });

      if (session.status === "MISSED" && isInboundSession(session)) {
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
        status:
          session.status === "VOICEMAIL"
            ? "VOICEMAIL"
            : session.status === "MISSED"
              ? "ABANDONED"
              : "COMPLETED",
      });
      if (queueItem && isInboundSession(session)) {
        await cancelPendingRingAttempts({
          cause: hangupCause || "caller_hangup",
          eventAt: asDate(payload.occurred_at) ?? new Date(),
          queueItemId: queueItem.id,
        });
      }
      if (ringAttempt) {
        await releaseQueueItemAfterNoAnswer({
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
      const commandId = asString(payload.command_id);
      let queueItemId = commandId.startsWith("voicemail-greeting-")
        ? commandId.slice("voicemail-greeting-".length)
        : "";

      if (!queueItemId && callControlId) {
        const item = await prisma.callCenterQueueItem.findFirst({
          orderBy: {
            updatedAt: "desc",
          },
          select: {
            id: true,
          },
          where: {
            callerSession: {
              telnyxCallControlId: callControlId,
            },
            status: "VOICEMAIL",
          },
        });
        queueItemId = item?.id ?? "";
      }

      if (settings.recordingEnabled && callControlId && queueItemId) {
        startTelnyxPlayback({
          callControlId,
          commandId: `voicemail-beep-${queueItemId}`,
          loop: 1,
          playbackContent: VOICEMAIL_BEEP_WAV_BASE64,
        }).catch((error) => {
          console.warn("[call-center] voicemail beep failed (continuing)", {
            ...categoricalError(error),
          });
        });

        // Beep is ~0.4s; wait a touch longer so it lands on the caller's line
        // before we start recording.
        await new Promise((resolve) => setTimeout(resolve, 500));

        await startTelnyxRecording(callControlId, `voicemail-recording-${queueItemId}`);
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
      if (bridgedAttempt?.status === "BRIDGED") {
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
  commandId: string,
) {
  const response = await speakOnTelnyxCall({
    callControlId,
    commandId,
    payload: settings.voicemailGreeting,
  });

  if (!response.ok) {
    throw new TelnyxError("Failed to trigger Telnyx voicemail prompt", response.status);
  }
}
