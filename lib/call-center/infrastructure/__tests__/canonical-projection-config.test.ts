import { describe, expect, it } from "bun:test";

import {
  InvalidCanonicalProjectionConfigError,
  resolveCanonicalProjectionConfig,
} from "../canonical-projection-config";

describe("canonical projection config", () => {
  it("is disabled by default", () => {
    expect(resolveCanonicalProjectionConfig({})).toEqual({ enabled: false });
  });

  it("accepts only explicit booleans", () => {
    expect(
      resolveCanonicalProjectionConfig({
        CALL_CENTER_CANONICAL_PROJECTION_ENABLED: "true",
        CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED: "true",
      }),
    ).toEqual({ enabled: true });
    expect(() =>
      resolveCanonicalProjectionConfig({
        CALL_CENTER_CANONICAL_PROJECTION_ENABLED: "yes",
      }),
    ).toThrow(InvalidCanonicalProjectionConfigError);
  });

  it("requires durable ingress before passive projection", () => {
    expect(() =>
      resolveCanonicalProjectionConfig({
        CALL_CENTER_CANONICAL_PROJECTION_ENABLED: "true",
        CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED: "false",
      }),
    ).toThrow(InvalidCanonicalProjectionConfigError);
  });
});
