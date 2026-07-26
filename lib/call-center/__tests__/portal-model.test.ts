import { describe, expect, it } from "bun:test";

import {
  buildPortalNeedsActionGroups,
  type PortalCallActivityItem,
} from "@/lib/call-center/portal-model";

function activity(
  taskId: string,
  overrides: Partial<PortalCallActivityItem> = {},
): PortalCallActivityItem {
  return {
    callerName: null,
    createdAt: new Date("2026-07-25T12:00:00.000Z"),
    disposition: null,
    durationSec: null,
    fromPhone: "+15555550123",
    kind: "missed",
    locationId: "location-1",
    locationName: "Optical",
    queueId: "queue-1",
    recordingId: null,
    taskId,
    ...overrides,
  };
}

describe("Call Center Needs Action caller threads", () => {
  it("normalizes phone variants and groups mixed work in one operational scope", () => {
    const groups = buildPortalNeedsActionGroups([
      activity("missed-1"),
      activity("voicemail-1", {
        createdAt: new Date("2026-07-25T12:01:00.000Z"),
        fromPhone: "(555) 555-0123",
        kind: "voicemail",
        recordingId: "recording-1",
      }),
      activity("callback-1", {
        createdAt: new Date("2026-07-25T12:02:00.000Z"),
        disposition: "CALLBACK_NEEDED",
        fromPhone: "15555550123",
        kind: "note",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      callbackNeededCount: 1,
      eventCount: 3,
      latestKind: "note",
      missedCount: 1,
      noteCount: 1,
      taskIds: ["missed-1", "voicemail-1", "callback-1"],
      voicemailCount: 1,
    });
  });

  it("keeps the same phone separate across queues and locations", () => {
    const groups = buildPortalNeedsActionGroups([
      activity("location-1"),
      activity("location-2", {
        locationId: "location-2",
        locationName: "Spring Hill",
      }),
      activity("queue-2", { queueId: "queue-2" }),
    ]);

    expect(groups).toHaveLength(3);
    expect(new Set(groups.map(({ id }) => id)).size).toBe(3);
  });
});
