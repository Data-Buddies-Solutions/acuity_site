import type { ProviderCommandDispatchResult } from "@/lib/call-center/application/dispatch-provider-command";
import { dispatchProviderCommand } from "@/lib/call-center/application/provider-command-runtime";
import type { PostResponseScheduler } from "@/lib/call-center/application/schedule-canonical-telnyx-event";
import { createLogger } from "@/lib/logger";

const logger = createLogger("call-center-command-immediate");
const SCHEDULE_ERROR = "provider_command_schedule_failed";
const CALLBACK_ERROR = "provider_command_callback_failed";

type Dependencies = {
  dispatch: (commandId: string) => Promise<ProviderCommandDispatchResult>;
};

export function createImmediateProviderCommandDispatch({ dispatch }: Dependencies) {
  return function scheduleProviderCommand(
    commandId: string,
    schedule: PostResponseScheduler,
  ) {
    try {
      schedule(async () => {
        try {
          await dispatch(commandId);
        } catch {
          logger.warn("immediate provider command callback failed", {
            errorCode: CALLBACK_ERROR,
          });
        }
      });
      return true;
    } catch {
      logger.warn("immediate provider command was not scheduled", {
        errorCode: SCHEDULE_ERROR,
      });
      return false;
    }
  };
}

export const scheduleImmediateProviderCommand = createImmediateProviderCommandDispatch({
  dispatch: dispatchProviderCommand,
});
