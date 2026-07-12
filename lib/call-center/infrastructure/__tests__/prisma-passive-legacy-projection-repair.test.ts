import { describe, expect, it } from "bun:test";

import {
  PassiveLegacyProjectionRepairError,
  repairExhaustedLegacyOutOfScopeSessionInTransaction,
} from "../prisma-passive-legacy-projection-repair";

const now = new Date("2026-07-12T20:00:00.000Z");
const sessionId = "provider-session-sensitive";
const practiceId = "practice-1";
const practicePhone = "+17864657479";

function payload(eventType = "call.initiated") {
  return {
    data: {
      event_type: eventType,
      id: `provider-${eventType}`,
      payload: {
        call_control_id: `control-${eventType}`,
        call_session_id: sessionId,
        direction: "incoming",
        from: "+17865550100",
        to: practicePhone,
      },
    },
  };
}

type TestRow = {
  canonicalProjectionAttemptCount: number;
  canonicalProjectionErrorCode: string;
  canonicalProjectionStatus: string;
  effectOwner: "CANONICAL" | "LEGACY";
  eventType: string;
  id: string;
  payload: ReturnType<typeof payload>;
  processingStatus: string;
  providerCallSessionId: string;
  receivedAt: Date;
};

function row(
  id: string,
  eventType: string,
  errorCode:
    | "CANONICAL_CALL_NOT_FOUND"
    | "CANONICAL_LEG_CONTEXT_MISSING"
    | "CANONICAL_NUMBER_NOT_FOUND",
): TestRow {
  return {
    canonicalProjectionAttemptCount: 8,
    canonicalProjectionErrorCode: errorCode,
    canonicalProjectionStatus: "FAILED",
    effectOwner: "LEGACY" as const,
    eventType,
    id,
    payload: payload(eventType),
    processingStatus: "PROCESSED",
    providerCallSessionId: sessionId,
    receivedAt: now,
  };
}

const eligibleRows = () => {
  const rows = [
    row("event-1", "call.initiated", "CANONICAL_NUMBER_NOT_FOUND"),
    row("event-2", "call.answered", "CANONICAL_LEG_CONTEXT_MISSING"),
    row("event-3", "call.hangup", "CANONICAL_CALL_NOT_FOUND"),
  ];
  rows[2]!.processingStatus = "IGNORED";
  return rows;
};

type FakeOptions = {
  callCount?: number;
  canonicalNumberCount?: number;
  existingReceipt?: null | {
    data: { repairedCount: number };
    revision: bigint;
  };
  legCount?: number;
  phonePracticeId?: string;
  rows?: TestRow[];
  updateCount?: number;
};

function fakeTransaction({
  callCount = 0,
  canonicalNumberCount = 0,
  existingReceipt = null,
  legCount = 0,
  phonePracticeId = practiceId,
  rows = eligibleRows(),
  updateCount = rows.filter(
    ({ canonicalProjectionStatus }) => canonicalProjectionStatus === "FAILED",
  ).length,
}: FakeOptions = {}) {
  const createdEvents: unknown[] = [];
  const numberScopes: unknown[] = [];
  const queries: string[] = [];
  const updates: unknown[] = [];
  let rowReads = 0;
  const transaction = {
    $queryRaw: async (query: { strings?: readonly string[] }) => {
      queries.push(query.strings?.join(" ") ?? "");
      return [];
    },
    callCenterCall: { count: async () => callCount },
    callCenterCallLeg: { count: async () => legCount },
    callCenterNumber: {
      count: async (input: unknown) => {
        numberScopes.push(input);
        return canonicalNumberCount;
      },
    },
    callCenterEvent: {
      create: async (input: unknown) => {
        createdEvents.push(input);
        return { revision: BigInt(41) };
      },
      findUnique: async () => existingReceipt,
    },
    practicePhoneNumber: {
      findMany: async () => [{ phoneNumber: practicePhone, practiceId: phonePracticeId }],
    },
    providerWebhookEvent: {
      findMany: async () => {
        rowReads += 1;
        return rows;
      },
      updateMany: async (input: unknown) => {
        updates.push(input);
        return { count: updateCount };
      },
    },
  };
  return {
    createdEvents,
    numberScopes,
    queries,
    rowReads: () => rowReads,
    transaction,
    updates,
  };
}

