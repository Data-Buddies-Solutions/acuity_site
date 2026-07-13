import { resolveCallCenterActivationConfig } from "@/lib/call-center/infrastructure/call-center-activation-config";

const ENABLED_ENV = "CALL_CENTER_DIRECT_HANDOFF_ENABLED";
const PRACTICE_ENV = "CALL_CENTER_HANDOFF_ABITA_PRACTICE_ID";
const SECRET_ENV = "CALL_CENTER_HANDOFF_ABITA_SECRET";
const SIP_URI_ENV = "CALL_CENTER_DIRECT_HANDOFF_SIP_URI";

type Environment = Record<string, string | undefined>;

export const DIRECT_HANDOFF_TTL_MS = 30_000;

export type DirectHandoffConfig =
  | { enabled: false }
  | { enabled: true; practiceId: string; secret: string; sipUri: string };

export class InvalidDirectHandoffConfigError extends Error {
  readonly status = 503;

  constructor() {
    super("Direct call handoff is not configured");
    this.name = "InvalidDirectHandoffConfigError";
  }
}

function enabledValue(value: string | undefined) {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new InvalidDirectHandoffConfigError();
}

function sipUri(value: string | undefined) {
  const uri = value?.trim() ?? "";
  if (!/^sip:[^\s@]+@[^\s@]+$/i.test(uri)) {
    throw new InvalidDirectHandoffConfigError();
  }
  if (uri.slice(4, uri.indexOf("@")).includes(":")) {
    throw new InvalidDirectHandoffConfigError();
  }
  return uri;
}

/**
 * One default-off switch gates every configured number. Existing handoffs do
 * not call this resolver again, so a rollback stops new admissions without
 * invalidating a token that Acuity already issued.
 */
export function resolveDirectHandoffConfig(
  environment: Environment = process.env,
): DirectHandoffConfig {
  if (!enabledValue(environment[ENABLED_ENV])) return { enabled: false };
  if (!resolveCallCenterActivationConfig(environment).enabled) {
    throw new InvalidDirectHandoffConfigError();
  }

  const practiceId = environment[PRACTICE_ENV]?.trim();
  const secret = environment[SECRET_ENV]?.trim();
  if (!practiceId || !secret) throw new InvalidDirectHandoffConfigError();

  return {
    enabled: true,
    practiceId,
    secret,
    sipUri: sipUri(environment[SIP_URI_ENV]),
  };
}
