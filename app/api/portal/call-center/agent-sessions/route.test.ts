import { describe, expect, it } from "bun:test";

import {
  AgentSessionError,
  type AgentSessionRecord,
  type acquireAgentSession,
  type releaseAgentSession,
  type updateAgentSessionReadiness,
} from "@/lib/call-center/application/agent-sessions";

import { createAgentSessionHandlers } from "./handler";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const context = async () => ({ actor, callerNumber: "+17865550100" });
const now = new Date("2026-07-11T12:00:00.000Z");
const routeContext = { params: Promise.resolve({ sessionId: "session-1" }) };
const session: AgentSessionRecord = {
  audioReady: false,
  clientInstanceId: "browser-1",
  connectionState: "CONNECTING",
  currentCallId: null,
  offeredCallId: null,
  endpointId: "seat-legacy-id",
  id: "session-1",
  lastHeartbeatAt: now,
  leaseExpiresAt: new Date(now.getTime() + 60_000),
  microphoneReady: false,
  practiceId: "practice-1",
  presence: "PAUSED",
  readyAt: null,
  stateVersion: 0,
  userId: "user-1",
};

function request(method: string, body: unknown) {
  return new Request("https://example.test/api/portal/call-center/session", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });
}

function acquisition() {
  return {
    endpoint: {
      id: "seat-legacy-id",
      label: "Optical",
      locationId: "location-1",
      providerCredentialId: "credential-1",
    },
    session,
  };
}

describe("canonical agent-session route", () => {
  it("requires an authenticated call-center context", async () => {
    const { POST } = createAgentSessionHandlers({
      getContext: async () => {
        throw new AgentSessionError("Unauthorized", 401);
      },
    });
    const response = await POST(
      request("POST", {
        clientInstanceId: "browser-1",
        endpointId: "seat-legacy-id",
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns the committed lease without provider credentials", async () => {
    let acquired = false;
    const acquire: typeof acquireAgentSession = async () => {
      acquired = true;
      return acquisition();
    };
    const { POST } = createAgentSessionHandlers({
      acquire,
      clock: () => now,
      getContext: context,
    });
    const response = await POST(
      request("POST", {
        clientInstanceId: "browser-1",
        endpointId: "seat-legacy-id",
      }),
    );

    expect(response.status).toBe(200);
    expect(acquired).toBe(true);
    const body = await response.json();
    expect(body).toEqual({
      leaseDurationMs: 60_000,
      session: expect.objectContaining({
        clientInstanceId: "browser-1",
        stateVersion: 0,
      }),
    });
    expect(body.session.browserSessionId).toBeUndefined();
  });

  it("accepts only the canonical clientInstanceId wire field", async () => {
    let calls = 0;
    const acquire: typeof acquireAgentSession = async () => {
      calls += 1;
      return acquisition();
    };
    const { POST } = createAgentSessionHandlers({ acquire, getContext: context });
    const response = await POST(
      request("POST", {
        browserSessionId: "legacy-browser-field",
        endpointId: "seat-legacy-id",
      }),
    );

    expect(response.status).toBe(422);
    expect(calls).toBe(0);
  });

  it("requires every readiness signal on PATCH", async () => {
    let calls = 0;
    const updateReadiness: typeof updateAgentSessionReadiness = async () => {
      calls += 1;
      return { session };
    };
    const { PATCH } = createAgentSessionHandlers({
      getContext: context,
      updateReadiness,
    });
    const response = await PATCH(
      request("PATCH", {
        clientInstanceId: "browser-1",
        connectionState: "READY",
        endpointId: "seat-legacy-id",
        expectedStateVersion: 0,
        microphoneReady: true,
        presence: "AVAILABLE",
      }),
      routeContext,
    );

    expect(response.status).toBe(422);
    expect(calls).toBe(0);
  });

  it("updates explicit readiness without returning another token", async () => {
    const updateReadiness: typeof updateAgentSessionReadiness = async (
      _store,
      _actor,
      input,
    ) => ({
      session: {
        ...session,
        ...input,
        readyAt: now,
        stateVersion: input.expectedStateVersion + 1,
      },
    });
    const { PATCH } = createAgentSessionHandlers({
      getContext: context,
      updateReadiness,
    });
    const response = await PATCH(
      request("PATCH", {
        audioReady: true,
        clientInstanceId: "browser-1",
        connectionState: "READY",
        endpointId: "seat-legacy-id",
        expectedStateVersion: 0,
        microphoneReady: true,
        presence: "AVAILABLE",
      }),
      routeContext,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.token).toBeUndefined();
    expect(body.session).toMatchObject({
      audioReady: true,
      microphoneReady: true,
      presence: "AVAILABLE",
    });
  });

  it("releases the authenticated browser lease", async () => {
    let releasedIdentity: unknown;
    const release: typeof releaseAgentSession = async (_store, _actor, input) => {
      releasedIdentity = input;
      return {
        session: { ...session, connectionState: "CLOSED", presence: "OFFLINE" },
      };
    };
    const { DELETE } = createAgentSessionHandlers({ getContext: context, release });
    const response = await DELETE(
      request("DELETE", {
        clientInstanceId: "browser-1",
        endpointId: "seat-legacy-id",
        expectedStateVersion: 0,
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(releasedIdentity).toEqual({
      clientInstanceId: "browser-1",
      endpointId: "seat-legacy-id",
      expectedStateVersion: 0,
      sessionId: "session-1",
    });
    expect(await response.json()).toMatchObject({
      session: { connectionState: "DISCONNECTED", presence: "OFFLINE" },
    });
  });
});
