import type {
  CanonicalCallStatus,
  CanonicalLegStatus,
} from "@/lib/call-center/domain/canonical-call-state";
import { normalizePhone } from "@/lib/phone";

type JsonObject = Record<string, unknown>;

export type CanonicalTelnyxCallFact = {
  callerName: string | null;
  canonicalCallId: string | null;
  canonicalLegId: string | null;
  clientQueueItemId: string | null;
  clientRingAttemptId: string | null;
  direction: "INBOUND" | "OUTBOUND" | null;
  endpointId: string | null;
  eventType: string;
  fromPhone: string;
  hangupCauseCode: string | null;
  legKind: "AGENT" | "CUSTOMER" | null;
  occurredAt: Date;
  providerCallControlId: string | null;
  providerCommandId: string | null;
  providerCallLegId: string | null;
  providerCallSessionId: string | null;
  providerEventId: string;
  recordingDurationSec: number;
  recordingId: string | null;
  recordingUrl: string | null;
  toAddress: string;
  toPhone: string;
};

export type ResolvedCanonicalTelnyxCallFact = CanonicalTelnyxCallFact & {
  callObservation: CanonicalCallStatus | "HANGUP" | null;
  legKind: "AGENT" | "CUSTOMER";
  legObservation: CanonicalLegStatus;
};

export class CanonicalTelnyxFactError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CanonicalTelnyxFactError";
  }
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedCode(value: unknown) {
  const normalized = text(value)
    .replace(/[^A-Za-z0-9_.:-]+/g, "_")
    .slice(0, 100);
  return normalized || null;
}

function finiteNumber(value: unknown) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordingDurationSec(payload: JsonObject) {
  for (const value of [
    payload.recording_duration_sec,
    payload.recording_duration_secs,
    payload.recording_duration_seconds,
    payload.duration_sec,
    payload.duration_secs,
    payload.duration_seconds,
    payload.duration,
  ]) {
    const seconds = finiteNumber(value);
    if (seconds !== null) return Math.max(0, Math.round(seconds));
  }
  for (const value of [
    payload.recording_duration_ms,
    payload.recording_duration_millis,
    payload.duration_ms,
    payload.duration_millis,
  ]) {
    const milliseconds = finiteNumber(value);
    if (milliseconds !== null) {
      return Math.max(0, Math.round(milliseconds / 1_000));
    }
  }
  return 0;
}

function recordingUrl(payload: JsonObject) {
  const containers = [
    payload.download_urls,
    payload.public_recording_urls,
    payload.recording_urls,
  ];
  for (const container of containers) {
    if (!isRecord(container)) continue;
    const url = text(container.mp3) || text(container.wav);
    if (url) return url;
  }
  return text(payload.recording_url);
}

