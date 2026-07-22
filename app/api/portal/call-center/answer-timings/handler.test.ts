import { describe, expect, it, mock } from "bun:test";

import { createAnswerTimingHandler } from "./handler";

const actor = {
  practiceId: "practice-1",
  userId: "user-1",
};

describe("call-center Answer timing", () => {
  it("reports only bounded canonical phase timing under authenticated ownership", async () => {
    const report = mock(() => {});
    const POST = createAnswerTimingHandler({
      authorize: async () => true,
      getActor: async () => actor,
      report,
    });
    const response = await POST(
      new Request("https://example.test", {
        body: JSON.stringify({
          agentSessionId: "session-1",
          callId: "call-1",
          callLegId: "leg-1",
          elapsedMs: 812.4,
          phase: "SDK_ACTIVE",
          serverDurationMs: 18.2,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    await Promise.resolve();

    expect(response.status).toBe(202);
    expect(report).toHaveBeenCalledWith({
      agentSessionId: "session-1",
      callId: "call-1",
      callLegId: "leg-1",
      elapsedMs: 812.4,
      phase: "SDK_ACTIVE",
      practiceId: "practice-1",
      serverDurationMs: 18.2,
      userId: "user-1",
    });
  });

  it("rejects payload fields that could carry patient or provider data", async () => {
    const report = mock(() => {});
    const POST = createAnswerTimingHandler({
      authorize: async () => true,
      getActor: async () => actor,
      report,
    });
    const response = await POST(
      new Request("https://example.test", {
        body: JSON.stringify({
          agentSessionId: "session-1",
          callId: "call-1",
          callLegId: "leg-1",
          elapsedMs: 812.4,
          patientPhone: "+15555550123",
          phase: "SDK_ACTIVE",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(422);
    expect(report).not.toHaveBeenCalled();
  });

  it("ignores a canonical identity tuple not owned by the authenticated actor", async () => {
    const report = mock(() => {});
    const POST = createAnswerTimingHandler({
      authorize: async () => false,
      getActor: async () => actor,
      report,
    });
    const response = await POST(
      new Request("https://example.test", {
        body: JSON.stringify({
          agentSessionId: "session-other",
          callId: "call-other",
          callLegId: "leg-other",
          elapsedMs: 812.4,
          phase: "SDK_ACTIVE",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(202);
    expect(report).not.toHaveBeenCalled();
  });
});
