import { resolveCanonicalProjectionConfig } from "@/lib/call-center/infrastructure/canonical-projection-config";
import { resolveDurableWebhookIngressConfig } from "@/lib/call-center/infrastructure/durable-ingress-config";

const ACTIVATION_ENV = "CALL_CENTER_CANONICAL_ACTIVATION_ENABLED";

type Environment = Record<string, string | undefined>;

export type CallCenterActivationConfig = Readonly<{ enabled: boolean }>;

export class InvalidCallCenterActivationConfigError extends Error {
  readonly code = "INVALID_CALL_CENTER_ACTIVATION_CONFIG";
  readonly status = 503;

  constructor() {
    super("Call center activation configuration is invalid");
    this.name = "InvalidCallCenterActivationConfigError";
  }
}

function booleanValue(value: string | undefined) {
  if (value === undefined) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new InvalidCallCenterActivationConfigError();
}

export function assertCallCenterActivationPrerequisites(
  environment: Environment = process.env,
) {
  try {
    const ingress = resolveDurableWebhookIngressConfig(environment);
    const projection = resolveCanonicalProjectionConfig(environment);
    if (!ingress.enabled || !projection.enabled) {
      throw new InvalidCallCenterActivationConfigError();
    }
  } catch {
    throw new InvalidCallCenterActivationConfigError();
  }
}

/** One fail-closed switch owns new canonical admissions and frontend actions. */
export function resolveCallCenterActivationConfig(
  environment: Environment = process.env,
): CallCenterActivationConfig {
  const enabled = booleanValue(environment[ACTIVATION_ENV]);
  if (enabled) assertCallCenterActivationPrerequisites(environment);
  return { enabled };
}
