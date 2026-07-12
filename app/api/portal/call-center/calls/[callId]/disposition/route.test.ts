import { describe, expect, it } from "bun:test";
import { createDispositionHandler } from "./handler";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const context = { params: Promise.resolve({ callId: "call-1" }) };

describe("canonical disposition route", () => {
  it("passes bounded authenticated input and idempotency", async () => {
    let captured: unknown;
    const POST = createDispositionHandler({
      getActor: async () => actor,
      save: async (_store, dispositionActor, input) => {
        captured = { actor: dispositionActor, input };
        return {
          callId: input.callId,
          occurredAt: "2026-07-12T12:00:00.000Z",
          operationType: "DISPOSITION",
          replayed: false,
          resolvedTaskCount: 1,
          revision: "20",
          stateVersion: 4,
          status: "CONFIRMED",
        };
      },
    });
    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": " disposition-1 ",
        },
        body: JSON.stringify({
          disposition: "RESOLVED",
          expectedStateVersion: 3,
          note: " done ",
          taskIds: ["task-1"],
        }),
      }),
      context,
    );
    expect(response.status).toBe(202);
    expect(captured).toEqual({
      actor,
      input: {
        callId: "call-1",
        disposition: "RESOLVED",
        expectedStateVersion: 3,
        idempotencyKey: "disposition-1",
        note: "done",
        taskIds: ["task-1"],
      },
    });
  });

  it("rejects unbounded or client-scoped input", async () => {
    const POST = createDispositionHandler({
      getActor: async () => actor,
      save: async () => {
        throw new Error("must not run");
      },
    });
    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "key" },
        body: JSON.stringify({
          disposition: "RESOLVED",
          expectedStateVersion: 3,
          practiceId: "other",
        }),
      }),
      context,
    );
    expect(response.status).toBe(422);
  });
});
