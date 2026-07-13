import { directHandoffTokenHash } from "@/lib/call-center/infrastructure/direct-handoff-token";

export const DIRECT_HANDOFF_ID_HEADER = "X-Acuity-Handoff-Id";
export const DIRECT_HANDOFF_TOKEN_HEADER = "X-Acuity-Handoff-Token";
const REDACTED_TOKEN = "[REDACTED]";
const HANDOFF_HEADER = "x-acuity-handoff";
const HANDOFF_TARGET_HEADER = "x-acuity-handoff-target";

export type DirectHandoffIdentity = {
  handoffId: string;
  token: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function add(headers: Map<string, string>, name: unknown, value: unknown) {
  const key = text(name).toLowerCase();
  const headerValue = text(value);
  if (key && headerValue) headers.set(key, headerValue);
}

function collect(value: unknown, headers: Map<string, string>) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        const separator = item.indexOf(":");
        if (separator > 0)
          add(headers, item.slice(0, separator), item.slice(separator + 1));
        continue;
      }

      const entry = record(item);
      if (!entry) continue;
      add(
        headers,
        text(entry.name) ||
          text(entry.key) ||
          text(entry.header) ||
          text(entry.header_name),
        text(entry.value) || text(entry.header_value),
      );
    }
    return;
  }

  const entries = record(value);
  if (!entries) return;
  for (const [name, value] of Object.entries(entries)) {
    const entry = record(value);
    add(
      headers,
      entry ? text(entry.name) || text(entry.key) || text(entry.header) || name : name,
      entry ? text(entry.value) || text(entry.header_value) : value,
    );
  }
}

function redactToken(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactToken);
  if (typeof value === "string") {
    const separator = value.indexOf(":");
    return separator > 0 &&
      value.slice(0, separator).trim().toLowerCase() ===
        DIRECT_HANDOFF_TOKEN_HEADER.toLowerCase()
      ? `${value.slice(0, separator)}: ${REDACTED_TOKEN}`
      : value;
  }

  const source = record(value);
  if (!source) return value;
  const headerName =
    text(source.name) ||
    text(source.key) ||
    text(source.header) ||
    text(source.header_name);
  const isTokenEntry =
    headerName.toLowerCase() === DIRECT_HANDOFF_TOKEN_HEADER.toLowerCase();
  return Object.fromEntries(
    Object.entries(source).map(([key, entry]) => {
      const isTokenKey = key.toLowerCase() === DIRECT_HANDOFF_TOKEN_HEADER.toLowerCase();
      const isTokenValue = isTokenEntry && (key === "value" || key === "header_value");
      return [key, isTokenKey || isTokenValue ? REDACTED_TOKEN : redactToken(entry)];
    }),
  );
}

/** Removes the bearer-like token before the durable provider envelope is stored. */
export function redactDirectHandoffToken(payload: Record<string, unknown>) {
  const headers = new Map<string, string>();
  collect(payload.sip_headers, headers);
  collect(payload.custom_headers, headers);
  const token = headers.get(DIRECT_HANDOFF_TOKEN_HEADER.toLowerCase()) ?? "";
  return {
    payload: token ? (redactToken(payload) as Record<string, unknown>) : payload,
    tokenHash: token ? directHandoffTokenHash(token) : null,
  };
}

/** Reads the provider shapes Telnyx has emitted without logging token data. */
export function directHandoffIdentity(payload: Record<string, unknown>) {
  const headers = new Map<string, string>();
  collect(payload.sip_headers, headers);
  collect(payload.custom_headers, headers);

  const handoffId = headers.get(DIRECT_HANDOFF_ID_HEADER.toLowerCase()) ?? "";
  const token = headers.get(DIRECT_HANDOFF_TOKEN_HEADER.toLowerCase()) ?? "";
  const declaredDirect =
    headers.get(HANDOFF_HEADER)?.toLowerCase() === "call-center" &&
    /^sip:/i.test(headers.get(HANDOFF_TARGET_HEADER) ?? "");
  if (!handoffId && !token && !declaredDirect) return null;
  if (!handoffId || !token || handoffId.length > 128 || token.length > 256) {
    throw new Error("DIRECT_HANDOFF_IDENTITY_INVALID");
  }
  return { handoffId, token } satisfies DirectHandoffIdentity;
}
