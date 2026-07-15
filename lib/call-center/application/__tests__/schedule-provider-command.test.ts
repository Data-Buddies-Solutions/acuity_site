import { describe, expect, it } from "bun:test";

import { createImmediateProviderCommandDispatch } from "@/lib/call-center/application/schedule-provider-command";

describe("immediate provider command dispatch", () => {
  it("defers one durable command until after the response", async () => {
    let task: () => Promise<void> = async () => undefined;
    const commandIds: string[] = [];
    const schedule = createImmediateProviderCommandDispatch({
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

  it("contains scheduler and callback failures after durable persistence", async () => {
    const schedule = createImmediateProviderCommandDispatch({
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
