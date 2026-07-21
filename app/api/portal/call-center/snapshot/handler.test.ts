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
      reportRead: () => {},
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
    const reads: Record<string, unknown>[] = [];
    const times = [10, 22];
    const GET = createSnapshotHandler({
      getActor: async () => actor,
      now: () => times.shift() ?? 22,
      readSnapshot: async (receivedActor, queueId) => {
        expect(receivedActor).toEqual(actor);
        expect(queueId).toBe("queue-1");
        return {
          calls: [],
          observedAt: "2026-07-19T10:00:00.000Z",
          queueId: "queue-1",
          selectedQueueCallIds: [],
          schemaVersion: 8,
        };
      },
      reportRead: (context) => reads.push(context),
      revision: "test-revision",
    });
    const response = await GET(
      new Request(
        "https://example.test/api/portal/call-center/snapshot?queueId=queue-1&clientInstanceId=tab-1",
        {
          headers: {
            "X-Call-Center-Retry-Attempt": "2",
            "X-Call-Center-Retry-Delay-Ms": "1750",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("server-timing")).toMatch(/^operator-state;dur=/);
    expect(response.headers.get("x-call-center-schema-version")).toBe("8");
    expect((await response.json()).queueId).toBe("queue-1");
    expect(reads).toEqual([
      {
        durationMs: 12,
        resultClass: "success",
        retryAttempt: 2,
        retryDelayMs: 1750,
        revision: "test-revision",
        schemaVersion: 8,
      },
    ]);
  });

  it("does not reveal whether an inaccessible queue exists", async () => {
    const reads: Record<string, unknown>[] = [];
    const GET = createSnapshotHandler({
      getActor: async () => actor,
      now: () => 10,
      readSnapshot: async () => {
        throw new QueueAccessError();
      },
      reportRead: (context) => reads.push(context),
    });
    await expect(
      GET(
        new Request(
          "https://example.test/api/portal/call-center/snapshot?queueId=q2&clientInstanceId=tab-1",
        ),
      ),
    ).rejects.toBeInstanceOf(QueueAccessError);
    expect(reads).toEqual([
      expect.objectContaining({
        durationMs: 0,
        resultClass: "error",
        revision: "local",
        retryAttempt: 0,
        retryDelayMs: 0,
        schemaVersion: 8,
      }),
    ]);
  });
});
