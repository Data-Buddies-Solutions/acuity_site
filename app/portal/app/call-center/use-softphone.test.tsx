import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

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

  emit(event: string, payload?: unknown) {
    this.handlers.get(event)?.(payload);
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, handler);
  }
}

mock.module("@telnyx/webrtc", () => ({ TelnyxRTC: FakeTelnyxClient }));

const { useSoftphoneMedia } = await import("./use-softphone");
const originalFetch = globalThis.fetch;
const mediaPrototype = Object.getPrototypeOf(document.createElement("audio")) as {
  play: () => Promise<void>;
};
const originalPlay = mediaPrototype.play;

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
        enabled: true,
      }),
    );

    await waitFor(() => expect(result.current.connection).toBe("READY"));
    expect(requests).toEqual([
      {
        body: { clientInstanceId: "browser-1" },
        method: "POST",
        url: "/api/portal/call-center/agent-sessions/session-1/token",
      },
    ]);
  });

  it("treats provider recovery as connecting until ready or fatally failed", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ token: "canonical-token" }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        enabled: true,
      }),
    );

    await waitFor(() => expect(result.current.connection).toBe("READY"));

    act(() => clients[0]?.emit("telnyx.socket.close"));
    expect(result.current.connection).toBe("CONNECTING");
    expect(result.current.error).toBeNull();

    act(() =>
      clients[0]?.emit("telnyx.error", {
        error: { fatal: false, message: "Connection to server lost" },
      }),
    );
    expect(result.current.connection).toBe("CONNECTING");
    expect(result.current.error).toBeNull();

    act(() => clients[0]?.emit("telnyx.ready"));
    expect(result.current.connection).toBe("READY");

    act(() =>
      clients[0]?.emit("telnyx.error", {
        error: { fatal: true, message: "Unable to reconnect" },
      }),
    );
    expect(result.current.connection).toBe("FAILED");
    expect(result.current.error).toBe(
      "The phone service is temporarily unavailable. Try again in a moment.",
    );
  });

  it("reports an empty token failure without exposing a JSON parser error", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 503 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        enabled: true,
      }),
    );

    await waitFor(() => expect(result.current.connection).toBe("FAILED"));
    expect(result.current.error).toBe(
      "We couldn't connect to the call center. Try again. If it keeps happening, contact support.",
    );
    expect(result.current.error).not.toContain("JSON");
    expect(clients).toHaveLength(0);
  });

  it("shows the API explanation when a browser lease is rejected", async () => {
    globalThis.fetch = mock(async () =>
      Response.json(
        {
          error: {
            code: "CALL_CENTER_SESSION_IN_USE",
            referenceId: "ABC123",
            retryable: false,
          },
        },
        { status: 409 },
      ),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        enabled: true,
      }),
    );

    await waitFor(() => expect(result.current.connection).toBe("FAILED"));
    expect(result.current.error).toBe(
      "Your calling session is open in another browser. Close it there, then try again. Reference: ABC123.",
    );
  });
});
