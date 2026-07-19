import { describe, expect, it } from "bun:test";

import { createProviderCommandDrainHandler } from "./handler";

describe("provider command drain", () => {
  it("requires the exact cron credential before touching the outbox", async () => {
    let drains = 0;
    const handler = createProviderCommandDrainHandler({
      drain: async () => {
        drains += 1;
        return { attempted: 0, deferred: 0, dispatched: 0, failed: 0 };
      },
      secret: "cron-secret",
    });

    const response = await handler(
      new Request("https://example.test/api/internal/call-center/provider-commands"),
    );

    expect(response.status).toBe(401);
    expect(drains).toBe(0);
  });

  it("drains one bounded batch for an authenticated cron request", async () => {
    const handler = createProviderCommandDrainHandler({
      drain: async () => ({
        attempted: 2,
        deferred: 0,
        dispatched: 2,
        failed: 0,
      }),
      secret: "cron-secret",
    });

    const response = await handler(
      new Request("https://example.test/api/internal/call-center/provider-commands", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      attempted: 2,
      deferred: 0,
      dispatched: 2,
      failed: 0,
      ok: true,
    });
  });
});
