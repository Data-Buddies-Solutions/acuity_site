import { recoverProviderWebhooks } from "@/lib/call-center/application/recover-provider-webhooks";
import { InvalidCanonicalProjectionConfigError } from "@/lib/call-center/infrastructure/canonical-projection-config";
import { InvalidDurableWebhookIngressConfigError } from "@/lib/call-center/infrastructure/durable-ingress-config";
import { createLogger } from "@/lib/logger";

const logger = createLogger("call-center-webhook-recovery");
const RECOVERY_ERROR = "call_center_webhook_recovery_failed";
type Environment = Record<string, string | undefined>;

type RecoveryHandlerDependencies = {
  environment?: Environment;
  recover?: typeof recoverProviderWebhooks;
};

export function createCallCenterRecoveryHandler({
  environment = process.env,
  recover = recoverProviderWebhooks,
}: RecoveryHandlerDependencies = {}) {
  return async function GET(request: Request) {
    const secret = environment.CRON_SECRET?.trim();

    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const result = await recover();
      return Response.json({ ok: true, ...result });
    } catch (error) {
      logger.error("call center webhook recovery failed", {
        errorCode: RECOVERY_ERROR,
      });
      return Response.json(
        { error: RECOVERY_ERROR, ok: false },
        {
          status:
            error instanceof InvalidDurableWebhookIngressConfigError ||
            error instanceof InvalidCanonicalProjectionConfigError
              ? 503
              : 500,
        },
      );
    }
  };
}
