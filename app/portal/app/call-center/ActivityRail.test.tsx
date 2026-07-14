import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { PortalNeedsActionGroup } from "@/lib/call-center";

import ActivityRail from "./ActivityRail";

afterEach(cleanup);

const totals = {
  activeCalls: 0,
  availableStations: 0,
  busyStations: 0,
  historyCalls: 1,
  missedCallers: 0,
  missedCalls: 0,
  needsActionCallers: 1,
  needsActionEvents: 1,
  pausedStations: 0,
  voicemailCallers: 1,
  voicemails: 1,
  waitingCalls: 0,
};

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
    recordIds: ["task-1"],
    voicemailCount: 1,
  };
}

describe("ActivityRail voicemail media", () => {
  it("shows the audio control when refreshed Needs Action data gains media", () => {
    const view = render(
      <ActivityRail
        followUpHref="/follow-up"
        needsAction={[voicemail(null)]}
        onCallback={() => {}}
        totals={totals}
      />,
    );

    fireEvent.click(screen.getByText("Needs action").closest("button")!);
    expect(screen.queryByRole("button", { name: "Play voicemail" })).toBeNull();

    view.rerender(
      <ActivityRail
        followUpHref="/follow-up"
        needsAction={[voicemail("recording-1")]}
        onCallback={() => {}}
        totals={totals}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play voicemail" }));
    expect(view.container.querySelector("audio")?.getAttribute("src")).toBe(
      "/api/portal/call-center/voicemails/recording-1",
    );
  });
});
