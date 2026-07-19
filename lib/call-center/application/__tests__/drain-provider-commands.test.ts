import { describe, expect, it } from "bun:test";

import { createProviderCommandDrainer } from "../drain-provider-commands";

const now = new Date("2026-07-19T12:00:00.000Z");

describe("provider command outbox", () => {
  it("dispatches a bounded backlog and follows commands created by terminal failure", async () => {
    const dispatched: string[] = [];
    const listed: Array<{ limit: number; staleBefore: Date }> = [];
    const drain = createProviderCommandDrainer({
      backlog: {
        async listDispatchable(input) {
          listed.push(input);
          return ["command-1", "command-2"];
        },
      },
      clock: () => now,
      dispatch: async (commandId) => {
        dispatched.push(commandId);
        if (commandId === "command-2") {
          return {
            commandId,
            errorCode: "PROVIDER_VALIDATION_FAILED" as const,
            followUpCommandIds: ["voicemail-command"],
            status: "FAILED" as const,
          };
        }
        return {
          commandId,
          markSent: "MARKED" as const,
          status: "DISPATCHED" as const,
        };
      },
      limit: 3,
      sendingLeaseMs: 60_000,
    });

    await expect(drain()).resolves.toEqual({
      attempted: 3,
      deferred: 0,
      dispatched: 2,
      failed: 1,
    });
    expect(dispatched).toEqual(["command-1", "command-2", "voicemail-command"]);
    expect(listed).toEqual([
      {
        limit: 3,
        staleBefore: new Date("2026-07-19T11:59:00.000Z"),
      },
    ]);
  });

  it("leaves busy commands for the next bounded drain", async () => {
    const drain = createProviderCommandDrainer({
      backlog: {
        listDispatchable: async () => ["command-1"],
      },
      dispatch: async () => ({ status: "NOT_CLAIMED" as const }),
    });

    await expect(drain()).resolves.toEqual({
      attempted: 1,
      deferred: 1,
      dispatched: 0,
      failed: 0,
    });
  });
});
