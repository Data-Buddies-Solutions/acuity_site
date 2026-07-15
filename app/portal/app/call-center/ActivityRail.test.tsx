import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { PortalNeedsActionGroup } from "@/lib/call-center/portal-model";

import ActivityRail from "./ActivityRail";

afterEach(cleanup);

function voicemail(recordingId: string | null): PortalNeedsActionGroup {
  return {
    callbackNeededCount: 0,
    callerName: null,
    eventCount: 1,
    followUpRequiredCount: 0,
    fromPhone: "+15555550123",
    id: "needs-action:15555550123",
    lastActivityAt: new Date("2026-07-14T10:57:03.000Z"),
    latestKind: "voicemail",
    latestVoicemailDurationSec: recordingId ? 10 : null,
    latestVoicemailRecordingId: recordingId,
    locationNames: ["South Florida"],
    missedCount: 0,
    noteCount: 0,
    voicemailCount: 1,
  };
}

describe("ActivityRail voicemail media", () => {
  it("shows the audio control when refreshed Needs Action data gains media", () => {
    const view = render(
      <ActivityRail
        followUpHref="/follow-up"
        needsAction={[voicemail(null)]}
        needsActionCount={1}
        onCallback={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Needs action").closest("button")!);
    expect(screen.queryByRole("button", { name: "Play voicemail" })).toBeNull();

    view.rerender(
      <ActivityRail
        followUpHref="/follow-up"
        needsAction={[voicemail("recording-1")]}
        needsActionCount={1}
        onCallback={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play voicemail" }));
    expect(view.container.querySelector("audio")?.getAttribute("src")).toBe(
      "/api/portal/call-center/voicemails/recording-1",
    );
  });
});
