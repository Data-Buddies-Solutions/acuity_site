import { prismaShadowRoutingStore } from "@/lib/call-center/infrastructure/prisma-shadow-routing-store";
import { prisma } from "@/lib/prisma";

function countsBy<T extends string>(
  rows: Array<{ _count: { _all: number }; status: T }>,
) {
  return Object.fromEntries(
    rows
      .map(({ _count, status }) => [status, _count._all] as const)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

try {
  const [
    legacyRows,
    canonicalRows,
    commandRows,
    callRows,
    shadowDecisionCount,
    missingShadowDecisionCount,
  ] = await Promise.all([
    prisma.providerWebhookEvent
      .groupBy({
        _count: { _all: true },
        by: ["processingStatus"],
      })
      .then((rows) =>
        rows.map(({ _count, processingStatus }) => ({
          _count,
          status: processingStatus,
        })),
      ),
    prisma.providerWebhookEvent
      .groupBy({
        _count: { _all: true },
        by: ["canonicalProjectionStatus"],
      })
      .then((rows) =>
        rows.map(({ _count, canonicalProjectionStatus }) => ({
          _count,
          status: canonicalProjectionStatus,
        })),
      ),
    prisma.callCenterCommand.groupBy({
      _count: { _all: true },
      by: ["status"],
    }),
    prisma.callCenterCall.groupBy({
      _count: { _all: true },
      by: ["status"],
    }),
    prisma.callCenterEvent.count({
      where: { type: "CALL_ROUTING_SHADOW_DECIDED" },
    }),
    prismaShadowRoutingStore.countMissingDecisions(),
  ]);

  console.log(
    JSON.stringify({
      calls: countsBy(callRows),
      canonicalProjection: countsBy(canonicalRows),
      commands: countsBy(commandRows),
      generatedAt: new Date().toISOString(),
      legacyProjection: countsBy(legacyRows),
      missingShadowDecisionCount,
      shadowDecisionCount,
    }),
  );
} finally {
  await prisma.$disconnect();
}
