import { describe, expect, it, mock } from "bun:test";

import {
  recordBrowserLifecycle,
  type BrowserLifecycleStore,
} from "../record-browser-lifecycle";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};

describe("browser lifecycle ledger", () => {
  it("records a bounded sanitized batch without making telemetry authoritative", async () => {
    const save = mock(async () => 2);
    const store: BrowserLifecycleStore = { save };
    const events = [
      {
        agentSessionId: "session-1",
        browserClientInstanceId: "browser-1",
        callId: "call-1",
        callLegId: "leg-1",
        category: "SIGNALING_INTERRUPTED" as const,
        connectionGeneration: 2,
        connectionId: "connection-1",
        connectionState: "CONNECTING" as const,
        datacenter: "fr5-prod",
        deploymentRevision: "commit-1",
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
      },
      {
        agentSessionId: "session-1",
        browserClientInstanceId: "browser-1",
        callId: "call-1",
        callLegId: "leg-1",
        category: "REATTACH_FAILED" as const,
        connectionGeneration: 2,
        connectionId: "connection-1",
        connectionState: "READY" as const,
        datacenter: "fr5-prod",
        deploymentRevision: "commit-1",
        errorCode: "48501",
        errorFatal: true,
        errorName: "SESSION_NOT_REATTACHED",
        eventId: "event-2",
        occurredAt: "2026-07-19T12:00:01.000Z",
        providerCallControlId: "control-1",
        providerCallLegId: "provider-leg-1",
        providerCallSessionId: "provider-session-1",
        recoveredCallId: null,
        region: "eu",
        sdkCallId: "sdk-call-1",
        sdkCallState: "ringing",
        sdkVersion: "2.27.3",
      },
    ];

    await expect(recordBrowserLifecycle(store, actor, events)).resolves.toEqual({
      accepted: 2,
    });
    expect(save).toHaveBeenCalledWith(actor, events);
  });

  it("rejects an oversized client batch before persistence", async () => {
    const save = mock(async () => 21);
    const store: BrowserLifecycleStore = { save };
    const events = Array.from({ length: 21 }, (_, index) => ({
      agentSessionId: "session-1",
      browserClientInstanceId: "browser-1",
      callId: null,
      callLegId: null,
      category: "SDK_READY" as const,
      connectionGeneration: 0,
      connectionId: "connection-1",
      connectionState: "READY" as const,
      datacenter: null,
      deploymentRevision: null,
      eventId: `event-${index}`,
      occurredAt: "2026-07-19T12:00:00.000Z",
      providerCallControlId: null,
      providerCallLegId: null,
      providerCallSessionId: null,
      recoveredCallId: null,
      region: null,
      sdkCallId: null,
      sdkCallState: null,
      sdkVersion: "2.27.3",
    }));

    await expect(recordBrowserLifecycle(store, actor, events)).rejects.toMatchObject({
      status: 400,
    });
    expect(save).not.toHaveBeenCalled();
  });
});