async function expectRepairError(
  transaction: ReturnType<typeof fakeTransaction>["transaction"],
  code: string,
) {
  let error: unknown;
  try {
    await repairExhaustedLegacyOutOfScopeSessionInTransaction(
      transaction as never,
      { practiceId, providerCallSessionId: sessionId },
      now,
    );
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(PassiveLegacyProjectionRepairError);
  expect((error as PassiveLegacyProjectionRepairError).code).toBe(code);
}

describe("passive LEGACY projection history repair", () => {
  it("repairs one proven exhausted session with one sanitized receipt", async () => {
    const fake = fakeTransaction();
    await expect(
      repairExhaustedLegacyOutOfScopeSessionInTransaction(
        fake.transaction as never,
        { practiceId, providerCallSessionId: sessionId },
        now,
      ),
    ).resolves.toEqual({
      outcome: "REPAIRED",
      repairedCount: 3,
      revision: BigInt(41),
    });

    expect(fake.updates).toHaveLength(1);
    expect(fake.queries[0]).toContain("pg_advisory_xact_lock");
    expect(fake.queries[0]).toContain('::text AS "lock"');
    expect(fake.updates[0]).toMatchObject({
      data: {
        canonicalProjectedAt: now,
        canonicalProjectionErrorCode: "LEGACY_OUT_OF_SCOPE",
        canonicalProjectionNextAttemptAt: null,
        canonicalProjectionStatus: "IGNORED",
      },
      where: {
        effectOwner: "LEGACY",
        providerCallSessionId: sessionId,
      },
    });
    expect(fake.updates[0]).not.toHaveProperty("data.canonicalProjectionAttemptCount");
    expect(fake.createdEvents).toHaveLength(1);
    expect(fake.numberScopes).toEqual([
      {
        where: {
          enabled: true,
          OR: [
            {
              inboundEnabled: true,
              practicePhoneNumber: {
                phoneNumber: { in: [practicePhone, "17864657479", "7864657479"] },
              },
            },
          ],
          practiceId,
        },
      },
    ]);
    expect(fake.createdEvents[0]).toMatchObject({
      data: {
        aggregateId: practiceId,
        aggregateType: "CONFIGURATION",
        data: {
          failureCodes: [
            "CANONICAL_NUMBER_NOT_FOUND",
            "CANONICAL_LEG_CONTEXT_MISSING",
            "CANONICAL_CALL_NOT_FOUND",
          ],
          proofCount: 1,
          repairedCount: 3,
          status: "IGNORED",
        },
        practiceId,
        type: "CALL_CENTER_PROJECTION_HISTORY_REPAIRED",
      },
    });
    const audit = JSON.stringify(fake.createdEvents[0]);
    expect(audit).not.toContain(sessionId);
    expect(audit).not.toContain(practicePhone);
    expect(audit).not.toContain("event-1");
  });

  it("returns the existing receipt without touching repaired rows", async () => {
    const fake = fakeTransaction({
      existingReceipt: { data: { repairedCount: 3 }, revision: BigInt(40) },
    });
    await expect(
      repairExhaustedLegacyOutOfScopeSessionInTransaction(
        fake.transaction as never,
        { practiceId, providerCallSessionId: sessionId },
        now,
      ),
    ).resolves.toEqual({
      outcome: "ALREADY_REPAIRED",
      repairedCount: 3,
      revision: BigInt(40),
    });
    expect(fake.rowReads()).toBe(0);
    expect(fake.updates).toEqual([]);
    expect(fake.createdEvents).toEqual([]);
  });

  it("fails closed for a non-terminal main lane", async () => {
    for (const rows of [
      eligibleRows().map((row, index) =>
        index === 1 ? { ...row, processingStatus: "FAILED" } : row,
      ),
      eligibleRows().map((row, index) =>
        index === 1 ? { ...row, canonicalProjectionStatus: "PROCESSING" } : row,
      ),
    ]) {
      await expectRepairError(
        fakeTransaction({ rows }).transaction,
        "PASSIVE_LEGACY_REPAIR_SESSION_INELIGIBLE",
      );
    }
  });

  it("fails closed for a non-LEGACY owner", async () => {
    const rows = eligibleRows();
    rows[1] = { ...rows[1]!, effectOwner: "CANONICAL" };
    await expectRepairError(
      fakeTransaction({ rows: rows as never }).transaction,
      "PASSIVE_LEGACY_REPAIR_SESSION_INELIGIBLE",
    );
  });

  it("fails closed when canonical call or leg correlation exists", async () => {
    await expectRepairError(
      fakeTransaction({ legCount: 1 }).transaction,
      "PASSIVE_LEGACY_REPAIR_CORRELATION_EXISTS",
    );
  });

  it("requires an exact initiated NUMBER_NOT_FOUND proof", async () => {
    const rows = [
      row("event-2", "call.answered", "CANONICAL_LEG_CONTEXT_MISSING"),
      row("event-3", "call.hangup", "CANONICAL_CALL_NOT_FOUND"),
    ];
    await expectRepairError(
      fakeTransaction({ rows }).transaction,
      "PASSIVE_LEGACY_REPAIR_PROOF_MISSING",
    );
  });

  it("rejects unapproved or unexhausted failures", async () => {
    for (const rows of [
      [
        ...eligibleRows(),
        {
          ...row("event-4", "call.hangup", "CANONICAL_CALL_NOT_FOUND"),
          canonicalProjectionErrorCode: "CANONICAL_ENVELOPE_INVALID",
        },
      ],
      [
        { ...eligibleRows()[0]!, canonicalProjectionAttemptCount: 7 },
        ...eligibleRows().slice(1),
      ],
    ]) {
      await expectRepairError(
        fakeTransaction({ rows: rows as never }).transaction,
        "PASSIVE_LEGACY_REPAIR_FAILURE_INELIGIBLE",
      );
    }
  });

  it("requires every proof number to belong to the single supplied practice", async () => {
    await expectRepairError(
      fakeTransaction({ phonePracticeId: "practice-2" }).transaction,
      "PASSIVE_LEGACY_REPAIR_PRACTICE_UNPROVEN",
    );
  });

  it("refuses repair when the proof phone is now canonically configured", async () => {
    await expectRepairError(
      fakeTransaction({ canonicalNumberCount: 1 }).transaction,
      "PASSIVE_LEGACY_REPAIR_NUMBER_NOW_CONFIGURED",
    );
  });

  it("rolls back when the exact-row CAS loses", async () => {
    await expectRepairError(
      fakeTransaction({ updateCount: 2 }).transaction,
      "PASSIVE_LEGACY_REPAIR_CAS_LOST",
    );
  });
});
