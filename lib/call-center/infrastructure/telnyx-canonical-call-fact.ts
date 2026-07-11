import type {
  CanonicalCallStatus,
  CanonicalLegStatus,
} from "@/lib/call-center/domain/canonical-call-state";
import { normalizePhone } from "@/lib/phone";

type JsonObject = Record<string, unknown>;

export type CanonicalTelnyxCallFact = {
  callerName: string | null;
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
  providerCallLegId: string | null;
  providerCallSessionId: string | null;
  providerEventId: string;
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
  const endpointId =
    text(clientState?.seatId) ||
    text(clientState?.targetSeatId) ||
    text(clientState?.stationSeatId) ||
    null;
  const agentLegHint = Boolean(
    endpointId ||
    clientState?.internalSeatLeg === true ||
    text(clientState?.queueItemId) ||
    text(clientState?.ringAttemptId),
  );
  const legKind = agentLegHint
    ? "AGENT"
    : eventType === "call.initiated" || eventType === "calls.voicemail.completed"
      ? "CUSTOMER"
      : null;
  const callDirection = direction(payload.direction);
  if (!resolveCanonicalTelnyxCallObservations(eventType, "CUSTOMER", callDirection)) {
    return null;
  }

  const providerCallControlId = text(payload.call_control_id) || null;
  const providerCallLegId = text(payload.call_leg_id) || null;
  const providerCallSessionId = text(payload.call_session_id) || null;
  const sessionOnlyVoicemailFact =
    eventType === "calls.voicemail.completed" &&
    legKind === "CUSTOMER" &&
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
  const to = normalizePhone(text(payload.to));

  return {
    callerName: text(payload.caller_id_name) || null,
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
    providerCallLegId,
    providerCallSessionId,
    providerEventId,
    toPhone: to,
  };
}
