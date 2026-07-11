type JsonObject = { [key: string]: JsonValue };
type JsonValue = JsonObject | JsonValue[] | boolean | number | string | null;

export type TelnyxVoiceWebhookEnvelope = {
  body: JsonObject;
  eventType: string;
  occurredAt: Date | null;
  providerEventId: string;
};

export class InvalidTelnyxVoiceWebhookEnvelopeError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "InvalidTelnyxVoiceWebhookEnvelopeError";
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseTelnyxVoiceWebhookEnvelope(
  body: unknown,
): TelnyxVoiceWebhookEnvelope {
  if (!isJsonObject(body) || !isJsonObject(body.data)) {
    throw new InvalidTelnyxVoiceWebhookEnvelopeError(
      "Invalid Telnyx voice webhook envelope",
    );
  }

  const data = body.data;
  const providerEventId = nonEmptyString(data.id);
  const eventType = nonEmptyString(data.event_type);

  if (!providerEventId || !eventType || !isJsonObject(data.payload)) {
    throw new InvalidTelnyxVoiceWebhookEnvelopeError(
      "Telnyx voice webhook id, event type, and payload are required",
    );
  }

  return {
    body,
    eventType,
    occurredAt: optionalDate(data.occurred_at) ?? optionalDate(data.payload.occurred_at),
    providerEventId,
  };
}
