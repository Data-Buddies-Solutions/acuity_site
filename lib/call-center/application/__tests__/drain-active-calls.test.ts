import { describe, expect, it } from "bun:test";

import { createActiveCallDrainer } from "../drain-active-calls";

describe("active call recovery", () => {
  it("reconciles a bounded batch of overdue calls and contains individual failures", async () => {
    const reconciled: string[] = [];
    const recordedFailures: string[] = [];
    const drain = createActiveCallDrainer({
      backlog: {
        listDue: async () => [
          {
            callId: "call-1",
            direction: "INBOUND",
            practiceId: "practice-1",
            status: "RINGING",
          },
          {
            callId: "call-2",
            direction: "OUTBOUND",
            practiceId: "practice-2",
            status: "RECEIVED",
          },
        ],
        recordFailure: async (call) => {
          recordedFailures.push(call.callId);
        },
      },
      reconcile: async (call) => {
        reconciled.push(call.callId);
        if (call.callId === "call-2") throw new Error("database unavailable");
        return { status: "APPLIED" as const };
      },
    });

    await expect(drain()).resolves.toEqual({
      attempted: 2,
      failed: 1,
      recovered: 1,
    });
    expect(reconciled).toEqual(["call-1", "call-2"]);
    expect(recordedFailures).toEqual(["call-2"]);
  });
});
