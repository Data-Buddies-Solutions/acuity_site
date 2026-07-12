import { describe, expect, it } from "bun:test";

import { createProviderCommandRecovery } from "../recover-provider-commands";

const now = new Date("2026-07-12T12:00:00.000Z");

describe("provider command recovery", () => {
  it("performs no reads or effects while dispatch is disabled", async () => {
    let calls = 0;
    const recover = createProviderCommandRecovery({
      config: () => ({ enabled: false }),
      dispatch: async () => ((calls += 1), { status: "DISABLED" }),
      store: { listRecoverable: async () => ((calls += 1), []) },
    });

    await expect(recover()).resolves.toEqual({
      dispatched: 0,
      enabled: false,
      failed: 0,
      selected: 0,
      skipped: 0,
      stale: 0,
    });
    expect(calls).toBe(0);
  });

  it("processes a bounded batch and isolates command failures", async () => {
    let listInput: unknown;
    const recover = createProviderCommandRecovery({
      clock: () => now,
      config: () => ({ enabled: true }),
      dispatch: async (id) => {
        if (id === "command-1") {
          return { commandId: id, markSent: "MARKED", status: "DISPATCHED" };
        }
        if (id === "command-2") throw new Error("claim failed");
        return { status: "NOT_CLAIMED" };
      },
      store: {
        listRecoverable: async (input) => {
          listInput = input;
          return [{ id: "command-1" }, { id: "command-2" }, { id: "command-3" }];
        },
      },
    });

    await expect(recover()).resolves.toEqual({
      dispatched: 1,
      enabled: true,
      failed: 1,
      selected: 3,
      skipped: 1,
      stale: 0,
    });
    expect(listInput).toEqual({
      limit: 5,
      maxAttempts: 5,
      now,
      staleBefore: new Date(now.getTime() - 60_000),
    });
  });
});
