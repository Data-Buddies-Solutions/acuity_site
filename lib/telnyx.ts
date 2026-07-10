import { createPublicKey, verify } from "crypto";

const TELNYX_API_BASE = "https://api.telnyx.com";
const TELNYX_REQUEST_TIMEOUT_MS = 10_000;
const ED25519_SPKI_PREFIX = "302a300506032b6570032100";
const WEBHOOK_TOLERANCE_SEC = 5 * 60;

export class TelnyxError extends Error {
  status: number;
  detail?: string;

  constructor(message: string, status = 500, detail?: string) {
    super(message);
    this.name = "TelnyxError";
    this.status = status;
    this.detail = detail;
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
    signal: options.signal ?? AbortSignal.timeout(TELNYX_REQUEST_TIMEOUT_MS),
  });

  return response;
}

export async function telnyxErrorMessage(response: Response, fallback: string) {
  const text = await response.text().catch(() => "");

  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    const errors =
      parsed &&
      typeof parsed === "object" &&
      "errors" in parsed &&
      Array.isArray((parsed as { errors?: unknown }).errors)
        ? (parsed as { errors: Array<Record<string, unknown>> }).errors
        : [];
    const details = errors
      .map((error) =>
        [error.title, error.detail].filter((part) => typeof part === "string").join(": "),
      )
      .filter(Boolean);

    return details.length ? details.join("; ") : text;
  } catch {
    return text;
  }
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
  bridgeOnAnswer,
  bridgeIntent,
  clientState,
  commandId,
  connectionId,
  from,
  linkTo,
  preventDoubleBridge,
  signal,
  timeoutSecs,
  to,
}: {
  bridgeOnAnswer?: boolean;
  bridgeIntent?: boolean;
  clientState?: string;
  commandId?: string;
  connectionId: string;
  from: string;
  linkTo?: string;
  preventDoubleBridge?: boolean;
  signal?: AbortSignal;
  timeoutSecs?: number;
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
    body.bridge_intent = bridgeIntent ?? true;
    body.bridge_on_answer = bridgeOnAnswer ?? true;
    body.prevent_double_bridge = preventDoubleBridge ?? true;
  }

  if (clientState) {
    body.client_state = clientState;
  }

  if (commandId) {
    body.command_id = commandId;
  }

  if (timeoutSecs) {
    body.timeout_secs = timeoutSecs;
  }

  const response = await telnyxFetch("/v2/calls", {
    body: JSON.stringify(body),
    method: "POST",
    signal,
  });

  if (!response.ok) {
    throw new TelnyxError(
      "Failed to place Telnyx call",
      response.status,
      await telnyxErrorMessage(response, "Failed to place Telnyx call"),
    );
  }

  return response.json();
}

export async function speakOnTelnyxCall({
  callControlId,
  commandId,
  language = "en-US",
  payload,
  signal,
  voice = "Polly.Matthew",
}: {
  callControlId: string;
  commandId?: string;
  language?: string;
  payload: string;
  signal?: AbortSignal;
  voice?: string;
}) {
  return telnyxFetch(`/v2/calls/${callControlId}/actions/speak`, {
    body: JSON.stringify({
      ...(commandId ? { command_id: commandId } : {}),
      language,
      payload,
      voice,
    }),
    method: "POST",
    signal,
  });
}

export async function startTelnyxPlayback({
  audioType = "wav",
  callControlId,
  commandId,
  loop = 1,
  playbackContent,
  signal,
}: {
  audioType?: "mp3" | "wav";
  callControlId: string;
  commandId?: string;
  loop?: number | "infinity";
  playbackContent: string;
  signal?: AbortSignal;
}) {
  return telnyxFetch(`/v2/calls/${callControlId}/actions/playback_start`, {
    body: JSON.stringify({
      audio_type: audioType,
      cache_audio: true,
      loop,
      playback_content: playbackContent,
      target_legs: "self",
      ...(commandId ? { command_id: commandId } : {}),
    }),
    method: "POST",
    signal,
  });
}

export async function stopTelnyxPlayback(
  callControlId: string,
  commandId?: string,
  signal?: AbortSignal,
) {
  return telnyxFetch(`/v2/calls/${callControlId}/actions/playback_stop`, {
    body: JSON.stringify({
      ...(commandId ? { command_id: commandId } : {}),
      stop: "all",
    }),
    method: "POST",
    signal,
  });
}

export async function answerTelnyxCall(
  callControlId: string,
  commandId?: string,
  signal?: AbortSignal,
) {
  return telnyxFetch(`/v2/calls/${callControlId}/actions/answer`, {
    body: JSON.stringify(commandId ? { command_id: commandId } : {}),
    method: "POST",
    signal,
  });
}

export async function hangupTelnyxCall(
  callControlId: string,
  commandId?: string,
  signal?: AbortSignal,
) {
  const response = await telnyxFetch(`/v2/calls/${callControlId}/actions/hangup`, {
    body: JSON.stringify(commandId ? { command_id: commandId } : {}),
    method: "POST",
    signal,
  });

  if (!response.ok) {
    throw new TelnyxError(
      "Failed to hang up Telnyx call",
      response.status,
      await telnyxErrorMessage(response, "Failed to hang up Telnyx call"),
    );
  }

  return response;
}

export async function bridgeTelnyxCall({
  callControlId,
  commandId,
  signal,
  targetCallControlId,
}: {
  callControlId: string;
  commandId?: string;
  signal?: AbortSignal;
  targetCallControlId: string;
}) {
  return telnyxFetch(`/v2/calls/${callControlId}/actions/bridge`, {
    body: JSON.stringify({
      call_control_id: targetCallControlId,
      ...(commandId ? { command_id: commandId } : {}),
    }),
    method: "POST",
    signal,
  });
}

export async function startTelnyxRecording(
  callControlId: string,
  commandId?: string,
  signal?: AbortSignal,
) {
  const response = await telnyxFetch(`/v2/calls/${callControlId}/actions/record_start`, {
    body: JSON.stringify({
      channels: "single",
      ...(commandId ? { command_id: commandId } : {}),
      format: "mp3",
      max_length: 120,
    }),
    method: "POST",
    signal,
  });

  if (!response.ok) {
    throw new TelnyxError(
      "Failed to start Telnyx recording",
      response.status,
      await telnyxErrorMessage(response, "Failed to start Telnyx recording"),
    );
  }

  return response;
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
