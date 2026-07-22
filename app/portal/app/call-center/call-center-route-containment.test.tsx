import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Component, type ReactNode } from "react";

import type { AgentSessionView } from "@/lib/call-center/realtime-contract";

import { useSoftphoneRuntime } from "./softphone-runtime-context";

const clients: FakeTelnyxClient[] = [];

class FakeTelnyxClient {
  handlers = new Map<string, (...args: unknown[]) => void>();
  disconnectCount = 0;
  remoteElement: HTMLAudioElement | null = null;

  constructor(_credentials: unknown) {
    clients.push(this);
  }

  connect() {
    this.handlers.get("telnyx.ready")?.();
  }

  disconnect() {
    this.disconnectCount += 1;
  }

  off(event: string) {
    this.handlers.delete(event);
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, handler);
  }
}

mock.module("@telnyx/webrtc", () => ({ TelnyxRTC: FakeTelnyxClient }));

const { SoftphoneRuntime } = await import("../SoftphoneRuntime");
const { default: CallCenterError } = await import("./error");

const originalAudio = globalThis.Audio;
const originalAudioContext = window.AudioContext;
const originalBroadcastChannel = globalThis.BroadcastChannel;
const originalConsoleError = console.error;
const originalFetch = globalThis.fetch;
const originalMediaDevices = navigator.mediaDevices;
let availabilityPatchAttempts = 0;
let connectedOccupancy = false;
let expireSessionOnNextPatch = false;
let rejectAvailabilityChange = false;
let reopenSessionOnNextAcquire = false;

class FakeAudioContext {
  currentTime = 0;
  destination = {};

  close() {
    return Promise.resolve();
  }

  createGain() {
    return {
      connect: () => {},
      gain: {
        linearRampToValueAtTime: () => {},
        setValueAtTime: () => {},
      },
    };
  }

  createOscillator() {
    return {
      connect: () => {},
      frequency: { value: 0 },
      start: () => {},
      stop: () => {},
    };
  }

  resume() {
    return Promise.resolve();
  }
}

class WorkspaceBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    return this.state.error ? (
      <CallCenterError
        error={this.state.error}
        reset={() => this.setState({ error: null })}
      />
    ) : (
      this.props.children
    );
  }
}

function FailingWorkspace() {
  const runtime = useSoftphoneRuntime();
  if (runtime.media.connection === "READY") {
    throw new Error("Workspace render failed");
  }
  return <p>Workspace starting</p>;
}

function AvailabilityProbe() {
  const runtime = useSoftphoneRuntime();
  return (
    <div>
      <p>Intent: {runtime.availabilityIntent}</p>
      <p>Presence: {runtime.session?.presence ?? "OFFLINE"}</p>
      <p>Connection: {runtime.media.connection}</p>
      <p>
        Media ready: {String(runtime.media.microphoneReady && runtime.media.soundReady)}
      </p>
      <button
        onClick={() => void runtime.setAvailability("AVAILABLE").catch(() => {})}
        type="button"
      >
        Become available
      </button>
    </div>
  );
}

