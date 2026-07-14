import { describe, expect, it } from "bun:test";

import { QueueAccessError } from "@/lib/call-center/auth/queue-access";
import type { CanonicalEventBatch } from "@/lib/call-center/application/realtime-queries";
import { CALL_CENTER_SCHEMA_VERSION } from "@/lib/call-center/realtime-contract";

import { createCanonicalEventsHandler } from "./canonical-handler";

const actor = {
  allowedLocationIds: [],
  hasAllLocationAccess: true,
  practiceId: "practice-1",
  userId: "user-1",
};
const queue = {
  id: "queue-1",
  locations: [],
  maxWaitSec: 30,
  name: "Optical",
  ringTimeoutSec: 20,
  routingMode: "LEGACY" as const,
};

async function body(response: Response) {
  return new TextDecoder().decode(await response.arrayBuffer());
}

function filteredBatch(from: number, to: number): CanonicalEventBatch {
  return {
    accessKey: "ALL",
    items: Array.from({ length: to - from + 1 }, (_, index) => ({
      projection: null,
      reset: false,
      revision: BigInt(from + index),
    })),
    scannedThrough: BigInt(to),
  };
}

function projectionBatch(revision: number): CanonicalEventBatch {
  return {
    accessKey: "ALL",
    items: [
      {
        projection: {
          aggregateId: "call-1",
          aggregateType: "CALL",
          delta: { callId: "call-1", kind: "CALL_REMOVE" },
          revision: String(revision),
          schemaVersion: CALL_CENTER_SCHEMA_VERSION,
          stateVersion: 7,
        },
        reset: false,
        revision: BigInt(revision),
      },
    ],
    scannedThrough: BigInt(revision),
  };
}

function handler(
  overrides: Partial<Parameters<typeof createCanonicalEventsHandler>[0]> = {},
) {
  return createCanonicalEventsHandler({
    readBounds: async () => ({
      latestRevision: BigInt(500),
      retentionFloor: BigInt(1),
    }),
    resolveAccess: async () => queue,
    ...overrides,
    getActor: overrides.getActor ?? (async () => actor),
  });
}

