import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_STALE_RUNNING_MINUTES = 30;

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

const { processPendingAgentCallReviews, resetStaleRunningAgentCallReviews } =
  await import("../lib/call-review/runner");
const { prisma } = await import("../lib/prisma");

const batchSize = parsePositiveInt(
  process.env.CALL_REVIEW_BATCH_SIZE ?? process.env.REVIEW_BATCH_SIZE,
  DEFAULT_BATCH_SIZE,
);
const pollIntervalMs = parsePositiveInt(
  process.env.CALL_REVIEW_POLL_INTERVAL_MS ?? process.env.REVIEW_POLL_INTERVAL_MS,
  DEFAULT_POLL_INTERVAL_MS,
);
const staleRunningMinutes = parsePositiveInt(
  process.env.CALL_REVIEW_STALE_RUNNING_MINUTES,
  DEFAULT_STALE_RUNNING_MINUTES,
);
const exitWhenIdle = process.env.CALL_REVIEW_EXIT_WHEN_IDLE === "1";

let shouldStop = false;
const stop = () => {
  shouldStop = true;
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log(
  `[calls:review:worker] Starting worker (batchSize=${batchSize}, pollIntervalMs=${pollIntervalMs})`,
);

try {
  while (!shouldStop) {
    const startedAt = Date.now();
    const resetCount = await resetStaleRunningAgentCallReviews(staleRunningMinutes);
    if (resetCount > 0) {
      console.log(`[calls:review:worker] Requeued ${resetCount} stale running reviews`);
    }

    const results = await processPendingAgentCallReviews(batchSize);
    const succeeded = results.filter((result) => result.ok).length;
    const failed = results.length - succeeded;

    if (results.length > 0) {
      console.log(
        `[calls:review:worker] Processed ${results.length} pending reviews (${succeeded} succeeded, ${failed} failed)`,
      );
      for (const result of results) {
        if (!result.ok) {
          console.error(`[calls:review:worker] ${result.callId}: ${result.error}`);
        }
      }
    } else {
      console.log("[calls:review:worker] No pending reviews found");
      if (exitWhenIdle) {
        break;
      }
    }

    if (shouldStop) {
      break;
    }

    const elapsedMs = Date.now() - startedAt;
    const delayMs = results.length > 0 ? 0 : Math.max(pollIntervalMs - elapsedMs, 0);
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  console.log("[calls:review:worker] Stopped");
}
