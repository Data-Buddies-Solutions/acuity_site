import { describe, expect, it } from "bun:test";

import { PrismaCallCenterActivationPreflightStore } from "../prisma-call-center-activation-preflight";

const input = {
  confirmationCutoff: new Date("2026-07-12T11:58:00.000Z"),
  heartbeatCutoff: new Date("2026-07-12T11:59:30.000Z"),
  now: new Date("2026-07-12T12:00:00.000Z"),
  requiredMigrations: ["migration-a", "migration-b"],
  runtimeConfigReady: true,
  testEndpointId: "endpoint-1",
};

describe("Prisma call center activation preflight", () => {
  it("computes every gate in one current database snapshot", async () => {
    const queries: string[] = [];
    const store = new PrismaCallCenterActivationPreflightStore(async (query) => {
      queries.push(query.strings.join(" "));
      return [
        {
          ambiguousCommandCount: BigInt(7),
          ambiguousEventCount: BigInt(8),
          blockedCommandCount: BigInt(11),
          commandDeadLetterCount: BigInt(5),
          enabledNumberCount: BigInt(2),
          enabledQueueCount: BigInt(1),
          eventDeadLetterCount: BigInt(6),
          incompleteNumberCount: BigInt(4),
          incompleteQueueCount: BigInt(3),
          missingMigrationCount: BigInt(0),
          readyTestEndpointCount: BigInt(1),
          runtimeConfigReadyCount: BigInt(1),
          staleSentCommandCount: BigInt(9),
          unresolvedOwnershipCount: BigInt(10),
        },
      ];
    });

    await expect(store.inspect(input)).resolves.toEqual({
      ambiguousCommandCount: 7,
      ambiguousEventCount: 8,
      blockedCommandCount: 11,
      commandDeadLetterCount: 5,
      enabledNumberCount: 2,
      enabledQueueCount: 1,
      eventDeadLetterCount: 6,
      incompleteNumberCount: 4,
      incompleteQueueCount: 3,
      missingMigrationCount: 0,
      readyTestEndpointCount: 1,
      runtimeConfigReadyCount: 1,
      staleSentCommandCount: 9,
      unresolvedOwnershipCount: 10,
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('FROM "_prisma_migrations"');
    expect(queries[0]).toContain('FROM "call_center_queue"');
    expect(queries[0]).toContain("overflow_path");
    expect(queries[0]).toContain("enabled_number");
    expect(queries[0]).toContain('FROM "practice_call_center_settings"');
    expect(queries[0]).toContain('FROM "call_center_command"');
    expect(queries[0]).toContain('FROM "provider_webhook_event"');
    expect(queries[0]).toContain('FROM "call_center_call_leg"');
    expect(queries[0]).not.toContain('event."payload" #>>');
    expect(queries[0]).toContain('JOIN "call_center_agent_session"');
    expect(queries[0]).toContain('FROM "call_center_queue_member"');
    expect(queries[0]).toContain('JOIN "call_center_number"');
    expect(queries[0]).toContain('JOIN "practice_membership"');
    expect(queries[0]).toContain('FROM "practice_membership_location"');
    expect(queries[0]).not.toContain("phoneNumber =");
  });

  it("rejects missing or invalid aggregate results", async () => {
    const missing = new PrismaCallCenterActivationPreflightStore(async () => []);
    await expect(missing.inspect(input)).rejects.toThrow(
      "Activation preflight returned no row",
    );

    const invalid = new PrismaCallCenterActivationPreflightStore(async () => [
      {
        ambiguousCommandCount: BigInt(-1),
        ambiguousEventCount: BigInt(0),
        blockedCommandCount: BigInt(0),
        commandDeadLetterCount: BigInt(0),
        enabledNumberCount: BigInt(1),
        enabledQueueCount: BigInt(1),
        eventDeadLetterCount: BigInt(0),
        incompleteNumberCount: BigInt(0),
        incompleteQueueCount: BigInt(0),
        missingMigrationCount: BigInt(0),
        readyTestEndpointCount: BigInt(1),
        runtimeConfigReadyCount: BigInt(1),
        staleSentCommandCount: BigInt(0),
        unresolvedOwnershipCount: BigInt(0),
      },
    ]);
    await expect(invalid.inspect(input)).rejects.toThrow(
      "Invalid activation preflight count",
    );
  });
});
