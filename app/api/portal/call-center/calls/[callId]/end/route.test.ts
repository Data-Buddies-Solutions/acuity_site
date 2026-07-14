import { describe, expect, it } from "bun:test";

import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

import { createEndCallHandler } from "./handler";

const actor: QueueAccessActor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const routeContext = { params: Promise.resolve({ callId: "call-1" }) };

function request(key = "end-1") {
  return new Request("https://example.test/calls/call-1/end", {
    body: JSON.stringify({ clientInstanceId: " browser-1 " }),
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    method: "POST",
  });
}

describe("canonical end call route", () => {
  it("authenticates, commits, and schedules every durable hangup", async () => {
    let captured: unknown;
    const scheduled: string[] = [];
    const POST = createEndCallHandler({
      end: async (_store, endActor, input) => {
        captured = { actor: endActor, input };
        return {
          callId: input.callId,
          commandIdsJson: '["hangup-agent","hangup-customer"]',
          occurredAt: "2026-07-14T12:00:00.000Z",
          replayed: false,
          revision: "12",
          status: "COMPLETED",
        };
      },
      getActor: async () => actor,
      isCanonicalActive: () => true,
      scheduleCommand: (commandId) => scheduled.push(commandId),
    });

    const response = await POST(request(), routeContext);

    expect(response.status).toBe(202);
    expect(captured).toEqual({
      actor,
      input: {
        callId: "call-1",
        clientInstanceId: "browser-1",
        idempotencyKey: "end-1",
      },
    });
    expect(scheduled).toEqual(["hangup-agent", "hangup-customer"]);
  });

  it("authenticates before rejecting an inactive canonical surface", async () => {
    let authenticated = false;
    let calls = 0;
    const POST = createEndCallHandler({
      end: async () => {
        calls += 1;
        throw new Error("not reached");
      },
      getActor: async () => {
        authenticated = true;
        return actor;
      },
      isCanonicalActive: () => false,
    });

    const response = await POST(request(), routeContext);

    expect(response.status).toBe(409);
    expect(authenticated).toBe(true);
    expect(calls).toBe(0);
  });
});
