import { z } from "zod";

import { parseJsonBody } from "@/lib/api/handler";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";
import { createLogger, type LogContext } from "@/lib/logger";

const logger = createLogger("portal-call-center-answer-timing");
const bodySchema = z
  .object({
    agentSessionId: z.string().trim().min(1).max(200),
    callId: z.string().trim().min(1).max(200),
    callLegId: z.string().trim().min(1).max(200),
    elapsedMs: z.number().finite().min(0).max(120_000),
    phase: z.enum(["CLAIM_COMPLETED", "CLICKED", "FAILED", "SDK_ACTIVE"]),
    serverDurationMs: z.number().finite().min(0).max(120_000).optional(),
  })
  .strict();

type Actor = { practiceId: string; userId: string };

export function createAnswerTimingHandler({
  authorize,
  getActor,
  report = (timing) => logger.info("Answer phase", timing),
}: {
  authorize: (actor: Actor, timing: z.infer<typeof bodySchema>) => Promise<boolean>;
  getActor: () => Promise<Actor>;
  report?: (timing: LogContext) => void;
}) {
  return withCallCenterApiHandler(
    async (request: Request) => {
      const [actor, timing] = await Promise.all([
        getActor(),
        parseJsonBody(request, bodySchema),
      ]);
      if (!(await authorize(actor, timing))) {
        return new Response(null, { status: 202 });
      }
      queueMicrotask(() => {
        try {
          report({ ...timing, ...actor });
        } catch {
          // Observability delivery must not affect the operator action.
        }
      });
      return new Response(null, { status: 202 });
    },
    {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "[portal-call-center] Answer timing rejected",
      retryable: true,
    },
  );
}
