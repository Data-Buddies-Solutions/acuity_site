import { Prisma } from "@/generated/prisma/client";
import { settleCanonicalCallLegs } from "@/lib/call-center/infrastructure/prisma-call-resource-settlement";

export async function settleCompetingAgentOffers(
  transaction: Prisma.TransactionClient,
  input: {
    endpointId: string;
    now: Date;
    practiceId: string;
    winningCallId: string;
  },
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_endpoint" WHERE "id" = ${input.endpointId} FOR UPDATE`,
  );
  const offers = await transaction.callCenterCallLeg.findMany({
    orderBy: [{ callId: "asc" }, { id: "asc" }],
    select: { callId: true, id: true },
    where: {
      call: { practiceId: input.practiceId },
      callId: { not: input.winningCallId },
      endpointId: input.endpointId,
      kind: "AGENT",
      status: { in: ["CREATED", "DIALING", "RINGING"] },
    },
  });

  const callIds = [...new Set(offers.map(({ callId }) => callId))];
  for (const callId of callIds) {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "id" = ${callId} FOR UPDATE`,
    );
  }

  const commandIds: string[] = [];
  for (const offer of offers) {
    commandIds.push(
      ...(await settleCanonicalCallLegs(transaction, {
        callId: offer.callId,
        hangupIdempotencyKeys: {
          [offer.id]: `winner:${input.winningCallId}:hangup:${offer.id}`,
        },
        legIds: [offer.id],
        now: input.now,
        reason: "AGENT_CONNECTED_ELSEWHERE",
      })),
    );
    await transaction.callCenterCall.update({
      data: { stateVersion: { increment: 1 } },
      where: { id: offer.callId },
    });
    const idempotencyKey = `winner:${input.winningCallId}:settle:${offer.id}`;
    const event = await transaction.callCenterEvent.findFirst({
      select: { revision: true },
      where: {
        aggregateId: offer.callId,
        idempotencyKey,
        practiceId: input.practiceId,
        type: "CALL_AGENT_OFFER_ENDED",
      },
    });
    if (!event) {
      await transaction.callCenterEvent.create({
        data: {
          aggregateId: offer.callId,
          aggregateType: "CALL",
          data: {
            endpointId: input.endpointId,
            legId: offer.id,
            reason: "AGENT_CONNECTED_ELSEWHERE",
            winningCallId: input.winningCallId,
          },
          idempotencyKey,
          occurredAt: input.now,
          practiceId: input.practiceId,
          type: "CALL_AGENT_OFFER_ENDED",
        },
      });
    }
  }
  return [...new Set(commandIds)];
}
