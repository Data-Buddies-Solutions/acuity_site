import { describe, expect, it } from "bun:test";

import { createCallCenterRecoveryHandler } from "./handler";

const url = "https://example.test/api/cron/call-center/recover";

function request(token?: string) {
  return new Request(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

describe("call center webhook recovery cron", () => {
  it("fails closed when CRON_SECRET is absent", async () => {
    let recoveryCalls = 0;
    const GET = createCallCenterRecoveryHandler({
      environment: {},
      recover: async () => {
        recoveryCalls += 1;
        return {
          enabled: false,
          failed: 0,
          recovered: 0,
          redacted: 0,
          selected: 0,
        };
      },
    });

    const response = await GET(request("undefined"));

    expect(response.status).toBe(401);
    expect(recoveryCalls).toBe(0);
  });

  it("rejects a missing or incorrect bearer token", async () => {
    let recoveryCalls = 0;
    const GET = createCallCenterRecoveryHandler({
      environment: { CRON_SECRET: "correct-secret" },
      recover: async () => {
        recoveryCalls += 1;
        return {
          enabled: false,
          failed: 0,
          recovered: 0,
          redacted: 0,
          selected: 0,
        };
      },
    });

    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("wrong-secret"))).status).toBe(401);
    expect(recoveryCalls).toBe(0);
  });

  it("returns only the aggregate recovery result for an authorized request", async () => {
    const GET = createCallCenterRecoveryHandler({
      environment: { CRON_SECRET: "correct-secret" },
      recover: async () => ({
        enabled: true,
        failed: 1,
        recovered: 2,
        redacted: 3,
        selected: 3,
      }),
    });

    const response = await GET(request("correct-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      failed: 1,
      ok: true,
      recovered: 2,
      redacted: 3,
      selected: 3,
    });
  });

  it("sanitizes unexpected recovery failures", async () => {
    const GET = createCallCenterRecoveryHandler({
      environment: { CRON_SECRET: "correct-secret" },
      recover: async () => {
        throw new Error("sensitive provider detail");
      },
    });

    const response = await GET(request("correct-secret"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "call_center_webhook_recovery_failed",
      ok: false,
    });
  });
});
