import { describe, expect, it } from "bun:test";

import {
  InvalidCanonicalCommandDispatchConfigError,
  resolveCanonicalCommandDispatchConfig,
} from "../command-dispatch-config";

describe("canonical command dispatch config", () => {
  it("is disabled by default", () => {
    expect(resolveCanonicalCommandDispatchConfig({})).toEqual({ enabled: false });
  });

  it("accepts only exact boolean strings", () => {
    expect(
      resolveCanonicalCommandDispatchConfig({
        CALL_CENTER_CANONICAL_COMMAND_DISPATCH_ENABLED: "true",
      }),
    ).toEqual({ enabled: true });
    expect(
      resolveCanonicalCommandDispatchConfig({
        CALL_CENTER_CANONICAL_COMMAND_DISPATCH_ENABLED: "false",
      }),
    ).toEqual({ enabled: false });
  });

  it.each(["", "TRUE", "False", " true", "false ", "yes", "1"])(
    "rejects invalid value without exposing it: %s",
    (value) => {
      try {
        resolveCanonicalCommandDispatchConfig({
          CALL_CENTER_CANONICAL_COMMAND_DISPATCH_ENABLED: value,
        });
        throw new Error("Expected configuration resolution to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidCanonicalCommandDispatchConfigError);
        expect(error).toMatchObject({
          code: "INVALID_CANONICAL_COMMAND_DISPATCH_CONFIG",
          message: "Canonical command dispatch configuration is invalid",
          status: 503,
        });
      }
    },
  );
});
