import { describe, expect, it } from "bun:test";

import { createHoldMusicHandler } from "./handler";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const context = { params: Promise.resolve({ callId: "call-1" }) };

describe("canonical hold music route", () => {
  it("passes bounded authenticated input and idempotency", async () => {
    let captured: unknown;
    const POST = createHoldMusicHandler({
      getActor: async () => actor,
      set: async (holdActor, input) => {
        captured = { actor: holdActor, input };
        return {
          action: input.action,
          callId: input.callId,
          commandId: "command-1",
          occurredAt: "2026-07-19T12:00:00.000Z",
          operationType: "HOLD_MUSIC",
          replayed: false,
          revision: "1",
          status: "CONFIRMED",
        };
      },
    });
    const response = await POST(
      new Request("https://example.test", {
        body: JSON.stringify({ action: "START", expectedStateVersion: 4 }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": " hold-1 ",
        },
        method: "POST",
      }),
      context,
    );
    expect(response.status).toBe(202);
    expect(captured).toEqual({
      actor,
      input: {
        action: "START",
        callId: "call-1",
        expectedStateVersion: 4,
        idempotencyKey: "hold-1",
      },
    });
  });

  it("rejects client-scoped fields", async () => {
    const POST = createHoldMusicHandler({
      getActor: async () => actor,
      set: async () => {
        throw new Error("must not run");
      },
    });
    const response = await POST(
      new Request("https://example.test", {
        body: JSON.stringify({
          action: "START",
          expectedStateVersion: 4,
          practiceId: "other",
        }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": "key" },
        method: "POST",
      }),
      context,
    );
    expect(response.status).toBe(422);
  });
});
