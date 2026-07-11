import { describe, expect, it } from "bun:test";

import {
  advanceRevision,
  orderByRevision,
  parseRevision,
  requestedRevision,
  resumePlan,
  revisionString,
} from "../realtime";

describe("call-center realtime revisions", () => {
  it("parses only canonical non-negative database revisions", () => {
    expect(parseRevision("0")).toBe(BigInt(0));
    expect(parseRevision(" 42 ")).toBe(BigInt(42));
    expect(parseRevision("04")).toBeNull();
    expect(parseRevision("-1")).toBeNull();
    expect(parseRevision("1.5")).toBeNull();
    expect(parseRevision("9223372036854775808")).toBeNull();
  });

  it("prefers Last-Event-ID and falls back to after", () => {
    expect(requestedRevision("12", "9")).toEqual({
      provided: true,
      revision: BigInt(12),
    });
    expect(requestedRevision(null, "9")).toEqual({
      provided: true,
      revision: BigInt(9),
    });
    expect(requestedRevision("invalid", "9")).toEqual({
      provided: true,
      revision: null,
    });
  });

  it("orders and serializes revisions without JSON BigInt", () => {
    const ordered = orderByRevision([
      { revision: BigInt(8) },
      { revision: BigInt(3) },
      { revision: BigInt(5) },
    ]);
    expect(ordered.map(({ revision }) => revisionString(revision))).toEqual([
      "3",
      "5",
      "8",
    ]);
  });

  it("tails, resumes, and resets only for real cursor gaps", () => {
    expect(
      resumePlan({
        latestRevision: BigInt(20),
        requested: null,
        requestedProvided: false,
        retentionFloor: BigInt(1),
      }),
    ).toEqual({ cursor: BigInt(20), kind: "tail" });
    expect(
      resumePlan({
        latestRevision: BigInt(20),
        requested: BigInt(9),
        requestedProvided: true,
        retentionFloor: BigInt(10),
      }),
    ).toEqual({ cursor: BigInt(9), kind: "resume" });
    expect(
      resumePlan({
        latestRevision: BigInt(20),
        requested: BigInt(4),
        requestedProvided: true,
        retentionFloor: BigInt(10),
      }),
    ).toEqual({
      cursor: BigInt(20),
      kind: "reset",
      reason: "RETENTION_GAP",
    });
  });

  it("accepts tenant-filtered revision jumps and ignores duplicates", () => {
    expect(advanceRevision(BigInt(12), BigInt(12))).toEqual({
      cursor: BigInt(12),
      emit: false,
    });
    expect(advanceRevision(BigInt(12), BigInt(18))).toEqual({
      cursor: BigInt(18),
      emit: true,
    });
  });
});
