import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import type { PortalNeedsActionGroup } from "@/lib/call-center/portal-model";

import FollowUpCommandCenter from "./FollowUpCommandCenter";

afterEach(cleanup);

describe("FollowUpCommandCenter", () => {
  it("submits and links using the selected thread's queue and location scope", () => {
    const thread: PortalNeedsActionGroup = {
      callbackNeededCount: 0,
      callerName: null,
      eventCount: 1,
      followUpRequiredCount: 0,
      fromPhone: "+15555550123",
      id: "thread-1",
      lastActivityAt: new Date("2026-07-25T12:00:00.000Z"),
      latestKind: "missed",
      latestVoicemailDurationSec: null,
      latestVoicemailRecordingId: null,
      locationId: "thread-location",
      locationNames: ["Optical"],
      missedCount: 1,
      noteCount: 0,
      queueId: "thread-queue",
      taskIds: ["task-1"],
      voicemailCount: 0,
    };
    const { container } = render(
      <FollowUpCommandCenter
        office="page-location"
        page={1}
        queue="page-queue"
        threads={[thread]}
        totalPages={1}
        totalThreads={1}
      />,
    );

    const forms = [...container.querySelectorAll("form")];
    expect(forms).toHaveLength(2);
    expect(
      [...container.querySelectorAll('input[name="office"]')].map(
        (input) => (input as HTMLInputElement).value,
      ),
    ).toEqual(["thread-location", "thread-location"]);
    expect(
      [...container.querySelectorAll('input[name="queue"]')].map(
        (input) => (input as HTMLInputElement).value,
      ),
    ).toEqual(["thread-queue", "thread-queue"]);
    const callLinks = [...container.querySelectorAll('a[aria-label^="Call back"]')];
    expect(callLinks[0]?.getAttribute("href")).toContain("office=thread-location");
    expect(callLinks[0]?.getAttribute("href")).toContain("queue=thread-queue");
  });
});
