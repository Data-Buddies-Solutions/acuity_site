import { describe, expect, it, mock } from "bun:test";

import { createOutboundBrowserTimingHandler } from "./handler";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};

function request(body: unknown) {
  return new Request("http://localhost/api/portal/call-center/outbound/browser-timing", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

describe("outbound browser timing handler", () => {
  it("retains a PHI-free timing correlated to an authorized call", async () => {
    const reportTiming = mock(() => {});
    const handler = createOutboundBrowserTimingHandler({
      getActor: async () => actor,
      reportTiming,
      verifyCall: async (_actor, callId) => callId === "call-1",
    });

    const response = await handler(
      request({
        callId: "call-1",
        durationMs: 4312.5,
        operationKey: "operation-1",
        resultClass: "success",
      }),
    );

    expect(response.status).toBe(204);
    expect(reportTiming).toHaveBeenCalledWith({
      browserDurationMs: 4312.5,
      callId: "call-1",
      operationKey: "operation-1",
      phase: "browser-request",
      practiceId: "practice-1",
      resultClass: "success",
    });
    expect(JSON.stringify(reportTiming.mock.calls)).not.toContain("destination");
    expect(JSON.stringify(reportTiming.mock.calls)).not.toContain("phone");
  });

  it("rejects a call outside the authenticated practice", async () => {
    const reportTiming = mock(() => {});
    const handler = createOutboundBrowserTimingHandler({
      getActor: async () => actor,
      reportTiming,
      verifyCall: async () => false,
    });

    const response = await handler(
      request({
        callId: "other-call",
        durationMs: 100,
        operationKey: "operation-1",
        resultClass: "success",
      }),
    );

    expect(response.status).toBe(404);
    expect(reportTiming).not.toHaveBeenCalled();
  });

  it("does not change the response when retained logging fails", async () => {
    const handler = createOutboundBrowserTimingHandler({
      getActor: async () => actor,
      reportTiming: () => {
        throw new Error("logger unavailable");
      },
    });

    const response = await handler(
      request({
        durationMs: 200,
        operationKey: "operation-2",
        resultClass: "error",
      }),
    );

    expect(response.status).toBe(204);
  });
});
