import { processCanonicalTelnyxEvent } from "@/lib/call-center/application/project-canonical-telnyx-event";
import { createLogger } from "@/lib/logger";

const logger = createLogger("call-center-canonical-immediate");
const SCHEDULE_ERROR = "canonical_projection_schedule_failed";
const CALLBACK_ERROR = "canonical_projection_callback_failed";

export type PostResponseScheduler = (task: () => Promise<void>) => void;

type Dependencies = {
  processEvent: typeof processCanonicalTelnyxEvent;
};

export function createImmediateCanonicalProjection({ processEvent }: Dependencies) {
  return function scheduleCanonicalProjection(
    eventId: string,
    schedule: PostResponseScheduler,
  ) {
    try {
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
