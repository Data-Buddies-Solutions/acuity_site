import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AgentSessionView, CallView } from "@/lib/call-center/realtime-contract";

const push = mock(() => {});
mock.module("next/navigation", () => ({
  useRouter: () => ({ push, refresh: mock(() => {}) }),
}));

import {
  CallConnectionStatus,
  canonicalSessionConnectionState,
  CanonicalActiveCall,
  CanonicalConnectingOutbound,
  selectCanonicalLocalCallPresentation,
} from "./CanonicalActiveWorkspace";
import { CallCenterLeaveGuard } from "./CallCenterLeaveGuard";
import { IncomingCallHeadsUp } from "./IncomingCallHeadsUp";
import { IncomingOfferAnnouncement } from "./IncomingOfferAnnouncement";
import type { useSoftphoneMedia } from "./use-softphone";

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  push.mockClear();
});

function connectedCall(direction: CallView["direction"]): CallView {
  return {
    answeredAt: new Date().toISOString(),
    callerName: null,
    direction,
    endedAt: null,
    fromPhone: "+19546097250",
    id: `call-${direction.toLowerCase()}`,
    legs: [
      {
        agentSessionId: "session-1",
        endpointId: "endpoint-1",
        id: "agent-leg-1",
        kind: "AGENT",
        providerCallControlId: "control-1",
        providerCallLegId: "provider-leg-1",
        providerCallSessionId: "provider-session-1",
        status: "BRIDGED",
      },
    ],
    queueId: "queue-1",
    receivedAt: "2026-07-10T15:43:20.000Z",
    stateVersion: 2,
    status: "CONNECTED",
    toPhone: "+19542872010",
    winningLegId: "agent-leg-1",
  };
}

function offeredCall(): CallView {
  const call = connectedCall("INBOUND");
  call.answeredAt = null;
  call.status = "RINGING";
  call.winningLegId = null;
  call.legs[0]!.status = "RINGING";
  return call;
}

function readySession(update: Partial<AgentSessionView> = {}): AgentSessionView {
  return {
    audioReady: true,
    clientInstanceId: "browser-1",
    connectionState: "READY",
    currentCallId: null,
    endpointId: "endpoint-1",
    id: "session-1",
    leaseExpiresAt: "2026-07-14T12:01:00.000Z",
    microphoneReady: true,
    offeredCallId: null,
    presence: "AVAILABLE",
    stateVersion: 1,
    ...update,
  };
}

