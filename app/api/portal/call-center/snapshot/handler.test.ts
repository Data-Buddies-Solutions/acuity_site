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
      readSnapshot: async (receivedActor, queueId, clientInstanceId) => {
        expect(receivedActor).toEqual(actor);
        expect(queueId).toBe("queue-1");
        expect(clientInstanceId).toBe("tab-1");
        return {
          agentSession: null,
          availableQueues: [{ id: "queue-1", name: "Optical" }],
          calls: [],
          counts: { active: 0, openTasks: 0, recent: 0, waiting: 0 },
          agentProfile: null,
          queue: { id: "queue-1", name: "Optical" },
          schemaVersion: 2,
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
    expect((await response.json()).queue).toEqual({
      id: "queue-1",
      name: "Optical",
    });
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
