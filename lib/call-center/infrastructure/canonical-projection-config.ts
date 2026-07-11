const ENABLED_ENV = "CALL_CENTER_CANONICAL_PROJECTION_ENABLED";

type Environment = Record<string, string | undefined>;

export class InvalidCanonicalProjectionConfigError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "InvalidCanonicalProjectionConfigError";
  }
}

export function resolveCanonicalProjectionConfig(environment: Environment = process.env) {
  const value = environment[ENABLED_ENV]?.trim().toLowerCase();

  if (!value) return { enabled: false } as const;
  if (value !== "true" && value !== "false") {
    throw new InvalidCanonicalProjectionConfigError(
      `${ENABLED_ENV} must be true or false`,
    );
  }

  if (
    value === "true" &&
    environment.CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED?.trim().toLowerCase() !==
      "true"
  ) {
    throw new InvalidCanonicalProjectionConfigError(
      `${ENABLED_ENV} requires CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED=true`,
    );
  }

  return { enabled: value === "true" } as const;
}