describe("canonical call center event stream", () => {
  it("prefers Last-Event-ID and resets an ahead cursor", async () => {
    const GET = handler({
      getActor: async () => actor,
      readBounds: async () => ({
        latestRevision: BigInt(12),
        retentionFloor: BigInt(1),
      }),
    });
    const response = await GET(
      new Request(
        "https://example.test/api/portal/call-center/events?contract=canonical&queueId=queue-1&clientInstanceId=tab-1&after=3",
        { headers: { "last-event-id": "20" } },
      ),
    );

    expect(await body(response)).toBe(
      'id: 12\nevent: reset\ndata: {"reason":"AHEAD_OF_STREAM","revision":"12"}\n\n',
    );
  });

  it("resets invalid and retention-gap cursors", async () => {
    for (const [after, reason] of [
      ["not-a-revision", "INVALID_CURSOR"],
      ["2", "RETENTION_GAP"],
    ] as const) {
      const GET = handler({
        getActor: async () => actor,
        readBounds: async () => ({
          latestRevision: BigInt(10),
          retentionFloor: BigInt(5),
        }),
      });
      const response = await GET(
        new Request(
          `https://example.test/api/portal/call-center/events?contract=canonical&queueId=queue-1&clientInstanceId=tab-1&after=${after}`,
        ),
      );
      expect(await body(response)).toContain(`"reason":"${reason}"`);
    }
  });

  it("emits ordered projections and a safe cursor across numeric gaps", async () => {
    const GET = handler({
      getActor: async () => actor,
      readBatch: async () => ({
        accessKey: "ALL",
        items: [...filteredBatch(8, 10).items, ...projectionBatch(11).items],
        scannedThrough: BigInt(11),
      }),
    });
    const response = await GET(
      new Request(
        "https://example.test/api/portal/call-center/events?contract=canonical&queueId=queue-1&clientInstanceId=tab-1&after=7",
      ),
    );
    const reader = response.body?.getReader();
    const first = await reader?.read();
    await reader?.cancel();
    const text = new TextDecoder().decode(first?.value);

    expect(text).not.toContain("id: 8");
    expect(text).toContain("id: 11\nevent: projection");
    expect(text).toContain('"stateVersion":7');
    expect(text).toContain("id: 11\nevent: cursor");
  });

  it("announces a planned rotation before the bounded stream closes", async () => {
    const GET = handler({ clock: () => 1, streamLifetimeMs: 0 });
    const response = await GET(
      new Request(
        "https://example.test/api/portal/call-center/events?contract=canonical&queueId=queue-1&clientInstanceId=tab-1&after=7",
      ),
    );

    expect(await body(response)).toBe(
      'event: rotate\ndata: {"reason":"STREAM_LIFETIME"}\n\n',
    );
  });

  it("persists progress through filtered batches across bounded reconnects", async () => {
    const cursors: bigint[] = [];
    const GET = handler({
      getActor: async () => actor,
      readBatch: async (_identity, _queueId, _clientInstanceId, cursor) => {
        cursors.push(cursor);
        if (cursor === BigInt(7)) return filteredBatch(8, 107);
        if (cursor === BigInt(107)) return filteredBatch(108, 207);
        return projectionBatch(210);
      },
    });
    const request = (lastEventId: string) =>
      GET(
        new Request(
          "https://example.test/api/portal/call-center/events?contract=canonical&queueId=queue-1&clientInstanceId=tab-1",
          { headers: { "last-event-id": lastEventId } },
        ),
      );

    for (const [input, output] of [
      ["7", "107"],
      ["107", "207"],
      ["207", "210"],
    ]) {
      const response = await request(input);
      const reader = response.body?.getReader();
      const first = await reader?.read();
      await reader?.cancel();
      expect(new TextDecoder().decode(first?.value)).toContain(
        `id: ${output}\nevent: cursor`,
      );
    }
    expect(cursors).toEqual([BigInt(7), BigInt(107), BigInt(207)]);
  });

  it("closes with an access reset when queue membership changes", async () => {
    const reported: string[] = [];
    const GET = handler({
      getActor: async () => actor,
      readBatch: async () => {
        throw new QueueAccessError();
      },
      reportFailure: (errorCode) => reported.push(errorCode),
    });
    const response = await GET(
      new Request(
        "https://example.test/api/portal/call-center/events?contract=canonical&queueId=queue-1&clientInstanceId=tab-1&after=1",
      ),
    );

    expect(await body(response)).toContain('"reason":"ACCESS_CHANGED"');
    expect(reported).toEqual(["CALL_CENTER_STREAM_ACCESS_CHANGED"]);
  });

  it("requests a fresh snapshot for a configuration event", async () => {
    const GET = handler({
      getActor: async () => actor,
      readBatch: async () => ({
        accessKey: "ALL",
        items: [
          {
            projection: null,
            reset: true,
            revision: BigInt(9),
          },
        ],
        scannedThrough: BigInt(9),
      }),
    });
    const response = await GET(
      new Request(
        "https://example.test/api/portal/call-center/events?contract=canonical&queueId=queue-1&clientInstanceId=tab-1&after=8",
      ),
    );

    expect(await body(response)).toContain('"reason":"UNAPPLICABLE_DELTA"');
  });

  it("reports only categorical post-start failures", async () => {
    const reported: string[] = [];
    const GET = handler({
      getActor: async () => actor,
      readBatch: async () => {
        throw new Error("patient phone +17865550100");
      },
      reportFailure: (errorCode) => reported.push(errorCode),
    });
    const response = await GET(
      new Request(
        "https://example.test/api/portal/call-center/events?contract=canonical&queueId=queue-1&clientInstanceId=tab-1&after=1",
      ),
    );

    expect(await body(response)).toBe("");
    expect(reported).toEqual(["CALL_CENTER_STREAM_POLL_FAILED"]);
  });

  it("resets before delivery when current location grants change", async () => {
    const reported: string[] = [];
    const GET = handler({
      getActor: async () => actor,
      readBatch: async () => ({
        ...filteredBatch(2, 2),
        accessKey: "SELECTED:location-1",
      }),
      reportFailure: (errorCode) => reported.push(errorCode),
    });
    const response = await GET(
      new Request(
        "https://example.test/api/portal/call-center/events?contract=canonical&queueId=queue-1&clientInstanceId=tab-1&after=1",
      ),
    );

    expect(await body(response)).toContain('"reason":"ACCESS_CHANGED"');
    expect(reported).toEqual(["CALL_CENTER_STREAM_ACCESS_CHANGED"]);
  });

  it("closes categorically instead of buffering another frame", async () => {
    const reported: string[] = [];
    let clockCalls = 0;
    const GET = handler({
      clock: () => (clockCalls++ < 2 ? 0 : 11_000),
      getActor: async () => actor,
      readBatch: async () => projectionBatch(2),
      reportFailure: (errorCode) => reported.push(errorCode),
    });
    const response = await GET(
      new Request(
        "https://example.test/api/portal/call-center/events?contract=canonical&queueId=queue-1&clientInstanceId=tab-1&after=1",
      ),
    );

    expect(await body(response)).toContain("id: 2");
    expect(reported).toEqual(["CALL_CENTER_STREAM_BACKPRESSURE"]);
  });
});
