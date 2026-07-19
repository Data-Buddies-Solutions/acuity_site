import { describe, expect, it } from "bun:test";

import {
  listCanonicalOutboundNumbers,
  listCanonicalWorkspaceQueues,
} from "../portal-canonical-workspace";

function queue(id: string, locationIds: string[]) {
  return {
    id,
    locations: locationIds.map((locationId) => ({ locationId })),
    name: id,
  };
}

describe("portal canonical workspace queue selection", () => {
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
