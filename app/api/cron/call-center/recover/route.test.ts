import { describe, expect, it } from "bun:test";

import { InvalidCanonicalProjectionConfigError } from "@/lib/call-center/infrastructure/canonical-projection-config";

import { createCallCenterRecoveryHandler } from "./handler";

const url = "https://example.test/api/cron/call-center/recover";
const canonicalDisabled = {
  enabled: false,
  failed: 0,
  ignored: 0,
  projected: 0,
  selected: 0,
  shadowRouting: {
    failed: 0,
    remaining: 0,
    recorded: 0,
    replayed: 0,
    selected: 0,
    skipped: 0,
  },
} as const;
const commandsDisabled = {
  dispatched: 0,
  enabled: false,
  failed: 0,
  selected: 0,
  skipped: 0,
  stale: 0,
} as const;
const activeLifecycleEmpty = {
  abandoned: 0,
  connected: 0,
  failed: 0,
  overflowed: 0,
  selected: 0,
  skipped: 0,
  voicemail: 0,
  waiting: 0,
} as const;
const outboundInitiationsEmpty = { callIds: [] as string[], recovered: 0 };
const voicemailEmpty = {
  callIds: [] as string[],
  commandIds: [] as string[],
  dispatched: 0,
  failed: 0,
  finalized: 0,
  recordingStarted: 0,
  selected: 0,
};

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
          activeLifecycle: activeLifecycleEmpty,
          expiredHandoffs: 0,
          canonical: canonicalDisabled,
          commands: commandsDisabled,
          outboundInitiations: outboundInitiationsEmpty,
          voicemail: voicemailEmpty,
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
          activeLifecycle: activeLifecycleEmpty,
          expiredHandoffs: 0,
          canonical: canonicalDisabled,
          commands: commandsDisabled,
          outboundInitiations: outboundInitiationsEmpty,
          voicemail: voicemailEmpty,
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
        activeLifecycle: {
          abandoned: 1,
          connected: 0,
          failed: 0,
          overflowed: 1,
          selected: 3,
          skipped: 0,
          voicemail: 1,
          waiting: 0,
        },
        expiredHandoffs: 4,
        canonical: {
          enabled: true,
          failed: 0,
          ignored: 1,
          projected: 2,
          selected: 3,
          shadowRouting: {
            failed: 0,
            remaining: 0,
            recorded: 1,
            replayed: 0,
            selected: 1,
            skipped: 0,
          },
        },
        commands: {
          dispatched: 1,
          enabled: true,
          failed: 0,
          selected: 1,
          skipped: 0,
          stale: 0,
        },
        outboundInitiations: { callIds: ["call-outbound"], recovered: 1 },
        voicemail: {
          ...voicemailEmpty,
          callIds: ["call-voicemail"],
          finalized: 1,
          selected: 1,
        },
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
      activeLifecycle: {
        abandoned: 1,
        connected: 0,
        failed: 0,
        overflowed: 1,
        selected: 3,
        skipped: 0,
        voicemail: 1,
        waiting: 0,
      },
      expiredHandoffs: 4,
      canonical: {
        enabled: true,
        failed: 0,
        ignored: 1,
        projected: 2,
        selected: 3,
        shadowRouting: {
          failed: 0,
          remaining: 0,
          recorded: 1,
          replayed: 0,
          selected: 1,
          skipped: 0,
        },
      },
      commands: {
        dispatched: 1,
        enabled: true,
        failed: 0,
        selected: 1,
        skipped: 0,
        stale: 0,
      },
      enabled: true,
      failed: 1,
      ok: true,
      outboundInitiations: { callIds: ["call-outbound"], recovered: 1 },
      voicemail: {
        ...voicemailEmpty,
        callIds: ["call-voicemail"],
        finalized: 1,
        selected: 1,
      },
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

  it("reports invalid canonical activation as unavailable without leaking config", async () => {
    const GET = createCallCenterRecoveryHandler({
      environment: { CRON_SECRET: "correct-secret" },
      recover: async () => {
        throw new InvalidCanonicalProjectionConfigError("sensitive config detail");
      },
    });

    const response = await GET(request("correct-secret"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "call_center_webhook_recovery_failed",
      ok: false,
    });
  });
});
