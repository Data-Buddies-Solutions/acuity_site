import { describe, expect, it } from "bun:test";

import { lockCallCenterPractice } from "../prisma-call-center-practice-lock";

describe("call-center practice transaction lock", () => {
  it("serializes every multi-resource mutation for one practice", async () => {
    const locks: Array<{ sql: string; values: unknown[] }> = [];
    const transaction = {
      $queryRaw: async (query: { strings: readonly string[]; values: unknown[] }) => {
        locks.push({ sql: query.strings.join("?"), values: query.values });
        return [];
      },
    };

    await lockCallCenterPractice(transaction as never, "practice-1");
    await lockCallCenterPractice(transaction as never, "practice-2");

    expect(locks).toEqual([
      {
        sql: 'SELECT pg_advisory_xact_lock(hashtextextended(?, 0))::text AS "lock"',
        values: ["CALL_CENTER:practice-1"],
      },
      {
        sql: 'SELECT pg_advisory_xact_lock(hashtextextended(?, 0))::text AS "lock"',
        values: ["CALL_CENTER:practice-2"],
      },
    ]);
  });
});
