import { createPublicKey, verify } from "crypto";

const TELNYX_API_BASE = "https://api.telnyx.com";
const ED25519_SPKI_PREFIX = "302a300506032b6570032100";
const WEBHOOK_TOLERANCE_SEC = 5 * 60;

export class TelnyxError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "TelnyxError";
    this.status = status;
  }
}

function env(name: string) {
  return process.env[name]?.trim() || "";
}

export function getTelnyxApiKey() {
  const apiKey = env("TELNYX_API_KEY");

  if (!apiKey) {
    throw new TelnyxError("TELNYX_API_KEY is not configured");
  }

  return apiKey;
}

export async function telnyxFetch(path: string, options: RequestInit = {}) {
  const response = await fetch(`${TELNYX_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getTelnyxApiKey()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  return response;
}

export async function createTelnyxLoginToken(credentialId: string) {
  if (!credentialId) {
    throw new TelnyxError("Telnyx credential ID is not configured");
  }

  const response = await telnyxFetch(`/v2/telephony_credentials/${credentialId}/token`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new TelnyxError("Failed to generate Telnyx login token", response.status);
  }

  const token = (await response.text()).trim();

  try {
    const parsed = JSON.parse(token);
    if (typeof parsed === "string" && parsed.trim()) {
      return parsed.trim();
    }
  } catch {
    // Telnyx returns text/plain today; keep quoted JSON strings working too.
  }

  return token;
}

export async function dialTelnyxCall({
  connectionId,
  from,
  linkTo,
  to,
}: {
  connectionId: string;
  from: string;
  linkTo?: string;
  to: string;
}) {
  if (!connectionId) {
    throw new TelnyxError("Telnyx connection ID is not configured");
  }

  if (!from || !to) {
    throw new TelnyxError("Both from and to numbers are required", 400);
  }

  const body: Record<string, unknown> = {
    connection_id: connectionId,
    from,
    to,
  };

  if (linkTo) {
    body.link_to = linkTo;
    body.bridge_intent = true;
  }

  const response = await telnyxFetch("/v2/calls", {
    body: JSON.stringify(body),
    method: "POST",
  });

  if (!response.ok) {
    throw new TelnyxError("Failed to place Telnyx call", response.status);
  }

  return response.json();
}

export async function speakOnTelnyxCall({
  callControlId,
  language = "en-US",
  payload,
  voice = "Polly.Matthew",
}: {
  callControlId: string;
  language?: string;
  payload: string;
  voice?: string;
}) {
  return telnyxFetch(`/v2/calls/${callControlId}/actions/speak`, {
    body: JSON.stringify({ language, payload, voice }),
    method: "POST",
  });
}

export async function startTelnyxRecording(callControlId: string) {
  return telnyxFetch(`/v2/calls/${callControlId}/actions/record_start`, {
    body: JSON.stringify({
      channels: "single",
      format: "mp3",
      max_length: 120,
    }),
    method: "POST",
  });
}

export async function getTelnyxRecording(recordingId: string) {
  return telnyxFetch(`/v2/recordings/${recordingId}`);
}

function normalizePublicKey(publicKey: string) {
  const trimmed = publicKey.trim();

  if (trimmed.includes("BEGIN PUBLIC KEY")) {
    return createPublicKey(trimmed);
  }

  const rawKey = /^[a-f0-9]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");

  if (rawKey.length !== 32) {
    throw new TelnyxError("TELNYX_PUBLIC_KEY must be PEM, base64, or hex Ed25519");
  }

  return createPublicKey({
    format: "der",
    key: Buffer.concat([Buffer.from(ED25519_SPKI_PREFIX, "hex"), rawKey]),
    type: "spki",
  });
}

export function verifyTelnyxWebhookSignature({
  rawBody,
  signature,
  timestamp,
}: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
}) {
  const publicKey = env("TELNYX_PUBLIC_KEY");
  const allowUnverified = env("TELNYX_ALLOW_UNVERIFIED_WEBHOOKS") === "true";

  if (!publicKey) {
    return allowUnverified && process.env.NODE_ENV !== "production";
  }

  if (!signature || !timestamp) {
    return false;
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (ageSeconds > WEBHOOK_TOLERANCE_SEC) {
    return false;
  }

  try {
    return verify(
      null,
      Buffer.from(`${timestamp}|${rawBody}`),
      normalizePublicKey(publicKey),
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}
