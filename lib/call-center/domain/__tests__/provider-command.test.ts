import { describe, expect, it } from "bun:test";

import {
  decideProviderCommandMarkSent,
  planProviderCommandFailure,
  providerCommandRetryAt,
} from "../provider-command";

const now = new Date("2026-07-12T12:00:00.000Z");

describe("provider command state", () => {
  it("never regresses a provider-confirmed callback", () => {
    expect(decideProviderCommandMarkSent("CONFIRMED", 2, 1)).toBe("ALREADY_CONFIRMED");
    expect(decideProviderCommandMarkSent("SENDING", 1, 1)).toBe("MARKED");
    expect(decideProviderCommandMarkSent("SENT", 1, 1)).toBe("ALREADY_SENT");
    expect(decideProviderCommandMarkSent("FAILED", 1, 1)).toBe("STALE");
    expect(decideProviderCommandMarkSent("SENDING", 2, 1)).toBe("STALE");
  });

  it("uses bounded exponential retry delays", () => {
    expect(providerCommandRetryAt(1, now).getTime() - now.getTime()).toBe(2_000);
    expect(providerCommandRetryAt(3, now).getTime() - now.getTime()).toBe(8_000);
    expect(providerCommandRetryAt(20, now).getTime() - now.getTime()).toBe(60_000);
  });

  it("retries only classified transient failures below the attempt limit", () => {
    const retryable = {
      category: "RETRYABLE",
      code: "SENDING_OUTCOME_AMBIGUOUS",
    } as const;

    expect(planProviderCommandFailure(retryable, 4, now, 5)).toEqual({
      nextAttemptAt: new Date(now.getTime() + 16_000),
      retryScheduled: true,
    });
    expect(planProviderCommandFailure(retryable, 5, now, 5)).toEqual({
      nextAttemptAt: null,
      retryScheduled: false,
    });
    expect(
      planProviderCommandFailure(
        { category: "TERMINAL", code: "PROVIDER_VALIDATION_FAILED" },
        1,
        now,
      ),
    ).toEqual({ nextAttemptAt: null, retryScheduled: false });
    expect(
      planProviderCommandFailure(
        { category: "UNKNOWN", code: "PROVIDER_UNKNOWN" },
        1,
        now,
      ),
    ).toEqual({ nextAttemptAt: null, retryScheduled: false });
  });
});
