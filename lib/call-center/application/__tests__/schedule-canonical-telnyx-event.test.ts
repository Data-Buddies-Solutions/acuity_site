import { describe, expect, it } from "bun:test";

import { createImmediateCanonicalProjection } from "../schedule-canonical-telnyx-event";

describe("immediate canonical projection", () => {
  it("defers projection until the post-response callback", async () => {
    const projected: string[] = [];
    let callback: (() => Promise<void>) | undefined;
    const project = createImmediateCanonicalProjection({
      processEvent: async (eventId) => {
        projected.push(eventId);
        return { outcome: "IGNORED" };
      },
    });

    expect(project("event-1", (task) => (callback = task))).toBe(true);
    expect(projected).toEqual([]);
    await callback?.();
    expect(projected).toEqual(["event-1"]);
  });

  it("contains scheduler and callback failures after durable persistence", async () => {
    const scheduleFailure = createImmediateCanonicalProjection({
      processEvent: async () => ({ outcome: "IGNORED" }),
    });
    expect(
      scheduleFailure("event-1", () => {
        throw new Error("scheduler unavailable");
      }),
    ).toBe(false);

    let callback: (() => Promise<void>) | undefined;
    const callbackFailure = createImmediateCanonicalProjection({
      processEvent: async () => {
        throw new Error("projection unavailable");
      },
    });
    expect(callbackFailure("event-2", (task) => (callback = task))).toBe(true);
    await expect(callback?.()).resolves.toBeUndefined();
  });
});
