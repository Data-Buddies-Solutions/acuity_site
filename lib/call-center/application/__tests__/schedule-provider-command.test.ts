import { describe, expect, it } from "bun:test";

import { createImmediateProviderCommandDispatch } from "@/lib/call-center/application/schedule-provider-command";

describe("immediate provider command dispatch", () => {
  it("does not schedule while canonical dispatch is disabled", () => {
    let scheduled = 0;
    let dispatched = 0;
    const schedule = createImmediateProviderCommandDispatch({
      config: () => ({ enabled: false }),
      dispatch: async () => {
        dispatched += 1;
        return { status: "NOT_CLAIMED" };
      },
    });

    expect(
      schedule("command-1", () => {
        scheduled += 1;
      }),
    ).toBe(false);
    expect({ dispatched, scheduled }).toEqual({ dispatched: 0, scheduled: 0 });
  });

  it("defers one durable command until after the response", async () => {
    let task: () => Promise<void> = async () => undefined;
    const commandIds: string[] = [];
    const schedule = createImmediateProviderCommandDispatch({
      config: () => ({ enabled: true }),
      dispatch: async (commandId) => {
        commandIds.push(commandId);
        return { status: "NOT_CLAIMED" };
      },
    });

    expect(
      schedule("command-1", (callback) => {
        task = callback;
      }),
    ).toBe(true);
    expect(commandIds).toEqual([]);
    await task();
    expect(commandIds).toEqual(["command-1"]);
  });

  it("contains scheduler and callback failures because cron owns recovery", async () => {
    const schedule = createImmediateProviderCommandDispatch({
      config: () => ({ enabled: true }),
      dispatch: async () => {
        throw new Error("dispatch failed");
      },
    });

    expect(
      schedule("command-1", () => {
        throw new Error("scheduler failed");
      }),
    ).toBe(false);

    let task: () => Promise<void> = async () => undefined;
    expect(
      schedule("command-1", (callback) => {
        task = callback;
      }),
    ).toBe(true);
    await expect(task()).resolves.toBeUndefined();
  });
});
