import { describe, expect, it } from "bun:test";

import { createCanonicalVoicemailRecovery } from "../recover-canonical-voicemails";

const now = new Date("2026-07-12T12:00:00.000Z");

describe("canonical voicemail recovery", () => {
  it("dispatches recovered commands only after durable recovery returns", async () => {
    const operations: string[] = [];
    const recover = createCanonicalVoicemailRecovery({
      dispatch: async (commandId) => {
        operations.push(`dispatch:${commandId}`);
        return { commandId, markSent: "MARKED", status: "DISPATCHED" };
      },
      store: {
        recoverDue: async () => {
          operations.push("commit");
          return {
            callIds: ["call-1"],
            commandIds: ["recording-1", "hangup-1"],
            finalized: 0,
            recordingStarted: 1,
            selected: 1,
          };
        },
      },
    });

    await expect(recover(now, 1)).resolves.toMatchObject({
      dispatched: 2,
      failed: 0,
    });
    expect(operations).toEqual(["commit", "dispatch:recording-1", "dispatch:hangup-1"]);
  });
});