describe("incoming call interaction", () => {
  it("uses one exact runtime media leg for ringing and Answer continuity", () => {
    const first = offeredCall();
    const second = offeredCall();
    second.id = "call-2";
    second.legs = [
      {
        ...second.legs[0]!,
        id: "agent-leg-2",
        providerCallControlId: "control-2",
        providerCallLegId: "provider-leg-2",
      },
    ];
    const media = mediaControls("RINGING");
    media.observations.push({
      ...media.observations[0]!,
      mediaLegId: "media-leg-2",
      providerCallControlId: "control-2",
      providerCallLegId: "provider-leg-2",
    });

    const ringing = selectCanonicalLocalCallPresentation({
      calls: [first, second],
      mediaObservations: media.observations,
      offeredMediaLegId: "media-leg-2",
      session: readySession(),
      takingMediaLegId: null,
    });
    expect(ringing.headsUpOffer?.call.id).toBe("call-2");
    expect(ringing.localCall).toBeNull();

    const connecting = selectCanonicalLocalCallPresentation({
      calls: [first, second],
      mediaObservations: media.observations,
      offeredMediaLegId: null,
      session: readySession(),
      takingMediaLegId: "media-leg-2",
    });
    expect(connecting.headsUpOffer).toBeNull();
    expect(connecting.localCall?.id).toBe("call-2");

    const unrelated = selectCanonicalLocalCallPresentation({
      calls: [first, second],
      mediaObservations: media.observations,
      offeredMediaLegId: "unrelated-leg",
      session: readySession(),
      takingMediaLegId: null,
    });
    expect(unrelated).toEqual({ headsUpOffer: null, localCall: null });
  });

  it("pairs Answer and Decline with caller and queue context", () => {
    const onAnswer = mock(() => {});
    const onDecline = mock(() => {});

    render(
      <IncomingCallHeadsUp
        call={offeredCall()}
        onAnswer={onAnswer}
        onDecline={onDecline}
        pending={null}
        queueName="Optical"
      />,
    );

    expect(screen.getByRole("region", { name: "Incoming call" })).toBeTruthy();
    expect(screen.getByText("(954) 609-7250")).toBeTruthy();
    expect(screen.getByText("Optical queue")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        "Decline means you will not answer this call. It does not end the caller’s call.",
      ),
    ).toBeTruthy();
  });

  it("keeps one live announcement for the exact incoming call", () => {
    const call = offeredCall();
    const view = render(<IncomingOfferAnnouncement call={call} queueName="Optical" />);
    const announcement = screen.getByRole("status");

    expect(announcement.textContent).toBe(
      "Incoming call from (954) 609-7250 for Optical.",
    );
    view.rerender(<IncomingOfferAnnouncement call={null} queueName="Optical" />);
    expect(announcement.textContent).toBe("");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("requires confirmation before leaving live controls", async () => {
    render(
      <>
        <CallCenterLeaveGuard active />
        <a href="/portal/app/overview">Overview</a>
      </>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Overview" }));
    expect(
      screen.getByRole("alertdialog", { name: "Leave the Call Center?" }),
    ).toBeTruthy();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    fireEvent.click(screen.getByRole("link", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave anyway" }));
    expect(push).toHaveBeenCalledWith("/portal/app/overview");
  });
});

describe("call readiness", () => {
  it("reports automatic startup as connecting instead of trying to release", () => {
    expect(canonicalSessionConnectionState("CLOSED", true)).toBe("CONNECTING");
    expect(canonicalSessionConnectionState("CLOSED", false)).toBe("CLOSED");
  });

  it("renders one durable connection status with no readiness control", () => {
    const view = render(<CallConnectionStatus session={null} />);

    expect(screen.getByRole("status").textContent).toBe("Phone disconnected");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();

    view.rerender(<CallConnectionStatus session={readySession()} />);
    expect(screen.getByRole("status").textContent).toBe("Connected");

    view.rerender(<CallConnectionStatus restoring session={readySession()} />);
    expect(screen.getByRole("status").textContent).toBe("Restoring calling…");

    view.rerender(
      <CallConnectionStatus
        session={readySession({ microphoneReady: false, presence: "PAUSED" })}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Phone disconnected");

    view.rerender(
      <CallConnectionStatus
        session={readySession({ connectionState: "CONNECTING", presence: "PAUSED" })}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Connected");

    view.rerender(
      <CallConnectionStatus
        session={readySession({ currentCallId: "call-1", presence: "BUSY" })}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Connected");

    view.rerender(
      <CallConnectionStatus
        session={readySession({ connectionState: "FAILED", presence: "PAUSED" })}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Phone disconnected");
  });
});

function mediaControls(state: "ACTIVE" | "CONNECTING" | "HELD" | "RINGING" = "ACTIVE") {
  const controls = {
    activate: mock(() => {}),
    answer: mock(async () => {}),
    connection: "READY" as const,
    deactivate: mock(() => true),
    decline: mock(async () => {}),
    dial: mock(() => "media-leg-1"),
    error: null,
    hangup: mock(async () => {}),
    hold: mock(async () => undefined),
    microphoneReady: true,
    mute: mock(() => {}),
    observations: [
      {
        connectionId: "connection-1",
        direction: "INBOUND" as const,
        mediaLegId: "media-leg-1",
        providerCallControlId: "control-1",
        providerCallLegId: "provider-leg-1",
        providerCallSessionId: "provider-session-1",
        remoteAudioReady: true,
        state,
      },
    ],
    prepare: mock(async () => true),
    sendDtmf: mock(() => {}),
    setupError: null,
    setupPending: false,
    soundReady: true,
  };

  return controls as typeof controls & ReturnType<typeof useSoftphoneMedia>;
}

describe("CanonicalActiveCall", () => {
  it("keeps outbound identity and End visible while canonical state catches up", async () => {
    const media = mediaControls("CONNECTING");

    render(
      <CanonicalConnectingOutbound
        media={media}
        mediaLegId="media-leg-1"
        phone="+19542872010"
      />,
    );

    expect(screen.getByText("(954) 287-2010")).toBeTruthy();
    expect(screen.getByText("Outbound call")).toBeTruthy();
    expect(screen.getByText("Connecting…")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End" }));
    });
    expect(media.hangup).toHaveBeenCalledWith("media-leg-1");
  });

  it("restores connected inbound controls and routes them through canonical media", async () => {
    const media = mediaControls();

    const view = render(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    expect(screen.getByText("(954) 609-7250")).toBeTruthy();
    expect(screen.getByText("Inbound call")).toBeTruthy();
    expect(screen.getByText("00:00")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    });
    expect(media.hold).toHaveBeenCalledWith("media-leg-1", true);
    expect(
      (screen.getByRole("button", { name: "Holding…" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    media.observations[0]!.state = "HELD";
    view.rerender(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    });
    expect(media.hold).toHaveBeenLastCalledWith("media-leg-1", false);

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(media.mute).toHaveBeenCalledWith("media-leg-1", true);
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keypad" }));
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    expect(media.sendDtmf).toHaveBeenCalledWith("media-leg-1", "5");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    const fetchEnd = mock(async () => new Response("{}", { status: 202 }));
    globalThis.fetch = fetchEnd as never;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End" }));
    });
    expect(fetchEnd).not.toHaveBeenCalled();
    expect(media.hangup).toHaveBeenCalledWith("media-leg-1");
  });

  it("rejects a ringing offer directly through the persistent softphone", async () => {
    const offered = connectedCall("INBOUND");
    offered.answeredAt = null;
    offered.status = "RINGING";
    offered.winningLegId = null;
    offered.legs[0]!.status = "RINGING";
    const media = mediaControls("RINGING");
    const fetchEnd = mock(async () => new Response("{}", { status: 202 }));
    globalThis.fetch = fetchEnd as never;

    render(
      <CanonicalActiveCall
        call={offered}
        endpointId="endpoint-1"
        media={media}
        sessionId="session-1"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End" }));
    });

    expect(fetchEnd).not.toHaveBeenCalled();
    expect(media.hangup).toHaveBeenCalledWith("media-leg-1");
  });

  it("shows the outbound contact number and connected controls", () => {
    render(
      <CanonicalActiveCall
        call={connectedCall("OUTBOUND")}
        endpointId="endpoint-1"
        media={mediaControls()}
        sessionId="session-1"
      />,
    );

    expect(screen.getByText("(954) 287-2010")).toBeTruthy();
    expect(screen.getByText("Outbound call")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mute" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "End" })).toBeTruthy();
  });
});
