import { describe, expect, test } from "bun:test";

import { canonicalProjectionErrorCode } from "../project-canonical-telnyx-event";
import { CanonicalProjectionError } from "../../infrastructure/prisma-canonical-call-projector";

describe("canonicalProjectionErrorCode", () => {
  test("preserves canonical domain errors", () => {
    expect(
      canonicalProjectionErrorCode(
        new CanonicalProjectionError("CANONICAL_QUEUE_NOT_CONFIGURED"),
      ),
    ).toBe("CANONICAL_QUEUE_NOT_CONFIGURED");
  });

  test("preserves safe Prisma codes without logging exception details", () => {
    expect(canonicalProjectionErrorCode({ code: "P2022" })).toBe(
      "CANONICAL_PRISMA_P2022",
    );
  });

  test("keeps unexpected errors generic", () => {
    expect(canonicalProjectionErrorCode(new Error("sensitive detail"))).toBe(
      "CANONICAL_PROJECTION_FAILED",
    );
  });
});
