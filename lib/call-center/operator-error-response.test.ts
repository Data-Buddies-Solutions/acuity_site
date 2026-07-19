import { describe, expect, it } from "bun:test";

import { TelnyxError } from "@/lib/telnyx";

import { withCallCenterApiHandler } from "./operator-error-response";

function request() {
  return new Request("https://example.test/api/portal/call-center/outbound", {
    headers: { "x-request-id": "ABC123" },
  });
}

describe("call-center operator error response", () => {
  it("keeps unexpected database details behind the boundary", async () => {
    const logs: unknown[] = [];
    const handler = withCallCenterApiHandler(
      async (_request: Request) => {
        throw Object.assign(
          new Error("PrismaClientKnownRequestError P2025 patient +17865550100"),
          { code: "P2025" },
        );
      },
      {
        errorCode: "OUTBOUND_CALL_FAILED",
        logLabel: "outbound failed",
        reportFailure: (message, context) => logs.push({ context, message }),
        retryable: true,
      },
    );

    const response = await handler(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "OUTBOUND_CALL_FAILED",
        referenceId: "ABC123",
        retryable: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain("P2025");
    expect(JSON.stringify(body)).not.toContain("17865550100");
    expect(logs).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({
          causeCode: "P2025",
          causeName: "Error",
          errorCode: "OUTBOUND_CALL_FAILED",
          referenceId: "ABC123",
          requestId: "ABC123",
          retryable: true,
          status: 500,
        }),
        message: "outbound failed",
      }),
    ]);
    expect(JSON.stringify(logs)).not.toContain("17865550100");
    expect(JSON.stringify(logs)).not.toContain("PrismaClientKnownRequestError");
  });

  it("classifies provider payloads without exposing them", async () => {
    const handler = withCallCenterApiHandler(
      async (_request: Request) => {
        throw new TelnyxError('{"errors":[{"detail":"secret provider payload"}]}', 503);
      },
      {
        errorCode: "UNKNOWN_FAILURE",
        logLabel: "provider failed",
        reportFailure: () => {},
      },
    );

    const response = await handler(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(body.error.retryable).toBe(true);
    expect(JSON.stringify(body)).not.toContain("secret provider payload");
  });
});
