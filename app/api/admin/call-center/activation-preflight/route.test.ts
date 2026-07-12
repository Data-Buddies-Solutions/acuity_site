import { describe, expect, it } from "bun:test";

import type { CallCenterActivationPreflightResult } from "@/lib/call-center/application/call-center-activation-preflight";

import { createActivationPreflightHandler } from "./handler";

const now = new Date("2026-07-12T12:00:00.000Z");
const request = (query = "") =>
  new Request(`https://example.test/api/admin/call-center/activation-preflight${query}`);

const readyResult: CallCenterActivationPreflightResult = {
  checkedAt: now,
  checks: [],
  facts: {
    ambiguousCommandCount: 0,
    ambiguousEventCount: 0,
    blockedCommandCount: 0,
    commandDeadLetterCount: 0,
    enabledNumberCount: 1,
    enabledQueueCount: 1,
    eventDeadLetterCount: 0,
    incompleteNumberCount: 0,
    incompleteQueueCount: 0,
    missingMigrationCount: 0,
    readyTestEndpointCount: 1,
    runtimeConfigReadyCount: 1,
    staleSentCommandCount: 0,
    unresolvedOwnershipCount: 0,
  },
  ready: true,
};

function adminDependencies() {
  return {
    clock: () => now,
    getSession: async () => ({ user: { email: "admin@example.test" } }),
    isAdmin: () => true,
  };
}

describe("call center activation preflight route", () => {
  it("authorizes before reading input or running preflight", async () => {
    let runs = 0;
    const GET = createActivationPreflightHandler({
      getSession: async () => ({ user: { email: "staff@example.test" } }),
      isAdmin: () => false,
      runPreflight: async () => {
        runs += 1;
        return readyResult;
      },
    });

    expect((await GET(request("?testEndpointId=endpoint-1"))).status).toBe(401);
    expect(runs).toBe(0);
  });

  it("requires one explicit test endpoint", async () => {
    let runs = 0;
    const GET = createActivationPreflightHandler({
      ...adminDependencies(),
      runPreflight: async () => {
        runs += 1;
        return readyResult;
      },
    });

    const response = await GET(request("?testEndpointId=%20%20"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "testEndpointId is required" });
    expect(runs).toBe(0);
  });

  it("returns one uncached structured result without activating", async () => {
    const inputs: unknown[] = [];
    const GET = createActivationPreflightHandler({
      ...adminDependencies(),
      runPreflight: async (testEndpointId, checkedAt) => {
        inputs.push({ checkedAt, testEndpointId });
        return readyResult;
      },
    });

    const response = await GET(request("?testEndpointId=%20endpoint-1%20"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ...readyResult,
      checkedAt: now.toISOString(),
    });
    expect(inputs).toEqual([{ checkedAt: now, testEndpointId: "endpoint-1" }]);
  });

  it("returns a fail-closed query result without database detail", async () => {
    const blocked: CallCenterActivationPreflightResult = {
      checkedAt: now,
      errorCode: "ACTIVATION_PREFLIGHT_QUERY_FAILED",
      ready: false,
    };
    const GET = createActivationPreflightHandler({
      ...adminDependencies(),
      runPreflight: async () => blocked,
    });

    const response = await GET(request("?testEndpointId=endpoint-1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...blocked,
      checkedAt: now.toISOString(),
    });
  });
});
