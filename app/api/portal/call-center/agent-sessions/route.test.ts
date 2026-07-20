import { describe, expect, it } from "bun:test";

import {
  AgentSessionError,
  type AgentSessionRecord,
} from "@/lib/call-center/application/agent-sessions";
import type { AgentUpdate } from "@/lib/call-center/call-center";

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
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        referenceId: expect.stringMatching(/^[A-Z0-9]{6}$/),
        retryable: false,
      },
    });
  });

  it("returns the committed lease without provider credentials", async () => {
    let acquired = false;
    const updateAgent = async () => {
      acquired = true;
      return acquisition();
    };
    const { POST } = createAgentSessionHandlers({
      clock: () => now,
      getContext: context,
      updateAgent,
    });
    const response = await POST(
      request("POST", {
        clientInstanceId: "browser-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(acquired).toBe(true);
    const body = await response.json();
    expect(body).toEqual({
      leaseDurationMs: 30_000,
      session: expect.objectContaining({
        clientInstanceId: "browser-1",
        stateVersion: 0,
      }),
    });
    expect(body.session.browserSessionId).toBeUndefined();
  });

  it("passes an explicit phone takeover to the session owner", async () => {
    let takeover = false;
    const updateAgent = async (update: AgentUpdate) => {
      takeover = update.kind === "ACQUIRE" && update.input.takeover === true;
      return acquisition();
    };
    const { POST } = createAgentSessionHandlers({
      getContext: context,
      updateAgent,
    });

    const response = await POST(
      request("POST", {
        clientInstanceId: "browser-2",
        takeover: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(takeover).toBe(true);
  });

  it("accepts only the canonical clientInstanceId wire field", async () => {
    let calls = 0;
    const updateAgent = async () => {
      calls += 1;
      return acquisition();
    };
    const { POST } = createAgentSessionHandlers({ getContext: context, updateAgent });
    const response = await POST(
      request("POST", {
        browserSessionId: "legacy-browser-field",
      }),
    );

    expect(response.status).toBe(422);
    expect(calls).toBe(0);
  });

  it("requires every readiness signal on PATCH", async () => {
    let calls = 0;
    const updateAgent = async () => {
      calls += 1;
      return { session };
    };
    const { PATCH } = createAgentSessionHandlers({
      getContext: context,
      updateAgent,
    });
    const response = await PATCH(
      request("PATCH", {
        clientInstanceId: "browser-1",
        connectionState: "READY",
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
    const updateAgent = async (update: AgentUpdate) => {
      if (update.kind !== "HEARTBEAT") throw new Error("unexpected agent operation");
      return {
        session: {
          ...session,
          ...update.input,
          readyAt: now,
          stateVersion: update.input.expectedStateVersion + 1,
        },
      };
    };
    const { PATCH } = createAgentSessionHandlers({
      getContext: context,
      updateAgent,
    });
    const response = await PATCH(
      request("PATCH", {
        audioReady: true,
        clientInstanceId: "browser-1",
        connectionState: "READY",
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
    const updateAgent = async (update: AgentUpdate) => {
      releasedIdentity = update.input;
      return {
        session: {
          ...session,
          connectionState: "CLOSED" as const,
          presence: "OFFLINE" as const,
        },
      };
    };
    const { DELETE } = createAgentSessionHandlers({
      getContext: context,
      updateAgent,
    });
    const response = await DELETE(
      request("DELETE", {
        clientInstanceId: "browser-1",
        expectedStateVersion: 0,
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(releasedIdentity).toEqual({
      clientInstanceId: "browser-1",
      expectedStateVersion: 0,
      sessionId: "session-1",
    });
    expect(await response.json()).toMatchObject({
      session: { connectionState: "DISCONNECTED", presence: "OFFLINE" },
    });
  });
});
