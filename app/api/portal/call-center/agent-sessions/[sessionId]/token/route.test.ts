import { describe, expect, it } from "bun:test";

import {
  AgentSessionCredentialError,
  type authorizeAgentSessionCredential,
} from "@/lib/call-center/application/agent-session-credentials";

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
    let credentialId = "";
    const authorize: typeof authorizeAgentSessionCredential = async (
      _store,
      receivedActor,
      input,
      now,
    ) => {
      authorized = { actor: receivedActor, input, now };
      return { endpointLabel: "Optical", providerCredentialId: "credential-1" };
    };
    const checkedAt = new Date("2026-07-12T12:00:00.000Z");
    const POST = createCanonicalAgentSessionTokenHandler({
      authorize,
      clock: () => checkedAt,
      createToken: async (received) => {
        credentialId = received;
        return "login-token";
      },
      getActivation: () => ({ enabled: true }),
      getActor: async () => actor,
    });

    const response = await POST(
      request({ clientInstanceId: " browser-1 ", endpointId: " endpoint-1 " }),
      context,
    );

    expect(response.status).toBe(200);
    expect(authorized).toEqual({
      actor,
      input: {
        activationEnabled: true,
        clientInstanceId: "browser-1",
        endpointId: "endpoint-1",
        sessionId: "session-1",
      },
      now: checkedAt,
    });
    expect(credentialId).toBe("credential-1");
    expect(await response.json()).toEqual({
      stationLabel: "Optical",
      token: "login-token",
    });
  });

  it("rejects legacy or incomplete identity before token creation", async () => {
    let authorized = false;
    let tokens = 0;
    const POST = createCanonicalAgentSessionTokenHandler({
      authorize: async () => {
        authorized = true;
        throw new Error("not reached");
      },
      createToken: async () => {
        tokens += 1;
        return "token";
      },
      getActivation: () => ({ enabled: false }),
      getActor: async () => actor,
    });

    const response = await POST(
      request({ browserSessionId: "browser-1", endpointId: "endpoint-1" }),
      context,
    );
    expect(response.status).toBe(422);
    expect(authorized).toBe(false);
    expect(tokens).toBe(0);
  });

  it("passes rollback ownership policy before minting a drain token", async () => {
    let authorized: unknown;
    const POST = createCanonicalAgentSessionTokenHandler({
      authorize: async (_store, _actor, input) => {
        authorized = input;
        return { endpointLabel: "Optical", providerCredentialId: "credential-1" };
      },
      createToken: async () => "drain-token",
      getActivation: () => ({ enabled: false }),
      getActor: async () => actor,
    });

    const response = await POST(
      request({ clientInstanceId: "browser-1", endpointId: "endpoint-1" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(authorized).toEqual({
      activationEnabled: false,
      clientInstanceId: "browser-1",
      endpointId: "endpoint-1",
      sessionId: "session-1",
    });
  });

  it("rejects token creation while off when the exact session has no drain call", async () => {
    let tokens = 0;
    const POST = createCanonicalAgentSessionTokenHandler({
      authorize: async (_store, _actor, input) => {
        expect(input.activationEnabled).toBe(false);
        throw new AgentSessionCredentialError();
      },
      createToken: async () => {
        tokens += 1;
        return "not-issued";
      },
      getActivation: () => ({ enabled: false }),
      getActor: async () => actor,
    });

    const response = await POST(
      request({ clientInstanceId: "browser-1", endpointId: "endpoint-1" }),
      context,
    );

    expect(response.status).toBe(404);
    expect(tokens).toBe(0);
  });
});
