import { describe, expect, it } from "bun:test";

import {
  runCallCenterActivationPreflight,
  type CallCenterActivationPreflightFacts,
} from "../call-center-activation-preflight";

const now = new Date("2026-07-12T12:00:00.000Z");
const healthyFacts: CallCenterActivationPreflightFacts = {
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
};

describe("call center activation preflight", () => {
  it("fails closed when runtime readiness is not explicitly proven", async () => {
    const result = await runCallCenterActivationPreflight(
      {
        inspect: async (input) => ({
          ...healthyFacts,
          runtimeConfigReadyCount: Number(input.runtimeConfigReady),
        }),
      },
      { now, testEndpointId: "endpoint-1" },
    );

    expect(result).toMatchObject({ ready: false });
    if (!("checks" in result)) throw new Error("Expected completed preflight");
    expect(result.checks.find(({ code }) => code === "RUNTIME_CONFIG_READY")).toEqual({
      code: "RUNTIME_CONFIG_READY",
      count: 0,
      passed: false,
    });
  });

  it("passes only a complete current production snapshot", async () => {
    const inputs: unknown[] = [];
    const result = await runCallCenterActivationPreflight(
      {
        inspect: async (input) => {
          inputs.push(input);
          return healthyFacts;
        },
      },
      { now, runtimeConfigReady: () => true, testEndpointId: "  endpoint-1  " },
    );

    expect(result).toMatchObject({ ready: true });
    expect(inputs).toEqual([
      expect.objectContaining({
        confirmationCutoff: new Date("2026-07-12T11:58:00.000Z"),
        heartbeatCutoff: new Date("2026-07-12T11:59:30.000Z"),
        testEndpointId: "endpoint-1",
      }),
    ]);
  });

  it("reports every activation blocker without short-circuiting", async () => {
    const blocked = Object.fromEntries(
      Object.keys(healthyFacts).map((key) => [key, 1]),
    ) as CallCenterActivationPreflightFacts;
    blocked.runtimeConfigReadyCount = 0;
    const result = await runCallCenterActivationPreflight(
      { inspect: async () => blocked },
      { now, runtimeConfigReady: () => true, testEndpointId: "endpoint-1" },
    );

    expect(result).toMatchObject({ ready: false });
    if (!("checks" in result)) throw new Error("Expected completed preflight");
    expect(result.checks.filter(({ passed }) => !passed).map(({ code }) => code)).toEqual(
      [
        "RUNTIME_CONFIG_READY",
        "MIGRATIONS_APPLIED",
        "ENABLED_QUEUES_COMPLETE",
        "ENABLED_NUMBERS_COMPLETE",
        "CALLBACK_OWNERSHIP_RESOLVED",
        "COMMANDS_CONFIRMED",
        "COMMAND_DEPENDENCIES_CLEAR",
        "COMMAND_DEAD_LETTERS_CLEAR",
        "EVENT_DEAD_LETTERS_CLEAR",
        "COMMAND_CORRELATION_UNAMBIGUOUS",
        "EVENT_CORRELATION_UNAMBIGUOUS",
      ],
    );
  });

  it("fails closed when there is no configured queue, number, or ready endpoint", async () => {
    const result = await runCallCenterActivationPreflight(
      {
        inspect: async () => ({
          ...healthyFacts,
          enabledNumberCount: 0,
          enabledQueueCount: 0,
          readyTestEndpointCount: 0,
        }),
      },
      { now, runtimeConfigReady: () => true, testEndpointId: "" },
    );

    expect(result).toMatchObject({ ready: false });
    if (!("checks" in result)) throw new Error("Expected completed preflight");
    expect(result.checks.filter(({ passed }) => !passed).map(({ code }) => code)).toEqual(
      ["ENABLED_QUEUES_COMPLETE", "ENABLED_NUMBERS_COMPLETE", "READY_TEST_ENDPOINT"],
    );
  });

  it("contains database failures as one sanitized blocker", async () => {
    const result = await runCallCenterActivationPreflight(
      { inspect: async () => Promise.reject(new Error("secret database detail")) },
      { now, runtimeConfigReady: () => true, testEndpointId: "endpoint-1" },
    );

    expect(result).toEqual({
      checkedAt: now,
      errorCode: "ACTIVATION_PREFLIGHT_QUERY_FAILED",
      ready: false,
    });
  });
});
