import { NextResponse } from "next/server";

import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { callCenter } from "@/lib/call-center/call-center";
import { CallCenterOperatorError } from "@/lib/call-center/operator-error-response";
import { CALL_CENTER_SCHEMA_VERSION } from "@/lib/call-center/realtime-contract";
import { createLogger, type LogContext } from "@/lib/logger";

const logger = createLogger("portal-call-center-operator-state");

type Dependencies = {
  getActor: () => Promise<QueueAccessActor>;
  now?: () => number;
  readSnapshot?: typeof callCenter.readOperatorState;
  reportRead?: (context: LogContext) => void;
  revision?: string;
};

function nonnegativeHeader(request: Request, name: string) {
  const value = Number.parseInt(request.headers.get(name) ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function createSnapshotHandler({
  getActor,
  now = performance.now.bind(performance),
  readSnapshot = callCenter.readOperatorState,
  reportRead = (context) => logger.info("operator-state-request", context),
  revision = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.K_REVISION ?? "local",
}: Dependencies) {
  return async function GET(request: Request) {
    const startedAt = now();
    const retryAttempt = nonnegativeHeader(request, "x-call-center-retry-attempt");
    const retryDelayMs = nonnegativeHeader(request, "x-call-center-retry-delay-ms");
    const metric = {
      retryAttempt,
      retryDelayMs,
      revision,
      schemaVersion: CALL_CENTER_SCHEMA_VERSION,
    };

    try {
      const parameters = new URL(request.url).searchParams;
      const queueId = parameters.get("queueId")?.trim();
      if (!queueId) {
        throw new CallCenterOperatorError("INVALID_REQUEST", 400);
      }

      const state = await readSnapshot(await getActor(), queueId);
      const durationMs = now() - startedAt;
      reportRead({ ...metric, durationMs, resultClass: "success" });
      return NextResponse.json(state, {
        headers: {
          "Cache-Control": "private, no-store",
          "Server-Timing": `operator-state;dur=${durationMs.toFixed(1)}`,
          "X-Call-Center-Schema-Version": String(CALL_CENTER_SCHEMA_VERSION),
        },
      });
    } catch (error) {
      reportRead({ ...metric, durationMs: now() - startedAt, resultClass: "error" });
      throw error;
    }
  };
}
