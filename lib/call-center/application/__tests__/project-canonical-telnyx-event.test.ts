import { describe, expect, test } from "bun:test";

import {
  canonicalProjectionErrorCode,
  createCanonicalTelnyxEventProcessor,
} from "../project-canonical-telnyx-event";
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

  test("does not acknowledge an exhausted canonical event", async () => {
    const process = createCanonicalTelnyxEventProcessor({
      inbox: {
        claim: async () => "EXHAUSTED",
        completeIgnored: async () => true,
        fail: async () => true,
      },
      projector: {} as never,
    });

    await expect(process("event-1")).resolves.toEqual({
      errorCode: "CANONICAL_RETRIES_EXHAUSTED",
      outcome: "FAILED",
    });
  });
});
