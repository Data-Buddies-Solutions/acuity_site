import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

function argValue(names: string[]) {
  for (const [index, arg] of process.argv.entries()) {
    for (const name of names) {
      if (arg === name) {
        return process.argv[index + 1];
      }
      if (arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1);
      }
    }
  }

  return undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const callId = argValue(["--call-id", "--callId"]);
const force = process.argv.includes("--force");
const limit = parsePositiveInt(argValue(["--limit"]) ?? process.argv[2], 10);

const {
  processAgentCallReviewByCallId,
  processPendingAgentCallReviews,
  resetStaleRunningAgentCallReviews,
} = await import("../lib/call-review/runner");
const { prisma } = await import("../lib/prisma");

try {
  await resetStaleRunningAgentCallReviews();

  if (callId) {
    const result = await processAgentCallReviewByCallId(callId, { force });
    console.log(
      `[calls:review] ${result.reviewStatus} callId=${result.callId} ok=${result.ok}`,
    );
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
    }
  } else {
    const results = await processPendingAgentCallReviews(limit);
    const succeeded = results.filter((result) => result.ok).length;
    const failed = results.length - succeeded;

    console.log(
      `[calls:review] Processed ${results.length} pending reviews (${succeeded} succeeded, ${failed} failed)`,
    );

    for (const result of results) {
      if (!result.ok) {
        console.error(`[calls:review] ${result.callId}: ${result.error}`);
      }
    }

    if (failed > 0) {
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
