import { describe, expect, it } from "bun:test";

import { createImmediateCanonicalProjection } from "../schedule-canonical-telnyx-event";

describe("immediate canonical projection", () => {
  it("is a no-op while the feature is disabled", () => {
    let scheduled = 0;
    const project = createImmediateCanonicalProjection({
      config: () => ({ enabled: false }),
      processEvent: async () => ({ outcome: "SKIPPED" }),
    });

    expect(project("event-1", () => (scheduled += 1))).toBe(false);
    expect(scheduled).toBe(0);
  });

  it("defers canonical work until the post-response callback", async () => {
    const projected: string[] = [];
    let callback: (() => Promise<void>) | null = null;
    const project = createImmediateCanonicalProjection({
      config: () => ({ enabled: true }),
      processEvent: async (eventId) => {
        projected.push(eventId);
        return { outcome: "SKIPPED" };
      },
    });

    expect(project("event-1", (task) => (callback = task))).toBe(true);
    expect(projected).toEqual([]);
    await callback!();
    expect(projected).toEqual(["event-1"]);
  });

  it("contains config, scheduler, and callback failures", async () => {
    const configFailure = createImmediateCanonicalProjection({
      config: () => {
        throw new Error("invalid config");
      },
      processEvent: async () => ({ outcome: "SKIPPED" }),
    });
    expect(() => configFailure("event-1", () => undefined)).not.toThrow();

    const scheduleFailure = createImmediateCanonicalProjection({
      config: () => ({ enabled: true }),
      processEvent: async () => ({ outcome: "SKIPPED" }),
    });
    expect(() =>
      scheduleFailure("event-1", () => {
        throw new Error("scheduler unavailable");
      }),
    ).not.toThrow();

    let callback: (() => Promise<void>) | null = null;
    const callbackFailure = createImmediateCanonicalProjection({
      config: () => ({ enabled: true }),
      processEvent: async () => {
        throw new Error("unexpected callback failure");
      },
    });
    callbackFailure("event-1", (task) => (callback = task));
    await expect(callback!()).resolves.toBeUndefined();
  });
});
