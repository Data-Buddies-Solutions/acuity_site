import { describe, expect, it } from "bun:test";

import { CANONICAL_NEEDS_ACTION_PREVIEW_LIMIT } from "@/lib/call-center/application/portal-canonical-history";

import {
  createFollowUpPreviewHandler,
  createResolveFollowUpPreviewHandler,
} from "./handler";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};

describe("call center follow-up preview route", () => {
  it("passes authenticated scope and returns a private bounded response", async () => {
    const received: Record<string, unknown>[] = [];
    const GET = createFollowUpPreviewHandler({
      getActor: async () => actor,
      readPreview: async (receivedActor, options) => {
        received.push({ actor: receivedActor, options });
        return Array.from(
          { length: CANONICAL_NEEDS_ACTION_PREVIEW_LIMIT + 1 },
          (_, index) => ({
            callerName: null,
            createdAt: new Date("2026-07-19T10:00:00.000Z"),
            disposition: null,
            durationSec: null,
            fromPhone: `+15555550${index.toString().padStart(3, "0")}`,
            id: `task-${index}`,
            kind: "missed" as const,
            locationName: "Optical",
            recordingId: null,
            taskId: `task-${index}`,
          }),
        );
      },
    });

    const response = await GET(
      new Request(
        "https://example.test/api/portal/call-center/follow-up-preview?queueId=queue-1&locationId=location-1",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.limit).toBe(CANONICAL_NEEDS_ACTION_PREVIEW_LIMIT);
    expect(body.items).toHaveLength(CANONICAL_NEEDS_ACTION_PREVIEW_LIMIT);
    expect(received).toEqual([
      {
        actor,
        options: { locationIds: ["location-1"], queueId: "queue-1" },
      },
    ]);
  });

  it("rejects requests without a queue before reading data", async () => {
    let reads = 0;
    const GET = createFollowUpPreviewHandler({
      getActor: async () => actor,
      readPreview: async () => {
        reads += 1;
        return [];
      },
    });

    const response = await GET(
      new Request("https://example.test/api/portal/call-center/follow-up-preview"),
    );

    expect(response.status).toBe(400);
    expect(reads).toBe(0);
  });

  it("authorizes and resolves the selected caller thread", async () => {
    const received: Record<string, unknown>[] = [];
    const POST = createResolveFollowUpPreviewHandler({
      followUp: {
        resolveCallerThread: async (receivedActor, input) => {
          received.push({ actor: receivedActor, input });
          return {
            canonicalTasksResolved: 2,
            occurredAt: "2026-07-21T12:00:00.000Z",
            operationType: "CALLER_THREAD_RESOLUTION",
            replayed: false,
            revision: "1",
            status: "CONFIRMED",
          };
        },
      },
      getActor: async () => actor,
    });

    const response = await POST(
      new Request("https://example.test/api/portal/call-center/follow-up-preview", {
        body: JSON.stringify({
          idempotencyKey: "resolve-1",
          locationId: "location-1",
          phone: "+15555550123",
          queueId: "queue-1",
          taskIds: ["task-1", "task-2"],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({ ok: true, resolvedCount: 2 });
    expect(received[0]).toMatchObject({
      actor,
      input: {
        expectedTaskIds: ["task-1", "task-2"],
        idempotencyKey: "resolve-1",
        locationId: "location-1",
        phone: "+15555550123",
        queueId: "queue-1",
      },
    });
  });

  it("rejects malformed resolution bodies before authentication", async () => {
    let actorReads = 0;
    const POST = createResolveFollowUpPreviewHandler({
      followUp: {
        resolveCallerThread: async () => {
          throw new Error("unused");
        },
      },
      getActor: async () => {
        actorReads += 1;
        return actor;
      },
    });

    const response = await POST(
      new Request("https://example.test/api/portal/call-center/follow-up-preview", {
        body: "{",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(actorReads).toBe(0);
  });
});
