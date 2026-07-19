import { describe, expect, it } from "bun:test";

import { QueueAccessError } from "@/lib/call-center/auth/queue-access";

import { createSnapshotHandler } from "./handler";

const actor = {
  allowedLocationIds: [],
  hasAllLocationAccess: true,
  practiceId: "practice-1",
  userId: "user-1",
};

describe("canonical call center snapshot route", () => {
  it("requires an authenticated actor", async () => {
    const GET = createSnapshotHandler({
      getActor: async () => {
        throw new Error("Unauthorized");
      },
      readSnapshot: async () => {
        throw new Error("should not run");
      },
    });

    await expect(
      GET(
        new Request(
          "https://example.test/api/portal/call-center/snapshot?queueId=q1&clientInstanceId=tab-1",
        ),
      ),
    ).rejects.toThrow("Unauthorized");
  });

  it("passes only the authenticated actor and explicit queue to the snapshot query", async () => {
    const GET = createSnapshotHandler({
      getActor: async () => actor,
      readSnapshot: async (receivedActor, queueId) => {
        expect(receivedActor).toEqual(actor);
        expect(queueId).toBe("queue-1");
        return {
          calls: [],
          agentProfile: null,
          openTaskCount: 0,
          queueId: "queue-1",
          schemaVersion: 3,
          tasks: [],
        };
      },
    });
    const response = await GET(
      new Request(
        "https://example.test/api/portal/call-center/snapshot?queueId=queue-1&clientInstanceId=tab-1",
      ),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).queueId).toBe("queue-1");
  });

  it("does not reveal whether an inaccessible queue exists", async () => {
    const GET = createSnapshotHandler({
      getActor: async () => actor,
      readSnapshot: async () => {
        throw new QueueAccessError();
      },
    });
    await expect(
      GET(
        new Request(
          "https://example.test/api/portal/call-center/snapshot?queueId=q2&clientInstanceId=tab-1",
        ),
      ),
    ).rejects.toBeInstanceOf(QueueAccessError);
  });
});
