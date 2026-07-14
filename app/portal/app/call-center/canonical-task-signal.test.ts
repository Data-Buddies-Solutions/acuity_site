import { describe, expect, it } from "bun:test";

import { canonicalTaskSignal } from "./canonical-task-signal";

describe("canonical task refresh signal", () => {
  it("changes when late media upgrades the same action to voicemail", () => {
    const missed = canonicalTaskSignal(1, [
      { id: "task-1", kind: "MISSED_CALL", status: "OPEN" },
    ]);
    const voicemail = canonicalTaskSignal(1, [
      { id: "task-1", kind: "VOICEMAIL", status: "OPEN" },
    ]);

    expect(voicemail).not.toBe(missed);
  });
});
