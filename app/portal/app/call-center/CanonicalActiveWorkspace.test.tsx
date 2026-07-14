import { createRef } from "react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AgentSessionView, CallView } from "@/lib/call-center/realtime-contract";

import {
  CallConnectionStatus,
  canonicalSessionConnectionState,
  CanonicalActiveCall,
} from "./CanonicalActiveWorkspace";
import type { useSoftphoneMedia } from "./use-softphone";

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

describe("call readiness", () => {
  it("reports automatic startup as connecting instead of trying to release", () => {
    expect(canonicalSessionConnectionState("CLOSED", true)).toBe("CONNECTING");
    expect(canonicalSessionConnectionState("CLOSED", false)).toBe("CLOSED");
  });

  it("renders one durable connection status with no readiness control", () => {
    const view = render(<CallConnectionStatus session={null} />);

    expect(screen.getByRole("status").textContent).toBe("Not connected");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();

    view.rerender(<CallConnectionStatus session={readySession()} />);
    expect(screen.getByRole("status").textContent).toBe("Connected");

    view.rerender(
      <CallConnectionStatus
        session={readySession({ microphoneReady: false, presence: "PAUSED" })}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Not connected");

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
    expect(screen.getByRole("status").textContent).toBe("Not connected");
  });
});

function mediaControls(
  state: "ACTIVE" | "HELD" | "RINGING" = "ACTIVE",
  holdResult: boolean | undefined = undefined,
) {
  const controls = {
    activate: mock(() => {}),
    answer: mock(async () => {}),
    connection: "READY" as const,
    deactivate: mock(() => true),
    decline: mock(async () => {}),
    dial: mock(() => "media-leg-1"),
    error: null,
    hangup: mock(async () => {}),
    hold: mock(async () => holdResult),
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
    remoteAudioRef: createRef<HTMLAudioElement>(),
    sendDtmf: mock(() => {}),
    setupError: null,
    setupPending: false,
    soundReady: true,
  };

  return controls as typeof controls & ReturnType<typeof useSoftphoneMedia>;
}

describe("CanonicalActiveCall", () => {
  it("restores connected inbound controls and routes them through canonical media", async () => {
    const media = mediaControls();
    const onTransfer = mock(async () => {});

    render(
      <CanonicalActiveCall
        actionsEnabled
        call={connectedCall("INBOUND")}
        clientInstanceId="client-1"
        endpointId="endpoint-1"
        media={media}
        onTakeTransfer={mock(async () => {})}
        onTransfer={onTransfer}
        operations={null}
        sessionId="session-1"
        transferTargets={[{ name: "202 - Seat 2", userId: "user-2" }]}
        transferTakeCandidate={null}
      />,
    );

    expect(screen.getByText("(954) 609-7250")).toBeTruthy();
    expect(screen.getByText("Patient call")).toBeTruthy();
    expect(screen.getByText("00:00")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(media.mute).toHaveBeenCalledWith("media-leg-1", true);
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    await waitFor(() => expect(media.hold).toHaveBeenCalledWith("media-leg-1", true));
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keypad" }));
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    expect(media.sendDtmf).toHaveBeenCalledWith("media-leg-1", "5");

    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    expect(onTransfer).toHaveBeenCalledWith(expect.anything(), "user-2");

    const fetchEnd = mock(async () => new Response("{}", { status: 202 }));
    globalThis.fetch = fetchEnd as never;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End" }));
    });
    expect(fetchEnd).toHaveBeenCalledWith(
      "/api/portal/call-center/calls/call-inbound/end",
      expect.objectContaining({
        body: JSON.stringify({ clientInstanceId: "client-1" }),
        headers: expect.objectContaining({
          "Idempotency-Key": "canonical-end:call-inbound:session-1:agent-leg-1",
        }),
        method: "POST",
      }),
    );
    expect(media.hangup).not.toHaveBeenCalled();
  });

  it("durably rejects a ringing offer through the server-owned hangup", async () => {
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
        actionsEnabled
        call={offered}
        clientInstanceId="client-1"
        endpointId="endpoint-1"
        media={media}
        onTakeTransfer={mock(async () => {})}
        onTransfer={mock(async () => {})}
        operations={null}
        sessionId="session-1"
        transferTargets={[]}
        transferTakeCandidate={null}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End" }));
    });

    expect(fetchEnd).toHaveBeenCalledTimes(1);
    expect(media.hangup).not.toHaveBeenCalled();
  });

  it("shows the outbound patient number and connected controls", () => {
    render(
      <CanonicalActiveCall
        actionsEnabled
        call={connectedCall("OUTBOUND")}
        clientInstanceId="client-1"
        endpointId="endpoint-1"
        media={mediaControls()}
        onTakeTransfer={mock(async () => {})}
        onTransfer={mock(async () => {})}
        operations={null}
        sessionId="session-1"
        transferTargets={[]}
        transferTakeCandidate={null}
      />,
    );

    expect(screen.getByText("(954) 287-2010")).toBeTruthy();
    expect(screen.getByText("Outbound")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mute" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hold" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keypad" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "End" })).toBeTruthy();
  });

  it("disables an expanded keypad when calling actions become unavailable", () => {
    const props = {
      call: connectedCall("INBOUND"),
      clientInstanceId: "client-1",
      endpointId: "endpoint-1",
      media: mediaControls(),
      onTakeTransfer: mock(async () => {}),
      onTransfer: mock(async () => {}),
      operations: null,
      sessionId: "session-1",
      transferTargets: [],
      transferTakeCandidate: null,
    };
    const view = render(<CanonicalActiveCall actionsEnabled {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Keypad" }));
    view.rerender(<CanonicalActiveCall actionsEnabled={false} {...props} />);

    expect(
      (screen.getByRole("button", { name: "5" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("offers Resume when the canonical media leg is already held", async () => {
    const media = mediaControls("HELD");

    render(
      <CanonicalActiveCall
        actionsEnabled
        call={connectedCall("INBOUND")}
        clientInstanceId="client-1"
        endpointId="endpoint-1"
        media={media}
        onTakeTransfer={mock(async () => {})}
        onTransfer={mock(async () => {})}
        operations={null}
        sessionId="session-1"
        transferTargets={[]}
        transferTakeCandidate={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    await waitFor(() => expect(media.hold).toHaveBeenCalledWith("media-leg-1", false));
  });

  it("keeps the requested hold state when the provider updates during the request", async () => {
    let resolveHold: ((updated: boolean) => void) | undefined;
    const media = mediaControls();
    media.hold = mock(
      () =>
        new Promise<boolean>((resolve) => {
          resolveHold = resolve;
        }),
    );
    const props = {
      actionsEnabled: true,
      call: connectedCall("INBOUND"),
      clientInstanceId: "client-1",
      endpointId: "endpoint-1",
      media,
      onTakeTransfer: mock(async () => {}),
      onTransfer: mock(async () => {}),
      operations: null,
      sessionId: "session-1",
      transferTargets: [],
      transferTakeCandidate: null,
    };
    const view = render(<CanonicalActiveCall {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    media.observations = [{ ...media.observations[0], state: "HELD" }];
    view.rerender(<CanonicalActiveCall {...props} />);
    await act(async () => resolveHold?.(true));

    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("keeps Hold active when the provider resolves the request as failed", async () => {
    const media = mediaControls("ACTIVE", false);

    render(
      <CanonicalActiveCall
        actionsEnabled
        call={connectedCall("INBOUND")}
        clientInstanceId="client-1"
        endpointId="endpoint-1"
        media={media}
        onTakeTransfer={mock(async () => {})}
        onTransfer={mock(async () => {})}
        operations={null}
        sessionId="session-1"
        transferTargets={[]}
        transferTakeCandidate={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Hold" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The phone service is temporarily unavailable. Try again in a moment.",
    );
    expect(screen.getByRole("button", { name: "Hold" })).toBeTruthy();
  });
});
