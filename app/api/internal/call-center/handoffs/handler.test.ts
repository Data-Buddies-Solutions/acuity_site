import { describe, expect, it } from "bun:test";

import { createDirectHandoffHandler } from "./handler";

const now = new Date("2026-07-13T20:00:00.000Z");
const config = () => ({
  practiceId: "practice-1",
  secret: "test-secret",
  sipUri: "sip:acuity-ingress@sip.telnyx.com",
});

function request(options: { authorization?: string; idempotencyKey?: string } = {}) {
  return new Request("https://acuity.example/api/internal/call-center/handoffs", {
    body: JSON.stringify({
      callerPhone: "+17865550100",
      routePhoneNumber: "+19542872010",
      sourceCallId: "source-call-1",
    }),
    headers: {
      authorization: options.authorization ?? "Bearer test-secret",
      "content-type": "application/json",
      "idempotency-key": options.idempotencyKey ?? "handoff-key-1",
    },
    method: "POST",
  });
}

describe("direct handoff handler", () => {
  it("rejects the wrong service credential before reading the body", async () => {
    const handler = createDirectHandoffHandler({ config });
    await expect(
      handler(request({ authorization: "Bearer wrong" })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("returns one direct SIP reservation and preserves replay status", async () => {
    let captured: unknown;
    const handler = createDirectHandoffHandler({
      clock: () => now,
      config,
      reserve: async (input, options) => {
        captured = { input, options };
        return {
          expiresAt: options.expiresAt,
          handoffId: "handoff-1",
          replayed: false,
          sipHeaders: {
            "X-Acuity-Handoff-Id": "handoff-1",
            "X-Acuity-Handoff-Token": "legacy-token",
          },
          sipUri: "sip:acuity-ingress~ah1~opaque-token@sip.telnyx.com",
        };
      },
    });

    const response = await handler(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      expiresAt: "2026-07-13T20:00:30.000Z",
      handoffId: "handoff-1",
      sipHeaders: {
        "X-Acuity-Handoff-Id": "handoff-1",
        "X-Acuity-Handoff-Token": "legacy-token",
      },
      sipUri: "sip:acuity-ingress~ah1~opaque-token@sip.telnyx.com",
      type: "DIRECT",
    });
    expect(captured).toMatchObject({
      input: {
        callerPhone: "+17865550100",
        idempotencyKey: "handoff-key-1",
        practiceId: "practice-1",
        routePhoneNumber: "+19542872010",
        sourceCallId: "source-call-1",
      },
      options: { baseSipUri: "sip:acuity-ingress@sip.telnyx.com" },
    });
  });
});
