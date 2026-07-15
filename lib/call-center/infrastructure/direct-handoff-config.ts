import { directHandoffSipUri } from "@/lib/call-center/infrastructure/direct-handoff-uri";

const PRACTICE_ENV = "CALL_CENTER_HANDOFF_ABITA_PRACTICE_ID";
const SECRET_ENV = "CALL_CENTER_HANDOFF_ABITA_SECRET";
const SIP_URI_ENV = "CALL_CENTER_DIRECT_HANDOFF_SIP_URI";

type Environment = Record<string, string | undefined>;

export const DIRECT_HANDOFF_TTL_MS = 30_000;

export type DirectHandoffConfig = {
  practiceId: string;
  secret: string;
  sipUri: string;
};

export class InvalidDirectHandoffConfigError extends Error {
  readonly status = 503;

  constructor() {
    super("Direct call handoff is not configured");
    this.name = "InvalidDirectHandoffConfigError";
  }
}

function sipUri(value: string | undefined) {
  const uri = value?.trim() ?? "";
  try {
    directHandoffSipUri(uri, "a".repeat(43));
  } catch {
    throw new InvalidDirectHandoffConfigError();
  }
  return uri;
}

/** Resolves the operational credentials and SIP ingress for direct handoff. */
export function resolveDirectHandoffConfig(
  environment: Environment = process.env,
): DirectHandoffConfig {
  const practiceId = environment[PRACTICE_ENV]?.trim();
  const secret = environment[SECRET_ENV]?.trim();
  if (!practiceId || !secret) throw new InvalidDirectHandoffConfigError();

  return {
    practiceId,
    secret,
    sipUri: sipUri(environment[SIP_URI_ENV]),
  };
}
