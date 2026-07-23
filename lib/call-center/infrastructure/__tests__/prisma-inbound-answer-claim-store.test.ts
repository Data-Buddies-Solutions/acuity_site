import { describe, expect, it } from "bun:test";

import { PrismaInboundAnswerClaimStore } from "../prisma-inbound-answer-claim-store";

describe("inbound Answer database locks", () => {
  it("locks the endpoint before the call row", async () => {
    const operations: string[] = [];
    const transaction = {
      $queryRaw: async (query: { strings: readonly string[] }) => {
        const sql = query.strings.join("");
        operations.push(
          sql.includes("call_center_endpoint") ? "endpoint.lock" : "call.lock",
        );
        return [];
      },
      callCenterCallLeg: {
        findFirst: async () => {
          operations.push("endpoint.resolve");
          return { endpointId: "endpoint-1" };
        },
      },
    };
    const store = new PrismaInboundAnswerClaimStore((work) => work(transaction as never));

    await store.withCallLock(
      {
        allowedLocationIds: [],
        hasAllLocationAccess: true,
        practiceId: "practice-1",
        userId: "user-1",
      },
      { callId: "call-1", legId: "leg-1" },
      async () => {
        operations.push("work");
      },
    );

    expect(operations).toEqual([
      "endpoint.resolve",
      "endpoint.lock",
      "call.lock",
      "work",
    ]);
  });
});
