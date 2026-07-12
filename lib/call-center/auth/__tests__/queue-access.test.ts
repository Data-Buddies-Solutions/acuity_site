import { describe, expect, it } from "bun:test";

import {
  QueueAccessError,
  queueAccessWhere,
  rehydrateQueueAccessActor,
  resolveQueueAccess,
} from "../queue-access";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};

describe("call center queue access", () => {
  it("requires tenant, membership, and location access in one scope", () => {
    expect(queueAccessWhere(actor)).toEqual({
      enabled: true,
      OR: [
        { locations: { none: {} } },
        {
          locations: {
            some: {
              location: { practiceId: "practice-1" },
              locationId: { in: ["location-1"] },
            },
          },
        },
      ],
      members: { some: { enabled: true, userId: "user-1" } },
      practiceId: "practice-1",
    });
  });

  it("treats an unscoped queue as practice-wide for a selected-location member", async () => {
    let receivedWhere: unknown;
    const database = {
      callCenterQueue: {
        findFirst: async ({ where }: { where: unknown }) => {
          receivedWhere = where;
          return {
            id: "unscoped",
            locations: [],
            maxWaitSec: 30,
            name: "Practice wide",
            ringTimeoutSec: 20,
            routingMode: "LEGACY",
          };
        },
      },
    } as never;

    await expect(resolveQueueAccess(actor, "unscoped", database)).resolves.toMatchObject({
      id: "unscoped",
    });
    expect(receivedWhere).toMatchObject({
      OR: expect.arrayContaining([{ locations: { none: {} } }]),
    });
  });

  it("rehydrates current location grants instead of trusting the stream actor", async () => {
    const database = {
      practiceMembership: {
        findUnique: async () => ({
          locationScope: "SELECTED",
          locations: [{ locationId: "current-location" }],
        }),
      },
    } as never;

    await expect(
      rehydrateQueueAccessActor({ practiceId: "practice-1", userId: "user-1" }, database),
    ).resolves.toEqual({
      allowedLocationIds: ["current-location"],
      hasAllLocationAccess: false,
      practiceId: "practice-1",
      userId: "user-1",
    });
  });

  it("returns the same not-found response for cross-tenant and inaccessible queues", async () => {
    const database = {
      callCenterQueue: {
        findFirst: async () => null,
      },
    } as never;

    await expect(
      resolveQueueAccess(actor, "other-tenant", database),
    ).rejects.toBeInstanceOf(QueueAccessError);
  });
});
