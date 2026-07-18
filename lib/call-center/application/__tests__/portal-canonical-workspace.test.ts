import { describe, expect, it } from "bun:test";

import {
  listCanonicalOutboundNumbers,
  listCanonicalWorkspaceQueues,
  selectCanonicalWorkspaceQueue,
} from "../portal-canonical-workspace";

function queue(id: string, locationIds: string[]) {
  return {
    id,
    locations: locationIds.map((locationId) => ({ locationId })),
    maxWaitSec: 30,
    name: id,
    ringTimeoutSec: 20,
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

  it("selects a deterministic default or the explicit accessible queue", () => {
    const queues = [queue("queue-1", ["location-1"]), queue("queue-2", ["location-1"])];
    expect(selectCanonicalWorkspaceQueue(queues, ["location-1"])?.id).toBe("queue-1");
    expect(selectCanonicalWorkspaceQueue(queues, ["location-1"], "queue-2")?.id).toBe(
      "queue-2",
    );
    expect(selectCanonicalWorkspaceQueue(queues, ["location-2"])).toBeNull();
  });

  it("selects configured queues without rollout modes", () => {
    expect(
      selectCanonicalWorkspaceQueue(
        [queue("location", ["location-1"]), queue("practice-wide", [])],
        ["location-1"],
      )?.id,
    ).toBe("location");
    expect(
      selectCanonicalWorkspaceQueue([queue("first", []), queue("second", [])], [])?.id,
    ).toBe("first");
  });

  it("lists every location-specific and practice-wide choice deterministically", () => {
    const queues = [
      queue("optical", ["location-1"]),
      queue("practice-wide", []),
      queue("other", ["location-2"]),
    ];
    expect(
      listCanonicalWorkspaceQueues(queues, ["location-1"]).map(({ id }) => id),
    ).toEqual(["optical", "practice-wide"]);
  });

  it("keeps practice-wide queues eligible for canonical outbound numbers", async () => {
    let where: unknown;
    const numbers = await listCanonicalOutboundNumbers(
      {
        allowedLocationIds: [],
        hasAllLocationAccess: true,
        practiceId: "practice-1",
      },
      queue("practice-wide", []),
      {
        callCenterNumber: {
          findMany: async (input: { where: unknown }) => {
            where = input.where;
            return [
              {
                id: "number-1",
                practicePhoneNumber: {
                  label: "Main",
                  locationId: null,
                  phoneNumber: "+15555550000",
                },
              },
            ];
          },
        },
      } as never,
    );

    expect(where).toEqual(
      expect.objectContaining({ enabled: true, outboundEnabled: true }),
    );
    expect(numbers).toEqual([
      {
        id: "number-1",
        label: "Main",
        locationId: null,
        phoneNumber: "+15555550000",
      },
    ]);
  });
});
