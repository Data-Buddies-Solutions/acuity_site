import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Component, type ReactNode } from "react";

import type { AgentSessionView } from "@/lib/call-center/realtime-contract";

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

const { SoftphoneRuntime, useSoftphoneRuntime } = await import("../SoftphoneRuntime");
const { default: CallCenterError } = await import("./error");

const originalAudio = globalThis.Audio;
const originalAudioContext = window.AudioContext;
const originalBroadcastChannel = globalThis.BroadcastChannel;
const originalConsoleError = console.error;
const originalFetch = globalThis.fetch;
const originalMediaDevices = navigator.mediaDevices;

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
      <button onClick={() => void runtime.setAvailability("AVAILABLE")} type="button">
        Become available
      </button>
    </div>
  );
}

describe("Call Center route failure containment", () => {
  beforeEach(() => {
    clients.length = 0;
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
        return Response.json({ leaseDurationMs: 60_000, session });
      }
      if (method === "PATCH" && session) {
        const readiness = JSON.parse(String(init?.body));
        const effectivelyAvailable =
          readiness.presence === "AVAILABLE" &&
          readiness.connectionState === "READY" &&
          readiness.microphoneReady &&
          readiness.audioReady;
        session = {
          ...session,
          ...readiness,
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          presence:
            readiness.presence === "AVAILABLE" && !effectivelyAvailable
              ? "PAUSED"
              : readiness.presence,
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
});
