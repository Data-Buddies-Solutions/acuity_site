import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";

import type { SoftphoneHandle } from "./SoftphonePanel";

const clients: FakeTelnyxClient[] = [];

class FakeTelnyxClient {
  handlers = new Map<string, (...args: unknown[]) => void>();
  remoteElement: HTMLAudioElement | null = null;
  connectCount = 0;
  disconnectCount = 0;

  constructor(_credentials: unknown) {
    clients.push(this);
  }

  connect() {
    this.connectCount += 1;
    this.handlers.get("telnyx.ready")?.();
  }

  disconnect() {
    this.disconnectCount += 1;
  }

  off(event: string) {
    this.handlers.delete(event);
  }

  newCall() {
    throw new Error("Not used in this test");
  }

  emitCallUpdate(call: unknown) {
    this.handlers.get("telnyx.notification")?.({ call, type: "callUpdate" });
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, handler);
  }
}

mock.module("@telnyx/webrtc", () => ({ TelnyxRTC: FakeTelnyxClient }));

const { useLegacySoftphoneMedia, useSoftphoneMedia } = await import("./use-softphone");
const { default: SoftphonePanel } = await import("./SoftphonePanel");
const originalFetch = globalThis.fetch;
const mediaPrototype = Object.getPrototypeOf(document.createElement("audio")) as {
  play: () => Promise<void>;
};
const originalPlay = mediaPrototype.play;

function callClientState(value: Record<string, unknown>) {
  return window.btoa(JSON.stringify(value));
}

function providerCall({
  hangup = mock(async () => {}),
  id = "media-leg-1",
  state = "active",
}: {
  hangup?: () => Promise<void>;
  id?: string;
  state?: string;
} = {}) {
  return {
    answer: mock(async () => {}),
    direction: "inbound",
    dtmf: mock(() => {}),
    hangup,
    hold: mock(async () => {}),
    id,
    muteAudio: mock(() => {}),
    options: {
      callerNumber: "+17865550100",
      clientState: callClientState({
        callerNumber: "+17865550100",
        ringAttemptId: "ring-1",
      }),
      remoteCallerNumber: "+17865550100",
    },
    remoteStream: new window.MediaStream(),
    state,
    telnyxIDs: {
      telnyxCallControlId: `control-${id}`,
      telnyxLegId: `provider-${id}`,
      telnyxSessionId: `session-${id}`,
    },
    unhold: mock(async () => {}),
    unmuteAudio: mock(() => {}),
  };
}

