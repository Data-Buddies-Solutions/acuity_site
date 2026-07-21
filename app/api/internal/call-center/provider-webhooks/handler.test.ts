import { describe, expect, it } from "bun:test";

import { createProviderWebhookDrainHandler } from "./handler";

describe("provider webhook drain", () => {
  it("requires the exact cron credential before touching the inbox", async () => {
    let drains = 0;
    const handler = createProviderWebhookDrainHandler({
      drain: async () => {
        drains += 1;
        return { attempted: 0, failed: 0, processed: 0 };
      },
      secret: "cron-secret",
    });

    const response = await handler(
      new Request("https://example.test/api/internal/call-center/provider-webhooks"),
    );

    expect(response.status).toBe(401);
    expect(drains).toBe(0);
  });

  it("drains one bounded batch for an authenticated cron request", async () => {
    const handler = createProviderWebhookDrainHandler({
      drain: async () => ({ attempted: 2, failed: 1, processed: 1 }),
      secret: "cron-secret",
    });

    const response = await handler(
      new Request("https://example.test/api/internal/call-center/provider-webhooks", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      attempted: 2,
      failed: 1,
      ok: true,
      processed: 1,
    });
  });
});
