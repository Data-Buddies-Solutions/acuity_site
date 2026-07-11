const ENABLED_ENV = "CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED";
const RETENTION_APPROVED_ENV = "CALL_CENTER_WEBHOOK_PAYLOAD_RETENTION_APPROVED";
const RETENTION_DAYS_ENV = "CALL_CENTER_WEBHOOK_RETENTION_DAYS";
const MAX_RETENTION_DAYS = 30;

type Environment = Record<string, string | undefined>;

export type DurableWebhookIngressConfig =
  { enabled: false } | { enabled: true; payloadRetentionDays: number };

export class InvalidDurableWebhookIngressConfigError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "InvalidDurableWebhookIngressConfigError";
  }
}

/**
 * Draft-only gate. Do not enable raw webhook persistence until retention purge
 * and failed-event recovery controls exist and the retention window is approved.
 */
export function resolveDurableWebhookIngressConfig(
  environment: Environment = process.env,
): DurableWebhookIngressConfig {
  const enabled = environment[ENABLED_ENV]?.trim().toLowerCase();

  if (!enabled || enabled === "false") {
    return { enabled: false };
  }

  if (enabled !== "true") {
    throw new InvalidDurableWebhookIngressConfigError(
      `${ENABLED_ENV} must be true or false`,
    );
  }

  if (environment[RETENTION_APPROVED_ENV]?.trim().toLowerCase() !== "true") {
    throw new InvalidDurableWebhookIngressConfigError(
      "Durable webhook payload retention is not approved",
    );
  }

  const retentionDays = environment[RETENTION_DAYS_ENV]?.trim() ?? "";

  if (!/^\d+$/.test(retentionDays)) {
    throw new InvalidDurableWebhookIngressConfigError(
      `${RETENTION_DAYS_ENV} must be a whole number`,
    );
  }

  const payloadRetentionDays = Number(retentionDays);

  if (payloadRetentionDays < 1 || payloadRetentionDays > MAX_RETENTION_DAYS) {
    throw new InvalidDurableWebhookIngressConfigError(
      `${RETENTION_DAYS_ENV} must be between 1 and ${MAX_RETENTION_DAYS}`,
    );
  }

  return { enabled: true, payloadRetentionDays };
}
