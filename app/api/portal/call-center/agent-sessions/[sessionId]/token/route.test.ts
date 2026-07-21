import { describe, expect, it } from "bun:test";

import { callCenter } from "@/lib/call-center/call-center";

import { createCanonicalAgentSessionTokenHandler } from "./handler";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const context = { params: Promise.resolve({ sessionId: "session-1" }) };

function request(body: unknown) {
  return new Request("https://example.test/token", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("canonical agent-session token route", () => {
  it("mints a token only after exact lease authorization", async () => {
    let authorized: unknown;
    const checkedAt = new Date("2026-07-12T12:00:00.000Z");
    const authorize: typeof callCenter.authorizeAgentCredential = async (
      receivedActor,
      input,
      now,
    ) => {
      authorized = { actor: receivedActor, input, now };
      return { agentLabel: "Maria", providerCredentialId: "credential-1" };
    };
    const POST = createCanonicalAgentSessionTokenHandler({
      authorize,
      clock: () => checkedAt,
      createToken: async () => "login-token",
      getActor: async () => actor,
    });

    const response = await POST(request({ clientInstanceId: " browser-1 " }), context);
    expect(response.status).toBe(200);
    expect(authorized).toEqual({
      actor,
      input: { clientInstanceId: "browser-1", sessionId: "session-1" },
      now: checkedAt,
    });
    expect(await response.json()).toEqual({ agentLabel: "Maria", token: "login-token" });
  });

  it("rejects incomplete client identity before authorization", async () => {
    let authorized = false;
    const POST = createCanonicalAgentSessionTokenHandler({
      authorize: async () => {
        authorized = true;
        throw new Error("not reached");
      },
      createToken: async () => "token",
      getActor: async () => actor,
    });
    const response = await POST(request({ browserSessionId: "browser-1" }), context);
    expect(response.status).toBe(422);
    expect(authorized).toBe(false);
  });
});
