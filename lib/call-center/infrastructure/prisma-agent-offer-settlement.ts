import { Prisma } from "@/generated/prisma/client";
import { settleCanonicalCallLegs } from "@/lib/call-center/infrastructure/prisma-call-resource-settlement";

type AgentOfferSettlementInput = {
  endpointId: string;
  now: Date;
  practiceId: string;
  winningCallId: string;
};

export type AgentOfferSettlementResources = {
  offers: readonly { callId: string; id: string }[];
};

export async function lockAgentOfferSettlementResources(
  transaction: Prisma.TransactionClient,
  input: AgentOfferSettlementInput,
): Promise<AgentOfferSettlementResources> {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_endpoint" WHERE "id" = ${input.endpointId} FOR UPDATE`,
  );
  const offers = await transaction.callCenterCallLeg.findMany({
    orderBy: [{ callId: "asc" }, { id: "asc" }],
    select: { callId: true, id: true },
    where: {
      call: { practiceId: input.practiceId },
      endpointId: input.endpointId,
      kind: "AGENT",
      status: { in: ["CREATED", "DIALING", "RINGING"] },
    },
  });
  const callIds = [
    ...new Set([input.winningCallId, ...offers.map(({ callId }) => callId)]),
  ].sort();
  for (const callId of callIds) {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "id" = ${callId} FOR UPDATE`,
    );
  }
  return {
    offers: offers.filter(({ callId }) => callId !== input.winningCallId),
  };
}

export async function settleCompetingAgentOffers(
  transaction: Prisma.TransactionClient,
  input: AgentOfferSettlementInput,
  resources: AgentOfferSettlementResources,
) {
  const commandIds: string[] = [];
  for (const offer of resources.offers) {
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
