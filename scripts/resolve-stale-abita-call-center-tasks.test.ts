import { describe, expect, it } from "bun:test";

import { runStaleActionItemCleanup } from "./resolve-stale-abita-call-center-tasks";

const practiceResult = {
  command: "SELECT",
  fields: [],
  oid: 0,
  rowCount: 1,
  rows: [{ id: "practice-1", name: "Abita Eye Group" }],
};
const previewResult = {
  command: "SELECT",
  fields: [],
  oid: 0,
  rowCount: 1,
  rows: [
    {
      callbackAndFollowUpPreserved: 16,
      candidateCount: 2_963,
      newestCandidateAt: new Date("2026-07-18T11:59:00.000Z"),
      oldestCandidateAt: new Date("2025-01-01T12:00:00.000Z"),
    },
  ],
};

describe("stale Abita Call Center action-item cleanup", () => {
  it("defaults to a read-only seven-day preview", async () => {
    const queries: string[] = [];
    const pool = {
      connect: async () => {
        throw new Error("dry-run must not open a transaction");
      },
      end: async () => undefined,
      query: async (sql: string) => {
        queries.push(sql);
        return queries.length === 1 ? practiceResult : previewResult;
      },
    };

    const report = await runStaleActionItemCleanup({
      apply: false,
      now: new Date("2026-07-25T12:00:00.000Z"),
      pool: pool as never,
    });

    expect(queries).toHaveLength(2);
    expect(queries.join("\n")).not.toContain("UPDATE");
    expect(report).toMatchObject({
      applied: false,
      callbackAndFollowUpPreserved: 16,
      candidateCount: 2_963,
      cutoff: "2026-07-18T12:00:00.000Z",
      resolvedCount: 0,
    });
  });

  it("resolves only stale missed calls and voicemails with audit events", async () => {
    const transactionQueries: string[] = [];
    const client = {
      query: async (sql: string) => {
        transactionQueries.push(sql);
        if (sql === "BEGIN" || sql === "COMMIT") {
          return { command: sql, fields: [], oid: 0, rowCount: null, rows: [] };
        }
        return {
          command: "SELECT",
          fields: [],
          oid: 0,
          rowCount: 1,
          rows: [
            {
              auditEventsWritten: 2_963,
              candidateCount: 2_963,
              resolvedCount: 2_963,
            },
          ],
        };
      },
      release: () => undefined,
    };
    let poolQueries = 0;
    const pool = {
      connect: async () => client,
      end: async () => undefined,
      query: async () => {
        poolQueries += 1;
        return poolQueries === 1 ? practiceResult : previewResult;
      },
    };

    const report = await runStaleActionItemCleanup({
      apply: true,
      now: new Date("2026-07-25T12:00:00.000Z"),
      pool: pool as never,
    });

    const mutation = transactionQueries[1];
    expect(mutation).toContain("t.kind IN ('MISSED_CALL', 'VOICEMAIL')");
    expect(mutation).toContain('t."createdAt" < $2');
    expect(mutation).toContain("'TASK_RESOLVED'");
    expect(mutation).toContain('UPDATE "call_center_task"');
    expect(transactionQueries.at(-1)).toBe("COMMIT");
    expect(report).toMatchObject({
      applied: true,
      auditEventsWritten: 2_963,
      candidateCount: 2_963,
      resolvedCount: 2_963,
    });
  });
});
