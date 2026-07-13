import { describe, expect, it } from "bun:test";

import { expireIssuedDirectHandoffs } from "../prisma-direct-handoff-recovery";

describe("direct handoff expiry recovery", () => {
  it("expires one bounded batch after the ingress grace window", async () => {
    const now = new Date("2026-07-13T20:10:00.000Z");
    const queries: Array<{ strings: string[]; values: unknown[] }> = [];
    const count = await expireIssuedDirectHandoffs(now, {
      $executeRaw: async (value) => {
        queries.push(value as unknown as { strings: string[]; values: unknown[] });
        return 3;
      },
    });

    expect(count).toBe(3);
    expect(queries[0]?.strings.join(" ")).toContain("FOR UPDATE SKIP LOCKED");
    expect(queries[0]?.values).toContainEqual(new Date("2026-07-13T20:05:00.000Z"));
    expect(queries[0]?.values).toContain(100);
  });
});
