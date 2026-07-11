import { bootstrapLegacyCallCenterConfiguration } from "@/lib/call-center/application/bootstrap-legacy-configuration";
import { PrismaLegacyConfigurationBootstrapRepository } from "@/lib/call-center/infrastructure/prisma-legacy-configuration-bootstrap";
import { prisma } from "@/lib/prisma";

const [
  practiceId,
  expectedReportVersion,
  actor,
  triggeringActor,
  runId,
  runAttemptInput,
] = process.argv.slice(2);

function fail(code: string): never {
  throw new Error(code);
}

async function main() {
  if (
    !practiceId ||
    !expectedReportVersion ||
    !actor ||
    !triggeringActor ||
    !runId ||
    !runAttemptInput
  ) {
    fail("BOOTSTRAP_ARGUMENTS_REQUIRED");
  }
  if (!/^[a-f0-9]{64}$/.test(expectedReportVersion)) {
    fail("BOOTSTRAP_REPORT_VERSION_INVALID");
  }
  const validActor = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  if (!validActor.test(actor) || !validActor.test(triggeringActor)) {
    fail("BOOTSTRAP_EXTERNAL_ACTOR_INVALID");
  }
  if (!/^\d{1,20}$/.test(runId)) {
    fail("BOOTSTRAP_RUN_ID_INVALID");
  }
  const runAttempt = Number(runAttemptInput);
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) {
    fail("BOOTSTRAP_RUN_ATTEMPT_INVALID");
  }

  const saved = await bootstrapLegacyCallCenterConfiguration(
    new PrismaLegacyConfigurationBootstrapRepository(),
    {
      audit: { actor, triggeringActor, runId, runAttempt },
      expectedReportVersion,
      practiceId,
    },
  );

  console.log(
    JSON.stringify({
      changed: saved.changed,
      configurationVersion: saved.version,
      counts: {
        endpoints: saved.configuration.endpoints.length,
        memberships: saved.configuration.queues.reduce(
          (count, queue) => count + queue.members.length,
          0,
        ),
        numbers: saved.configuration.numbers.length,
        queues: saved.configuration.queues.length,
      },
      practiceId,
      reportVersion: saved.reportVersion,
      routingModes: [
        ...new Set(saved.configuration.queues.map(({ routingMode }) => routingMode)),
      ].sort(),
    }),
  );
}

try {
  await main();
} catch (error) {
  const code =
    error instanceof Error && /^BOOTSTRAP_[A-Z_]+$/.test(error.message)
      ? error.message
      : "BOOTSTRAP_FAILED";
  console.error(JSON.stringify({ errorCode: code }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
