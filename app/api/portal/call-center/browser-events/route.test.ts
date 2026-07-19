import { describe, expect, it, mock } from "bun:test";

import { createBrowserLifecycleHandler } from "./handler";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};

function request(event: Record<string, unknown>) {
  return new Request("https://example.test/browser-events", {
    body: JSON.stringify({ events: [event] }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

const event = {
  agentSessionId: "session-1",
  browserClientInstanceId: "browser-1",
  callId: "call-1",
  callLegId: "leg-1",
  category: "REATTACH_FAILED",
  connectionGeneration: 2,
  connectionId: "connection-1",
  connectionState: "READY",
  datacenter: "fr5-prod",
  deploymentRevision: "commit-1",
  errorCode: "48501",
  errorFatal: true,
  errorName: "SESSION_NOT_REATTACHED",
  eventId: "event-1",
  occurredAt: "2026-07-19T12:00:00.000Z",
  providerCallControlId: "control-1",
  providerCallLegId: "provider-leg-1",
  providerCallSessionId: "provider-session-1",
  recoveredCallId: null,
  region: "eu",
  sdkCallId: "sdk-call-1",
  sdkCallState: "ringing",
  sdkVersion: "2.27.3",
};

describe("browser lifecycle route", () => {
  it("accepts only the bounded lifecycle contract", async () => {
    const record = mock(async () => ({ accepted: 1 })) as never;
    const POST = createBrowserLifecycleHandler({
      getActor: async () => actor,
      record,
    });

    const response = await POST(request(event));

    expect(response.status).toBe(202);
    expect(record).toHaveBeenCalledWith(expect.anything(), actor, [event]);
  });

  it("rejects forbidden phone and raw provider fields", async () => {
    const record = mock(async () => ({ accepted: 1 })) as never;
    const POST = createBrowserLifecycleHandler({
      getActor: async () => actor,
      record,
    });

    for (const forbidden of [
      { callerPhone: "+15555550100" },
      { rawProviderPayload: { secret: "payload" } },
      { sdp: "v=0" },
    ]) {
      const response = await POST(request({ ...event, ...forbidden }));
      expect(response.status).toBe(422);
    }
    expect(record).not.toHaveBeenCalled();
  });
});
