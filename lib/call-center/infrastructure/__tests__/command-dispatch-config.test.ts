import { describe, expect, it } from "bun:test";

import { resolveCanonicalCommandDispatchConfig } from "../command-dispatch-config";

describe("canonical command dispatch config", () => {
  it("always drains commands already authorized by immutable ownership", () => {
    expect(resolveCanonicalCommandDispatchConfig()).toEqual({ enabled: true });
  });
});