describe("Call Center route failure containment", () => {
  beforeEach(() => {
    clients.length = 0;
    availabilityPatchAttempts = 0;
    connectedOccupancy = false;
    expireSessionOnNextPatch = false;
    rejectAvailabilityChange = false;
    reopenSessionOnNextAcquire = false;
    window.sessionStorage.clear();
    Object.defineProperty(globalThis, "Audio", {
      configurable: true,
      value: window.Audio,
      writable: true,
    });
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }),
      },
    });
    console.error = mock(() => {});

    let session: AgentSessionView | null = null;
    globalThis.fetch = mock(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/token")) {
        return Response.json({ token: "canonical-token" });
      }
      if (url === "/api/portal/call-center/agent-sessions" && method === "POST") {
        const { clientInstanceId } = JSON.parse(String(init?.body));
        if (session && !reopenSessionOnNextAcquire) {
          return Response.json({
            leaseContinuity: "REPLAYED",
            leaseDurationMs: 60_000,
            session,
          });
        }
        const reconnecting = Boolean(session && reopenSessionOnNextAcquire);
        reopenSessionOnNextAcquire = false;
        session = {
          audioReady: false,
          clientInstanceId,
          connectionState: "CONNECTING",
          endpointId: "endpoint-1",
          id: "session-1",
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          microphoneReady: false,
          presence: "PAUSED",
          stateVersion: 0,
        };
        return Response.json({
          leaseContinuity: reconnecting ? "RECONNECTED" : "ACQUIRED",
          leaseDurationMs: 60_000,
          session,
        });
      }
      if (method === "PATCH" && session) {
        if (expireSessionOnNextPatch) {
          expireSessionOnNextPatch = false;
          reopenSessionOnNextAcquire = true;
          return Response.json(
            {
              error: {
                code: "SESSION_EXPIRED",
                referenceId: "ABC123",
                retryable: true,
              },
            },
            { status: 409 },
          );
        }
        const readiness = JSON.parse(String(init?.body));
        if (readiness.availabilityChange) {
          availabilityPatchAttempts += 1;
          if (rejectAvailabilityChange) {
            return Response.json({ error: "Availability rejected" }, { status: 409 });
          }
        }
        const availabilityIntent =
          readiness.availabilityIntent ??
          (session.presence === "AVAILABLE" || session.presence === "BUSY"
            ? "AVAILABLE"
            : "PAUSED");
        const effectivelyAvailable =
          availabilityIntent === "AVAILABLE" &&
          readiness.connectionState === "READY" &&
          readiness.microphoneReady &&
          readiness.audioReady;
        session = {
          ...session,
          audioReady: readiness.audioReady,
          connectionState: readiness.connectionState,
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          microphoneReady: readiness.microphoneReady,
          presence: connectedOccupancy
            ? "BUSY"
            : availabilityIntent === "AVAILABLE" && !effectivelyAvailable
              ? "PAUSED"
              : availabilityIntent,
          stateVersion: session.stateVersion + 1,
        };
        return Response.json({ session });
      }
      return Response.json({});
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    Object.defineProperty(globalThis, "Audio", {
      configurable: true,
      value: originalAudio,
      writable: true,
    });
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: originalBroadcastChannel,
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: originalAudioContext,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  it("keeps the connected phone mounted when the workspace render fails", async () => {
    const view = render(
      <SoftphoneRuntime>
        <WorkspaceBoundary>
          <FailingWorkspace />
        </WorkspaceBoundary>
      </SoftphoneRuntime>,
    );

    await waitFor(() =>
      expect(screen.getByText("Call Center workspace unavailable").textContent).toBe(
        "Call Center workspace unavailable",
      ),
    );
    expect(screen.getByText("Connected").textContent).toBe("Connected");
    expect(clients).toHaveLength(1);
    expect(clients[0]?.disconnectCount).toBe(0);

    view.unmount();
    expect(clients[0]?.disconnectCount).toBe(1);
  });

  it("preserves Available intent while canonical presence follows media loss and recovery", async () => {
    render(
      <SoftphoneRuntime>
        <AvailabilityProbe />
      </SoftphoneRuntime>,
    );

    await screen.findByText("Connection: READY");
    await screen.findByText("Media ready: true");
    fireEvent.click(screen.getByRole("button", { name: "Become available" }));
    await screen.findByText("Intent: AVAILABLE");
    await screen.findByText("Presence: AVAILABLE");

    act(() => {
      clients[0]?.handlers.get("telnyx.error")?.({
        error: { fatal: true, name: "CONNECTION_FAILED" },
      });
    });

    await screen.findByText("Presence: PAUSED");
    expect(screen.getByText("Intent: AVAILABLE")).toBeTruthy();
    await screen.findByText("Presence: AVAILABLE", {}, { timeout: 5_000 });
    expect(screen.getByText("Intent: AVAILABLE")).toBeTruthy();
  });

  it("restores Available intent after a refresh during temporary media loss", async () => {
    const first = render(
      <SoftphoneRuntime>
        <AvailabilityProbe />
      </SoftphoneRuntime>,
    );

    await screen.findByText("Connection: READY");
    await screen.findByText("Media ready: true");
    fireEvent.click(screen.getByRole("button", { name: "Become available" }));
    await screen.findByText("Presence: AVAILABLE");

    act(() => {
      clients[0]?.handlers.get("telnyx.error")?.({
        error: { fatal: true, name: "CONNECTION_FAILED" },
      });
    });
    await screen.findByText("Presence: PAUSED");
    expect(screen.getByText("Intent: AVAILABLE")).toBeTruthy();
    first.unmount();

    render(
      <SoftphoneRuntime>
        <AvailabilityProbe />
      </SoftphoneRuntime>,
    );

    await screen.findByText("Connection: READY");
    await screen.findByText("Media ready: true");
    await screen.findByText("Intent: AVAILABLE");
    await screen.findByText("Presence: AVAILABLE");
  });

  it("does not restore a rejected availability choice after refresh", async () => {
    rejectAvailabilityChange = true;
    const first = render(
      <SoftphoneRuntime>
        <AvailabilityProbe />
      </SoftphoneRuntime>,
    );

    await screen.findByText("Connection: READY");
    fireEvent.click(screen.getByRole("button", { name: "Become available" }));
    await waitFor(() => expect(availabilityPatchAttempts).toBe(1));
    expect(screen.getByText("Intent: PAUSED")).toBeTruthy();
    first.unmount();
    rejectAvailabilityChange = false;

    render(
      <SoftphoneRuntime>
        <AvailabilityProbe />
      </SoftphoneRuntime>,
    );

    await screen.findByText("Connection: READY");
    await screen.findByText("Media ready: true");
    expect(screen.getByText("Intent: PAUSED")).toBeTruthy();
    expect(screen.getByText("Presence: PAUSED")).toBeTruthy();
  });

  it("does not carry confirmed availability into a later Agent Session", async () => {
    const first = render(
      <SoftphoneRuntime>
        <AvailabilityProbe />
      </SoftphoneRuntime>,
    );

    await screen.findByText("Connection: READY");
    fireEvent.click(screen.getByRole("button", { name: "Become available" }));
    await screen.findByText("Presence: AVAILABLE");
    first.unmount();
    reopenSessionOnNextAcquire = true;

    render(
      <SoftphoneRuntime>
        <AvailabilityProbe />
      </SoftphoneRuntime>,
    );

    await screen.findByText("Connection: READY");
    await screen.findByText("Media ready: true");
    expect(screen.getByText("Intent: PAUSED")).toBeTruthy();
    expect(screen.getByText("Presence: PAUSED")).toBeTruthy();
  });

  it("resets confirmed availability during in-place lease reconnection", async () => {
    render(
      <SoftphoneRuntime>
        <AvailabilityProbe />
      </SoftphoneRuntime>,
    );

    await screen.findByText("Connection: READY");
    fireEvent.click(screen.getByRole("button", { name: "Become available" }));
    await screen.findByText("Presence: AVAILABLE");
    expireSessionOnNextPatch = true;

    act(() => {
      clients[0]?.handlers.get("telnyx.error")?.({
        error: { fatal: true, name: "CONNECTION_FAILED" },
      });
    });

    await screen.findByText("Connection: READY", {}, { timeout: 5_000 });
    await screen.findByText("Intent: PAUSED");
    await screen.findByText("Presence: PAUSED");
  });

  it("keeps a renewed lease Paused through connected occupancy", async () => {
    render(
      <SoftphoneRuntime>
        <AvailabilityProbe />
      </SoftphoneRuntime>,
    );

    await screen.findByText("Connection: READY");
    fireEvent.click(screen.getByRole("button", { name: "Become available" }));
    await screen.findByText("Presence: AVAILABLE");
    connectedOccupancy = true;
    expireSessionOnNextPatch = true;

    act(() => {
      clients[0]?.handlers.get("telnyx.error")?.({
        error: { fatal: true, name: "CONNECTION_FAILED" },
      });
    });

    await screen.findByText("Connection: READY", {}, { timeout: 5_000 });
    await screen.findByText("Presence: BUSY");
    expect(screen.getByText("Intent: PAUSED")).toBeTruthy();

    connectedOccupancy = false;
    act(() => {
      clients.at(-1)?.handlers.get("telnyx.error")?.({
        error: { fatal: true, name: "CONNECTION_FAILED" },
      });
    });
    await screen.findByText("Presence: PAUSED", {}, { timeout: 5_000 });
    expect(screen.getByText("Intent: PAUSED")).toBeTruthy();
  });

  it("restores confirmed availability after temporary canonical occupancy", async () => {
    render(
      <SoftphoneRuntime>
        <AvailabilityProbe />
      </SoftphoneRuntime>,
    );

    await screen.findByText("Connection: READY");
    fireEvent.click(screen.getByRole("button", { name: "Become available" }));
    await screen.findByText("Presence: AVAILABLE");
    connectedOccupancy = true;

    act(() => {
      clients[0]?.handlers.get("telnyx.error")?.({
        error: { fatal: true, name: "CONNECTION_FAILED" },
      });
    });
    await screen.findByText("Presence: BUSY");
    expect(screen.getByText("Intent: AVAILABLE")).toBeTruthy();

    connectedOccupancy = false;
    act(() => {
      clients.at(-1)?.handlers.get("telnyx.error")?.({
        error: { fatal: true, name: "CONNECTION_FAILED" },
      });
    });
    await screen.findByText("Presence: AVAILABLE", {}, { timeout: 5_000 });
    expect(screen.getByText("Intent: AVAILABLE")).toBeTruthy();
  });
});
