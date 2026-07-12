import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import type { AgentSessionView } from "@/lib/call-center/realtime-contract";

import { useCanonicalAgentSession } from "./use-canonical-agent-session";

const originalFetch = globalThis.fetch;

function agentSession(stateVersion = 0): AgentSessionView {
  return {
    audioReady: false,
    clientInstanceId: "browser-1",
    connectionState: stateVersion ? "READY" : "CONNECTING",
    endpointId: "endpoint-1",
    id: "session-1",
    leaseExpiresAt: "2026-07-12T12:01:00.000Z",
    microphoneReady: Boolean(stateVersion),
    presence: stateVersion ? "AVAILABLE" : "PAUSED",
    stateVersion,
  };
}

function acquisition() {
  return Response.json({
    callerNumber: "+17865550100",
    leaseDurationMs: 60_000,
    session: agentSession(),
    token: "short-lived-token",
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("useCanonicalAgentSession", () => {
  beforeEach(() => {
    globalThis.fetch = mock(async (_input, init) => {
      if (init?.method === "POST") return acquisition();
      return Response.json({ session: agentSession(1) });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it("acquires explicitly and publishes the canonical credentials", async () => {
    const { result } = renderHook(() =>
      useCanonicalAgentSession({
        audioReady: true,
        clientInstanceId: "browser-1",
        connectionState: "READY",
        endpointId: "endpoint-1",
        microphoneReady: true,
        presence: "AVAILABLE",
      }),
    );

    expect(result.current.session).toBeNull();
    await act(() => result.current.start());

    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));
    expect(result.current).toMatchObject({
      callerNumber: "+17865550100",
      error: null,
      token: "short-lived-token",
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "/api/portal/call-center/agent-sessions",
      expect.objectContaining({
        body: JSON.stringify({
          clientInstanceId: "browser-1",
          endpointId: "endpoint-1",
        }),
        method: "POST",
      }),
    );
    const fetchMock = globalThis.fetch as unknown as {
      mock: { calls: unknown[][] };
    };
    const [patchUrl, patchInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(patchUrl).toBe("/api/portal/call-center/agent-sessions/session-1");
    expect(patchInit.method).toBe("PATCH");
    expect(JSON.parse(String(patchInit.body))).toEqual({
      audioReady: true,
      clientInstanceId: "browser-1",
      connectionState: "READY",
      endpointId: "endpoint-1",
      expectedStateVersion: 0,
      microphoneReady: true,
      presence: "AVAILABLE",
    });
  });

  it("coalesces readiness changes behind the in-flight PATCH and reuses its revision", async () => {
    const firstPatch = deferred<Response>();
    const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
    let patchCount = 0;
    globalThis.fetch = mock(async (_input, init) => {
      const method = init?.method ?? "GET";
      requests.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
      if (method === "POST") return acquisition();
      patchCount += 1;
      if (patchCount === 1) return firstPatch.promise;
      return Response.json({ session: agentSession(2) });
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ audioReady, presence }) =>
        useCanonicalAgentSession({
          audioReady,
          clientInstanceId: "browser-1",
          connectionState: "READY",
          endpointId: "endpoint-1",
          microphoneReady: true,
          presence,
        }),
      {
        initialProps: {
          audioReady: false,
          presence: "PAUSED" as AgentSessionView["presence"],
        },
      },
    );

    await act(() => result.current.start());
    await waitFor(() => expect(patchCount).toBe(1));
    rerender({ audioReady: true, presence: "AVAILABLE" });
    rerender({ audioReady: false, presence: "BUSY" });
    expect(patchCount).toBe(1);

    firstPatch.resolve(Response.json({ session: agentSession(1) }));
    await waitFor(() => expect(patchCount).toBe(2));

    expect(requests.at(-1)).toEqual({
      method: "PATCH",
      body: {
        audioReady: false,
        clientInstanceId: "browser-1",
        connectionState: "READY",
        endpointId: "endpoint-1",
        expectedStateVersion: 1,
        microphoneReady: true,
        presence: "BUSY",
      },
    });
  });

  it("waits for an in-flight heartbeat before releasing its latest revision", async () => {
    const patch = deferred<Response>();
    const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = mock(async (_input, init) => {
      const method = init?.method ?? "GET";
      requests.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
      if (method === "POST") return acquisition();
      if (method === "PATCH") return patch.promise;
      return Response.json({ session: agentSession(2) });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useCanonicalAgentSession({
        audioReady: true,
        clientInstanceId: "browser-1",
        connectionState: "READY",
        endpointId: "endpoint-1",
        microphoneReady: true,
        presence: "AVAILABLE",
      }),
    );
    await act(() => result.current.start());

    let stopping!: Promise<void>;
    act(() => {
      stopping = result.current.stop();
    });
    expect(requests.map(({ method }) => method)).toEqual(["POST", "PATCH"]);

    patch.resolve(Response.json({ session: agentSession(1) }));
    await act(() => stopping);
    expect(requests.at(-1)).toEqual({
      method: "DELETE",
      body: {
        clientInstanceId: "browser-1",
        endpointId: "endpoint-1",
        expectedStateVersion: 1,
      },
    });
    expect(result.current.session).toBeNull();
    expect(result.current.token).toBeNull();
  });

  it("best-effort releases the active lease when unmounted", async () => {
    const methods: string[] = [];
    globalThis.fetch = mock(async (_input, init) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "POST") return acquisition();
      return Response.json({ session: agentSession(1) });
    }) as unknown as typeof fetch;

    const { result, unmount } = renderHook(() =>
      useCanonicalAgentSession({
        audioReady: true,
        clientInstanceId: "browser-1",
        connectionState: "READY",
        endpointId: "endpoint-1",
        microphoneReady: true,
        presence: "AVAILABLE",
      }),
    );
    await act(() => result.current.start());
    await waitFor(() => expect(methods).toContain("PATCH"));

    unmount();
    await waitFor(() => expect(methods).toContain("DELETE"));
  });

  it("releases an acquisition that finishes after an intentional stop", async () => {
    const post = deferred<Response>();
    const methods: string[] = [];
    globalThis.fetch = mock(async (_input, init) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "POST") return post.promise;
      return Response.json({ session: agentSession(1) });
    }) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useCanonicalAgentSession({
        audioReady: true,
        clientInstanceId: "browser-1",
        connectionState: "READY",
        endpointId: "endpoint-1",
        microphoneReady: true,
        presence: "AVAILABLE",
      }),
    );

    let starting!: Promise<void>;
    act(() => {
      starting = result.current.start();
    });
    await waitFor(() => expect(methods).toEqual(["POST"]));
    await act(() => result.current.stop());

    post.resolve(acquisition());
    await act(() => starting);
    await waitFor(() => expect(methods).toEqual(["POST", "DELETE"]));
    expect(result.current.session).toBeNull();
    expect(result.current.token).toBeNull();
  });

  it("starts the newly selected endpoint after a stale acquisition finishes", async () => {
    const firstPost = deferred<Response>();
    const postEndpoints: string[] = [];
    globalThis.fetch = mock(async (_input, init) => {
      const method = init?.method ?? "GET";
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        endpointId?: string;
      };
      if (method === "POST") {
        postEndpoints.push(body.endpointId ?? "");
        if (postEndpoints.length === 1) return firstPost.promise;
        return Response.json({
          callerNumber: "+17865550100",
          leaseDurationMs: 60_000,
          session: {
            ...agentSession(),
            endpointId: "endpoint-2",
            id: "session-2",
          },
          token: "second-token",
        });
      }
      return Response.json({
        session: {
          ...agentSession(1),
          endpointId: body.endpointId ?? "endpoint-1",
          id: body.endpointId === "endpoint-2" ? "session-2" : "session-1",
        },
      });
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ endpointId }) =>
        useCanonicalAgentSession({
          audioReady: true,
          clientInstanceId: "browser-1",
          connectionState: "READY",
          endpointId,
          microphoneReady: true,
          presence: "AVAILABLE",
        }),
      { initialProps: { endpointId: "endpoint-1" } },
    );

    let firstStart!: Promise<void>;
    act(() => {
      firstStart = result.current.start();
    });
    await waitFor(() => expect(postEndpoints).toEqual(["endpoint-1"]));

    rerender({ endpointId: "endpoint-2" });
    let secondStart!: Promise<void>;
    act(() => {
      secondStart = result.current.start();
    });
    firstPost.resolve(acquisition());

    await act(() => Promise.all([firstStart, secondStart]));
    await waitFor(() => expect(result.current.session?.endpointId).toBe("endpoint-2"));
    expect(postEndpoints).toEqual(["endpoint-1", "endpoint-2"]);
  });

  it("surfaces acquisition failures without creating a session", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ error: "Endpoint is already leased" }, { status: 409 }),
    ) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useCanonicalAgentSession({
        audioReady: false,
        clientInstanceId: "browser-1",
        connectionState: "CONNECTING",
        endpointId: "endpoint-1",
        microphoneReady: false,
        presence: "PAUSED",
      }),
    );

    await act(() => result.current.start());
    expect(result.current.error).toBe("Endpoint is already leased");
    expect(result.current.session).toBeNull();
  });
});
