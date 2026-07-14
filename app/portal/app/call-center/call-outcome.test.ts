import { describe, expect, it } from "bun:test";

import {
  CALL_OUTCOME_SAVE_ERROR,
  isCurrentCallOutcome,
  submitCallOutcome,
} from "./call-outcome";

describe("call outcome submission", () => {
  it("reports success after the outcome is saved", async () => {
    const result = await submitCallOutcome(async () => {}, new FormData());

    expect(result).toEqual({ ok: true });
  });

  it("turns a rejected server action into a recoverable inline error", async () => {
    const result = await submitCallOutcome(async () => {
      throw new Error("database write failed");
    }, new FormData());

    expect(result).toEqual({ error: CALL_OUTCOME_SAVE_ERROR, ok: false });
  });

  it("does not apply a completed save to a newer call outcome", () => {
    expect(isCurrentCallOutcome(10, 10)).toBe(true);
    expect(isCurrentCallOutcome(10, 11)).toBe(false);
  });
});
