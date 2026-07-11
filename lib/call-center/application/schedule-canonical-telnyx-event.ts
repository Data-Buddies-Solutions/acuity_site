import { processCanonicalTelnyxEvent } from "@/lib/call-center/application/project-canonical-telnyx-event";
import { resolveCanonicalProjectionConfig } from "@/lib/call-center/infrastructure/canonical-projection-config";
import { createLogger } from "@/lib/logger";

const logger = createLogger("call-center-canonical-immediate");
const SCHEDULE_ERROR = "canonical_projection_schedule_failed";
const CALLBACK_ERROR = "canonical_projection_callback_failed";

export type PostResponseScheduler = (task: () => Promise<void>) => void;

type Dependencies = {
  config?: typeof resolveCanonicalProjectionConfig;
  processEvent: typeof processCanonicalTelnyxEvent;
};

export function createImmediateCanonicalProjection({
  config = resolveCanonicalProjectionConfig,
  processEvent,
}: Dependencies) {
  return function scheduleCanonicalProjection(
    eventId: string,
    schedule: PostResponseScheduler,
  ) {
    try {
      if (!config().enabled) return false;

      schedule(async () => {
        try {
          await processEvent(eventId);
        } catch {
          logger.warn("immediate canonical projection callback failed", {
            errorCode: CALLBACK_ERROR,
          });
        }
      });
      return true;
    } catch {
      logger.warn("immediate canonical projection was not scheduled", {
        errorCode: SCHEDULE_ERROR,
      });
      return false;
    }
  };
}

export const scheduleImmediateCanonicalProjection = createImmediateCanonicalProjection({
  processEvent: processCanonicalTelnyxEvent,
});
