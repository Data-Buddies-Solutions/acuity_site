const ENABLED_ENV = "CALL_CENTER_CANONICAL_COMMAND_DISPATCH_ENABLED";

type Environment = Record<string, string | undefined>;

export type CanonicalCommandDispatchConfig = Readonly<{ enabled: boolean }>;

export class InvalidCanonicalCommandDispatchConfigError extends Error {
  readonly code = "INVALID_CANONICAL_COMMAND_DISPATCH_CONFIG";
  readonly status = 503;

  constructor() {
    super("Canonical command dispatch configuration is invalid");
    this.name = "InvalidCanonicalCommandDispatchConfigError";
  }
}

export function resolveCanonicalCommandDispatchConfig(
  environment: Environment = process.env,
): CanonicalCommandDispatchConfig {
  const value = environment[ENABLED_ENV];

  if (value === undefined) return { enabled: false };
  if (value === "true") return { enabled: true };
  if (value === "false") return { enabled: false };

  throw new InvalidCanonicalCommandDispatchConfigError();
}
