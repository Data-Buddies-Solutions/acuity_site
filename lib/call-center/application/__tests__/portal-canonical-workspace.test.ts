import { describe, expect, it } from "bun:test";

import { selectCanonicalWorkspaceQueue } from "../portal-canonical-workspace";

function queue(
  id: string,
  locationIds: string[],
  routingMode: "LEGACY" | "SHADOW" = "SHADOW",
) {
  return {
    id,
    locations: locationIds.map((locationId) => ({ locationId })),
    maxWaitSec: 30,
    name: id,
    ringTimeoutSec: 20,
    routingMode,
  };
}

describe("portal canonical workspace queue selection", () => {
  it("selects one exact accessible queue for the chosen location", () => {
    expect(
      selectCanonicalWorkspaceQueue(
        [queue("optical", ["location-1"]), queue("medical", ["location-2"])],
        ["location-1"],
      )?.id,
    ).toBe("optical");
  });

  it("does not guess when the current scope maps to zero or multiple queues", () => {
    const queues = [queue("queue-1", ["location-1"]), queue("queue-2", ["location-1"])];
    expect(selectCanonicalWorkspaceQueue(queues, ["location-1"])).toBeNull();
    expect(selectCanonicalWorkspaceQueue(queues, ["location-2"])).toBeNull();
  });

  it("ignores legacy queues and requires an explicitly locationless shadow", () => {
    expect(
      selectCanonicalWorkspaceQueue(
        [queue("legacy", ["location-1"], "LEGACY"), queue("shadow", [], "SHADOW")],
        ["location-1"],
      ),
    ).toBeNull();
    expect(
      selectCanonicalWorkspaceQueue(
        [queue("legacy", [], "LEGACY"), queue("shadow", [], "SHADOW")],
        [],
      )?.id,
    ).toBe("shadow");
  });
});
