import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Pool, type PoolClient } from "pg";

import { lockCallCenterPractice } from "../prisma-call-center-practice-lock";

const postgresUrl = process.env.CALL_CENTER_POSTGRES_TEST_URL ?? "";
const describePostgres = postgresUrl ? describe : describe.skip;

function lockTransaction(client: PoolClient) {
  return {
    $queryRaw: async (query: { text: string; values: unknown[] }) =>
      (await client.query(query.text, query.values)).rows,
  };
}

async function waitForAdvisoryLockWait(pool: Pool, backendPid: number) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_locks
         WHERE pid = $1
           AND locktype = 'advisory'
           AND NOT granted
       ) AS waiting`,
      [backendPid],
    );
    if (waiting.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("admission did not wait for the practice lock");
}

describePostgres("call-center practice lock on PostgreSQL", () => {
  const schema = `call_center_lock_${randomUUID().replaceAll("-", "")}`;
  const relation = `"${schema}"."configuration"`;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: postgresUrl });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`
      CREATE TABLE ${relation} (
        practice_id TEXT PRIMARY KEY,
        queue_id TEXT NOT NULL,
        number_id TEXT NOT NULL
      )
    `);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  });

  it("commits one coherent route across configuration mutation and admission", async () => {
    await pool.query(
      `INSERT INTO ${relation} (practice_id, queue_id, number_id)
       VALUES ($1, $2, $3)`,
      ["practice-1", "queue-old", "number-old"],
    );
    const configuration = await pool.connect();
    const admission = await pool.connect();

    try {
      await configuration.query("BEGIN");
      await lockCallCenterPractice(lockTransaction(configuration) as never, "practice-1");
      await configuration.query(
        `UPDATE ${relation} SET queue_id = $2 WHERE practice_id = $1`,
        ["practice-1", "queue-new"],
      );

      await admission.query("BEGIN");
      const [{ pid: admissionPid }] = (
        await admission.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows;
      const admitted = (async () => {
        await lockCallCenterPractice(lockTransaction(admission) as never, "practice-1");
        return (
          await admission.query<{ number_id: string; queue_id: string }>(
            `SELECT number_id, queue_id FROM ${relation} WHERE practice_id = $1`,
            ["practice-1"],
          )
        ).rows[0];
      })();

      await waitForAdvisoryLockWait(pool, admissionPid);
      await configuration.query(
        `UPDATE ${relation} SET number_id = $2 WHERE practice_id = $1`,
        ["practice-1", "number-new"],
      );
      await configuration.query("COMMIT");

      await expect(admitted).resolves.toEqual({
        number_id: "number-new",
        queue_id: "queue-new",
      });
      await admission.query("COMMIT");
    } finally {
      await configuration.query("ROLLBACK");
      await admission.query("ROLLBACK");
      configuration.release();
      admission.release();
    }
  });
});
