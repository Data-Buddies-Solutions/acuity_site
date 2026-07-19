import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { AgentSessionView, CallView } from "@/lib/call-center/realtime-contract";

import {
  CallConnectionStatus,
  canonicalSessionConnectionState,
  CanonicalActiveCall,
} from "./CanonicalActiveWorkspace";

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
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

function readySession(update: Partial<AgentSessionView> = {}): AgentSessionView {
  return {
    audioReady: true,
    clientInstanceId: "browser-1",
    connectionState: "READY",
    endpointId: "endpoint-1",
    id: "session-1",
    leaseExpiresAt: "2026-07-14T12:01:00.000Z",
    microphoneReady: true,
    presence: "AVAILABLE",
    stateVersion: 1,
    ...update,
  };
}

describe("call readiness", () => {
  it("reports automatic startup as connecting instead of trying to release", () => {
    expect(canonicalSessionConnectionState("CLOSED", true)).toBe("CONNECTING");
    expect(canonicalSessionConnectionState("CLOSED", false)).toBe("CLOSED");
  });

  it("renders one durable connection status with no readiness control", () => {
    const view = render(<CallConnectionStatus session={null} />);

    expect(screen.getByRole("status").textContent).toBe(
      "Phone disconnected — reconnecting",
    );
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
    expect(screen.getByRole("status").textContent).toBe(
      "Phone disconnected — reconnecting",
    );

    view.rerender(
      <CallConnectionStatus
        session={readySession({ connectionState: "CONNECTING", presence: "PAUSED" })}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Connected");

    view.rerender(<CallConnectionStatus session={readySession({ presence: "BUSY" })} />);
    expect(screen.getByRole("status").textContent).toBe("Connected");

    view.rerender(
      <CallConnectionStatus
        session={readySession({ connectionState: "FAILED", presence: "PAUSED" })}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Phone disconnected — reconnecting",
    );
  });
});

function callControls(availability: "PREPARING" | "READY" | "RECOVERING" = "READY") {
  const controls = {
    callAvailability: mock(() => availability),
    hangup: mock(() => {}),
    mute: mock(() => {}),
  };

  return controls;
}

describe("CanonicalActiveCall", () => {
  it("restores connected inbound controls and routes them through canonical media", async () => {
    const controls = callControls();

    render(<CanonicalActiveCall call={connectedCall("INBOUND")} controls={controls} />);

    expect(screen.getByText("(954) 609-7250")).toBeTruthy();
    expect(screen.getByText("Patient call")).toBeTruthy();
    expect(screen.getByText("00:00")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(controls.mute).toHaveBeenCalledWith("call-inbound", true);
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();

    const fetchEnd = mock(async () => new Response("{}", { status: 202 }));
    globalThis.fetch = fetchEnd as never;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End" }));
    });
    expect(fetchEnd).not.toHaveBeenCalled();
    expect(controls.hangup).toHaveBeenCalledWith("call-inbound");
  });

  it("rejects a ringing offer directly through the persistent softphone", async () => {
    const offered = connectedCall("INBOUND");
    offered.answeredAt = null;
    offered.status = "RINGING";
    offered.winningLegId = null;
    offered.legs[0]!.status = "RINGING";
    const controls = callControls();
    const fetchEnd = mock(async () => new Response("{}", { status: 202 }));
    globalThis.fetch = fetchEnd as never;

    render(<CanonicalActiveCall call={offered} controls={controls} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End" }));
    });

    expect(fetchEnd).not.toHaveBeenCalled();
    expect(controls.hangup).toHaveBeenCalledWith("call-inbound");
  });

  it("shows the outbound patient number and connected controls", () => {
    render(
      <CanonicalActiveCall call={connectedCall("OUTBOUND")} controls={callControls()} />,
    );

    expect(screen.getByText("(954) 287-2010")).toBeTruthy();
    expect(screen.getByText("Outbound")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mute" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "End" })).toBeTruthy();
  });

  it("keeps the active call visible while its logical binding recovers", () => {
    render(
      <CanonicalActiveCall
        call={connectedCall("INBOUND")}
        controls={callControls("RECOVERING")}
      />,
    );

    expect(screen.getByText("(954) 609-7250")).toBeTruthy();
    expect(screen.getByText("Reconnecting…")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Mute" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "End" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
