import { describe, expect, it } from "bun:test";

import { settleCompetingAgentOffers } from "../prisma-agent-offer-settlement";

describe("competing agent offers", () => {
  it("ends the winning agent's other ringing legs in the winner transaction", async () => {
    const operations: string[] = [];
    const offer = { callId: "call-2", id: "leg-2", status: "RINGING" };
    const transaction = {
      $queryRaw: async (query: { strings: readonly string[] }) => {
        const sql = query.strings.join("");
        operations.push(
          sql.includes("call_center_endpoint") ? "endpoint.lock" : "call.lock",
        );
        return [];
      },
      callCenterCall: {
        findUnique: async ({ select }: { select: Record<string, boolean> }) =>
          select.practiceId
            ? { practiceId: "practice-1" }
            : { deadlineAt: null, status: "RINGING", winningLegId: null },
        update: async () => {
          operations.push("call.bump");
          return {};
        },
      },
      callCenterCallLeg: {
        findMany: async ({ where }: { where: Record<string, unknown> }) =>
          "call" in where
            ? [{ callId: offer.callId, id: offer.id }]
            : [
                {
                  id: offer.id,
                  providerCallControlId: null,
                  status: offer.status,
                },
              ],
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          offer.status = String(data.status);
          operations.push("leg.end");
          return { count: 1 };
        },
      },
      callCenterCommand: {
        findMany: async () => [],
      },
      callCenterEvent: {
        create: async () => {
          operations.push("event.create");
          return { revision: BigInt(1) };
        },
        findFirst: async () => null,
      },
    };

    await expect(
      settleCompetingAgentOffers(transaction as never, {
        endpointId: "endpoint-1",
        now: new Date("2026-07-18T12:00:00.000Z"),
        practiceId: "practice-1",
        winningCallId: "call-1",
      }),
    ).resolves.toEqual([]);

    expect(offer.status).toBe("ENDED");
    expect(operations).toEqual([
      "endpoint.lock",
      "call.lock",
      "leg.end",
      "call.bump",
      "event.create",
    ]);
  });
});