describe("useLegacySoftphoneMedia", () => {
  beforeEach(() => {
    clients.length = 0;
    mediaPrototype.play = mock(async () => {});
    globalThis.fetch = mock(async () =>
      Response.json({ login: "seat", password: "secret" }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    mediaPrototype.play = originalPlay;
  });

  it("does not reconnect or replace the legacy subscription on a parent rerender", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ browserSessionId }) =>
        useLegacySoftphoneMedia({
          browserSessionId,
          enabled: true,
          stationSeatId: "seat-1",
        }),
      { initialProps: { browserSessionId: "browser-1" } },
    );

    await waitFor(() => expect(result.current.connection).toBe("READY"));
    const subscribeLegacy = result.current.subscribeLegacy;

    act(() => rerender({ browserSessionId: "browser-1" }));

    expect(result.current.subscribeLegacy).toBe(subscribeLegacy);
    expect(clients).toHaveLength(1);
    expect(clients[0]?.connectCount).toBe(1);

    unmount();
    expect(clients[0]?.disconnectCount).toBe(1);
    expect(clients[0]?.handlers.size).toBe(0);
  });

  it("observes active media without attaching until the leg is explicitly selected", async () => {
    const { result } = renderHook(() =>
      useLegacySoftphoneMedia({
        browserSessionId: "browser-1",
        enabled: true,
        stationSeatId: "seat-1",
      }),
    );
    await waitFor(() => expect(result.current.connection).toBe("READY"));

    const audio = document.createElement("audio");
    result.current.remoteAudioRef.current = audio;
    const call = providerCall();

    act(() => clients[0]?.emitCallUpdate(call));
    expect(audio.srcObject ?? null).toBeNull();

    act(() => result.current.activate(call.id));
    expect(audio.srcObject).toBe(call.remoteStream);
    expect(result.current.deactivate("another-leg")).toBe(false);
    expect(audio.srcObject).toBe(call.remoteStream);
    expect(result.current.deactivate(call.id)).toBe(true);
    expect(audio.srcObject).toBeNull();
  });

  it("removes a purged leg from the action map and releases selected audio", async () => {
    const { result } = renderHook(() =>
      useLegacySoftphoneMedia({
        browserSessionId: "browser-1",
        enabled: true,
        stationSeatId: "seat-1",
      }),
    );
    await waitFor(() => expect(result.current.connection).toBe("READY"));

    const audio = document.createElement("audio");
    result.current.remoteAudioRef.current = audio;
    const call = providerCall();
    act(() => clients[0]?.emitCallUpdate(call));
    act(() => result.current.activate(call.id));

    call.state = "purge";
    act(() => clients[0]?.emitCallUpdate(call));

    expect(audio.srcObject).toBeNull();
    expect(() => result.current.activate(call.id)).toThrow(
      "Media leg is no longer available",
    );
  });

  it("selects audio only on logical promotion and clears it on stale hangup reset", async () => {
    const ref = createRef<SoftphoneHandle>();
    const { container } = render(
      <SoftphonePanel
        ref={ref}
        browserSessionId="browser-1"
        callerNumber="+17865550199"
        enabled
        inboundEnabled
        stationSeatId="seat-1"
      />,
    );
    await waitFor(() => expect(clients).toHaveLength(1));
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();

    const call = providerCall({
      hangup: mock(async () => {
        throw new Error("CALL DOES NOT EXIST");
      }),
    });
    act(() => clients[0]?.emitCallUpdate(call));
    expect(audio?.srcObject ?? null).toBeNull();

    act(() => expect(ref.current?.markAnswerPending("ring-1")).toBe(true));
    act(() => clients[0]?.emitCallUpdate(call));
    await waitFor(() => expect(screen.getByRole("button", { name: "End" })).toBeTruthy());
    expect(audio?.srcObject).toBe(call.remoteStream);

    fireEvent.click(screen.getByRole("button", { name: "End" }));
    await waitFor(() => expect(audio?.srcObject).toBeNull());
    expect(screen.queryByRole("button", { name: "End" })).toBeNull();
  });
});

describe("useSoftphoneMedia canonical credentials", () => {
  beforeEach(() => {
    clients.length = 0;
    mediaPrototype.play = mock(async () => {});
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    mediaPrototype.play = originalPlay;
  });

  it("requests a token through the exact canonical agent session", async () => {
    const requests: Array<{ body: unknown; method: string; url: string }> = [];
    globalThis.fetch = mock(async (input, init) => {
      requests.push({
        body: JSON.parse(String(init?.body ?? "{}")),
        method: init?.method ?? "GET",
        url: String(input),
      });
      return Response.json({ token: "canonical-token" });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        credentialMode: "CANONICAL",
        enabled: true,
        stationSeatId: "endpoint-1",
      }),
    );

    await waitFor(() => expect(result.current.connection).toBe("READY"));
    expect(requests).toEqual([
      {
        body: { clientInstanceId: "browser-1", endpointId: "endpoint-1" },
        method: "POST",
        url: "/api/portal/call-center/agent-sessions/session-1/token",
      },
    ]);
  });

  it("reports an empty token failure without exposing a JSON parser error", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 503 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        credentialMode: "CANONICAL",
        enabled: true,
        stationSeatId: "endpoint-1",
      }),
    );

    await waitFor(() => expect(result.current.connection).toBe("FAILED"));
    expect(result.current.error).toBe("Unable to connect Telnyx (503)");
    expect(result.current.error).not.toContain("JSON");
    expect(clients).toHaveLength(0);
  });

  it("shows the API explanation when a station lease is rejected", async () => {
    globalThis.fetch = mock(async () =>
      Response.json(
        { error: "Selected call center station is already active in another browser" },
        { status: 409 },
      ),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        credentialMode: "CANONICAL",
        enabled: true,
        stationSeatId: "endpoint-1",
      }),
    );

    await waitFor(() => expect(result.current.connection).toBe("FAILED"));
    expect(result.current.error).toBe(
      "Selected call center station is already active in another browser",
    );
  });
});
