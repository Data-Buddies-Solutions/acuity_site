import { describe, expect, it, mock } from "bun:test";

import { createRecoverBrowserOfferHandler } from "./handler";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};

function request(body: unknown, idempotencyKey = "recovery-1") {
  return new Request("https://example.test/recover-offer", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    method: "POST",
  });
}

describe("recover browser offer route", () => {
  it("submits one authenticated logical recovery identity", async () => {
    const recover = mock(async () => ({
      callId: "call-1",
      replayed: false,
    })) as never;
    const POST = createRecoverBrowserOfferHandler({
      getActor: async () => actor,
      recover,
    });

    const response = await POST(
      request({
        agentSessionId: "session-1",
        callLegId: "leg-1",
        clientInstanceId: "browser-1",
        reason: "CALL_DOES_NOT_EXIST",
        recoveryGeneration: 2,
      }),
      { params: Promise.resolve({ callId: "call-1" }) },
    );

    expect(response.status).toBe(202);
    expect(recover).toHaveBeenCalledWith(expect.anything(), actor, {
      agentSessionId: "session-1",
      callId: "call-1",
      callLegId: "leg-1",
      clientInstanceId: "browser-1",
      idempotencyKey: "recovery-1",
      reason: "CALL_DOES_NOT_EXIST",
      recoveryGeneration: 2,
    });
  });

  it("rejects unbounded or unknown browser payload fields", async () => {
    const recover = mock(async () => ({ callId: "call-1", replayed: false })) as never;
    const POST = createRecoverBrowserOfferHandler({
      getActor: async () => actor,
      recover,
    });

    const response = await POST(
      request({
        agentSessionId: "session-1",
        callLegId: "leg-1",
        clientInstanceId: "browser-1",
        phoneNumber: "+15555550100",
        reason: "CALL_DOES_NOT_EXIST",
        recoveryGeneration: 2,
      }),
      { params: Promise.resolve({ callId: "call-1" }) },
    );

    expect(response.status).toBe(422);
    expect(recover).not.toHaveBeenCalled();
  });
});
