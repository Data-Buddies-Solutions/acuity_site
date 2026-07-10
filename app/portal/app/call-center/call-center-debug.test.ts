import { describe, expect, it } from "bun:test";

import { sanitizeCallCenterDebugDetails } from "./call-center-debug";

describe("sanitizeCallCenterDebugDetails", () => {
  it("keeps categorical diagnostics and removes sensitive detail", () => {
    expect(
      sanitizeCallCenterDebugDetails({
        call: {
          callerNumber: "+18135550100",
          id: "provider-call-id",
        },
        callerNumber: 1_813_555_0100,
        destinationNumber: "+17275550100",
        direction: "inbound",
        hasClient: true,
        message: "Call to +18135550100 failed",
        status: "ringing",
        telnyxCallControlId: "provider-call-id",
        timeoutMs: 20_000,
      }),
    ).toEqual({
      direction: "inbound",
      hasClient: true,
      status: "ringing",
      timeoutMs: 20_000,
    });
  });
});
