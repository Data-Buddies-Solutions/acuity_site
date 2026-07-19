import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
const originalBroadcastChannel = globalThis.BroadcastChannel;
const originalConsoleError = console.error;
const originalFetch = globalThis.fetch;

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
        session = {
          ...session,
          ...readiness,
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
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
});