function decodeClientState(value: unknown) {
  const encoded = text(value);
  if (!encoded) return null;

  try {
    const decoded: unknown = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    return isRecord(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function direction(value: unknown): CanonicalTelnyxCallFact["direction"] {
  const normalized = text(value).toLowerCase();
  if (normalized === "incoming" || normalized === "inbound") return "INBOUND";
  if (normalized === "outgoing" || normalized === "outbound") return "OUTBOUND";
  return null;
}

export function resolveCanonicalTelnyxCallObservations(
  eventType: string,
  legKind: ResolvedCanonicalTelnyxCallFact["legKind"],
  callDirection: CanonicalTelnyxCallFact["direction"],
) {
  switch (eventType) {
    case "call.initiated":
      return {
        callObservation:
          legKind === "AGENT"
            ? "RINGING"
            : callDirection === "INBOUND"
              ? "QUEUED"
              : "RINGING",
        legObservation: "RINGING",
      } as const;
    case "call.answered":
      return {
        callObservation:
          legKind === "CUSTOMER" && callDirection === "OUTBOUND"
            ? "CONNECTED"
            : legKind === "AGENT"
              ? "RINGING"
              : null,
        legObservation: "ANSWERED",
      } as const;
    case "call.bridged":
      return { callObservation: "CONNECTED", legObservation: "BRIDGED" } as const;
    case "call.hangup":
      return {
        callObservation: legKind === "CUSTOMER" ? "HANGUP" : null,
        legObservation: "ENDED",
      } as const;
    case "call.playback.started":
    case "call.playback.ended":
    case "call.speak.started":
    case "call.speak.ended":
      return { callObservation: null, legObservation: "ANSWERED" } as const;
    case "call.recording.error":
      return { callObservation: null, legObservation: "ANSWERED" } as const;
    case "call.recording.saved":
    case "calls.voicemail.completed":
      return { callObservation: "VOICEMAIL", legObservation: "ENDED" } as const;
    default:
      return null;
  }
}

export function resolveCanonicalTelnyxLegKind(
  existingKind: "AGENT" | "CUSTOMER" | null,
  hintedKind: CanonicalTelnyxCallFact["legKind"],
) {
  if (existingKind && hintedKind && existingKind !== hintedKind) {
    throw new CanonicalTelnyxFactError("CANONICAL_LEG_KIND_MISMATCH");
  }

  const legKind = existingKind ?? hintedKind;
  if (!legKind) {
    throw new CanonicalTelnyxFactError("CANONICAL_LEG_CONTEXT_MISSING");
  }
  return legKind;
}

export function parseCanonicalTelnyxCallFact(
  body: unknown,
  receivedAt: Date,
): CanonicalTelnyxCallFact | null {
  if (!isRecord(body) || !isRecord(body.data) || !isRecord(body.data.payload)) {
    throw new CanonicalTelnyxFactError("CANONICAL_ENVELOPE_INVALID");
  }

  const eventType = text(body.data.event_type);
  const providerEventId = text(body.data.id);
  const payload = body.data.payload;
  if (!eventType || !providerEventId) {
    throw new CanonicalTelnyxFactError("CANONICAL_ENVELOPE_INVALID");
  }

  const clientState = decodeClientState(payload.client_state);
  const canonicalCallId = text(clientState?.callId) || null;
  const canonicalLegId = text(clientState?.legId) || null;
  if (Boolean(canonicalCallId) !== Boolean(canonicalLegId)) {
    throw new CanonicalTelnyxFactError("CANONICAL_AGENT_LINK_INCOMPLETE");
  }
  const endpointId =
    text(clientState?.endpointId) ||
    text(clientState?.seatId) ||
    text(clientState?.targetSeatId) ||
    text(clientState?.stationSeatId) ||
    null;
  const agentLegHint = Boolean(
    endpointId ||
    text(clientState?.canonicalOutboundToken) ||
    clientState?.internalSeatLeg === true ||
    text(clientState?.queueItemId) ||
    text(clientState?.ringAttemptId),
  );
  const legKind = agentLegHint
    ? "AGENT"
    : eventType === "call.initiated" ||
        eventType === "call.speak.ended" ||
        eventType === "calls.voicemail.completed"
      ? "CUSTOMER"
      : null;
  const callDirection = direction(payload.direction);
  if (!resolveCanonicalTelnyxCallObservations(eventType, "CUSTOMER", callDirection)) {
    return null;
  }

  const providerCallControlId = text(payload.call_control_id) || null;
  const providerCallLegId = text(payload.call_leg_id) || null;
  const providerCallSessionId = text(payload.call_session_id) || null;
  const providerCommandId =
    text(payload.command_id) || text(clientState?.commandId) || null;
  if (
    (eventType === "call.speak.ended" || eventType === "call.recording.saved") &&
    !providerCommandId
  ) {
    throw new CanonicalTelnyxFactError("CANONICAL_COMMAND_ID_MISSING");
  }
  const sessionOnlyVoicemailFact =
    (eventType === "call.recording.saved" || eventType === "calls.voicemail.completed") &&
    providerCallSessionId;
  if (!providerCallControlId && !providerCallLegId && !sessionOnlyVoicemailFact) {
    throw new CanonicalTelnyxFactError("CANONICAL_LEG_IDENTITY_MISSING");
  }

  const rawOccurredAt = text(body.data.occurred_at) || text(payload.occurred_at);
  const occurredAt = rawOccurredAt ? new Date(rawOccurredAt) : receivedAt;
  if (Number.isNaN(occurredAt.getTime())) {
    throw new CanonicalTelnyxFactError("CANONICAL_OCCURRED_AT_INVALID");
  }

  const from = normalizePhone(text(payload.from));
  const toAddress = text(payload.to);
  const to = normalizePhone(toAddress);
  const isRecordingFact =
    eventType === "call.recording.saved" || eventType === "calls.voicemail.completed";
  const recordingId =
    text(payload.recording_id) ||
    (isRecord(payload.recording) ? text(payload.recording.id) : "") ||
    (eventType === "call.recording.saved" ? providerCommandId : "") ||
    (eventType === "calls.voicemail.completed" ? providerCallSessionId : "") ||
    null;
  const resolvedRecordingUrl = recordingUrl(payload) || null;
  if (eventType === "call.recording.saved" && !recordingId) {
    throw new CanonicalTelnyxFactError("CANONICAL_RECORDING_ID_MISSING");
  }
  if (eventType === "call.recording.saved" && !resolvedRecordingUrl) {
    throw new CanonicalTelnyxFactError("CANONICAL_RECORDING_URL_MISSING");
  }

  return {
    callerName: text(payload.caller_id_name) || null,
    canonicalCallId,
    canonicalLegId,
    clientQueueItemId: text(clientState?.queueItemId) || null,
    clientRingAttemptId: text(clientState?.ringAttemptId) || null,
    direction: callDirection,
    endpointId,
    eventType,
    fromPhone: from,
    hangupCauseCode: boundedCode(payload.hangup_cause),
    legKind,
    occurredAt,
    providerCallControlId,
    providerCommandId,
    providerCallLegId,
    providerCallSessionId,
    providerEventId,
    recordingDurationSec: recordingDurationSec(payload),
    recordingId,
    recordingUrl: resolvedRecordingUrl,
    toAddress,
    toPhone: to,
  };
}
