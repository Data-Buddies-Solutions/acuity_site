import { directHandoffTokenHash } from "@/lib/call-center/infrastructure/direct-handoff-token";

const MARKER = "~ah1~";
const REDACTED_TOKEN = "[REDACTED]";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function sipUri(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(sip:)?([^@\s]+)@([^@\s]+)$/i.exec(value.trim());
  return match ? { host: match[3]!, scheme: match[1]!, user: match[2]! } : null;
}

function embeddedToken(value: unknown) {
  const uri = sipUri(value);
  if (!uri) return null;
  const marker = uri.user.lastIndexOf(MARKER);
  if (marker < 1) return null;
  return {
    token: uri.user.slice(marker + MARKER.length),
    uri,
    user: uri.user.slice(0, marker),
  };
}

export function directHandoffSipUri(baseUri: string, token: string) {
  const uri = sipUri(baseUri);
  if (
    !uri ||
    uri.scheme?.toLowerCase() !== "sip:" ||
    uri.user.includes(":") ||
    uri.user.includes(MARKER) ||
    !TOKEN_PATTERN.test(token)
  ) {
    throw new Error("DIRECT_HANDOFF_SIP_URI_INVALID");
  }
  return `${uri.scheme}${uri.user}${MARKER}${token}@${uri.host}`;
}

export function hasDirectHandoffIdentity(payload: Record<string, unknown>) {
  return Boolean(embeddedToken(payload.to));
}

/** Hashes and removes the URI bearer token before durable persistence. */
export function redactDirectHandoffToken(payload: Record<string, unknown>) {
  const embedded = embeddedToken(payload.to);
  if (!embedded) return { payload, tokenHash: null };

  return {
    payload: {
      ...payload,
      to: `${embedded.uri.scheme ?? ""}${embedded.user}${MARKER}${REDACTED_TOKEN}@${embedded.uri.host}`,
    },
    tokenHash: embedded.token ? directHandoffTokenHash(embedded.token) : null,
  };
}
