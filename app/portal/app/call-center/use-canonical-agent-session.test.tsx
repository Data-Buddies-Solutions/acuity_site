import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import { CallCenterRequestError } from "@/lib/call-center/operator-error";
import type { AgentSessionView } from "@/lib/call-center/realtime-contract";

import {
  canonicalHeartbeatPresence,
  useCanonicalAgentSession,
} from "./use-canonical-agent-session";

const originalFetch = globalThis.fetch;

function agentSession(stateVersion = 0): AgentSessionView {
  return {
    audioReady: Boolean(stateVersion),
    clientInstanceId: "browser-1",
    connectionState: stateVersion ? "READY" : "CONNECTING",
    endpointId: "endpoint-1",
    id: "session-1",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    microphoneReady: Boolean(stateVersion),
    presence: stateVersion ? "AVAILABLE" : "PAUSED",
    stateVersion,
  };
}

function activeAgentSession(stateVersion: number, expired = false): AgentSessionView {
  return {
    ...agentSession(stateVersion),
    connectionState: expired ? "DISCONNECTED" : "READY",
    leaseExpiresAt: new Date(Date.now() + (expired ? -1_000 : 60_000)).toISOString(),
    presence: expired ? "OFFLINE" : "BUSY",
  };
}

function acquisition() {
  return Response.json({
    leaseDurationMs: 60_000,
    session: agentSession(),
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
  it("does not infer busy from a ringing offer", () => {
    expect(canonicalHeartbeatPresence({ presence: "AVAILABLE" }, "BUSY")).toBe(
      "AVAILABLE",
    );
    expect(canonicalHeartbeatPresence({ presence: "BUSY" }, "AVAILABLE")).toBe("BUSY");
    expect(canonicalHeartbeatPresence({ presence: "PAUSED" }, "AVAILABLE")).toBe(
      "AVAILABLE",
    );
  });

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

  it("acquires explicitly without requesting provider credentials", async () => {
    const { result } = renderHook(() =>
      useCanonicalAgentSession({
        audioReady: true,
        clientInstanceId: "browser-1",
        connectionState: "READY",
        microphoneReady: true,
        presence: "AVAILABLE",
      }),
    );

    expect(result.current.session).toBeNull();
    await act(() => result.current.start());

    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));
    expect(result.current.error).toBeNull();
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "/api/portal/call-center/agent-sessions",
      expect.objectContaining({
        body: JSON.stringify({
          clientInstanceId: "browser-1",
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
        expectedStateVersion: 1,
        microphoneReady: true,
        presence: "AVAILABLE",
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
        expectedStateVersion: 1,
      },
    });
    expect(result.current.session).toBeNull();
  });

  it("adopts a newer canonical projection before later heartbeats or release", async () => {
    const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = mock(async (_input, init) => {
      const method = init?.method ?? "GET";
      requests.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
      if (method === "POST") return acquisition();
      return Response.json({ session: agentSession(1) });
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ projectedSession }) =>
        useCanonicalAgentSession({
          audioReady: true,
          clientInstanceId: "browser-1",
          connectionState: "READY",
          microphoneReady: true,
          presence: "AVAILABLE",
          projectedSession,
        }),
      { initialProps: { projectedSession: null as AgentSessionView | null } },
    );

    await act(() => result.current.start());
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));
    rerender({
      projectedSession: {
        ...agentSession(2),
        presence: "BUSY",
      },
    });
    await waitFor(() => expect(result.current.session?.presence).toBe("BUSY"));

    rerender({ projectedSession: null });
    expect(result.current.session?.presence).toBe("BUSY");

    await act(() => result.current.stop());
    expect(requests.at(-1)).toEqual({
      method: "DELETE",
      body: {
        clientInstanceId: "browser-1",
        expectedStateVersion: 2,
      },
    });
  });

  it("silently reacquires an expired busy lease", async () => {
    const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
    let postCount = 0;
    let patchCount = 0;
    globalThis.fetch = mock(async (_input, init) => {
      const method = init?.method ?? "GET";
      requests.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
      if (method === "POST") {
        postCount += 1;
        return Response.json({
          leaseDurationMs: 60_000,
          session: postCount === 1 ? agentSession() : activeAgentSession(3),
        });
      }
      patchCount += 1;
      return Response.json({
        session: patchCount === 1 ? agentSession(1) : activeAgentSession(4),
      });
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ projectedSession }) =>
        useCanonicalAgentSession({
          audioReady: true,
          clientInstanceId: "browser-1",
          connectionState: "READY",
          microphoneReady: true,
          presence: "AVAILABLE",
          projectedSession,
        }),
      { initialProps: { projectedSession: null as AgentSessionView | null } },
    );

    await act(() => result.current.start());
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));
    rerender({
      projectedSession: {
        ...activeAgentSession(2),
        connectionState: "DISCONNECTED",
        presence: "OFFLINE",
      },
    });

    await waitFor(() => expect(postCount).toBe(2));
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(4));
    expect(result.current.session?.presence).toBe("BUSY");
    expect(result.current.error).toBeNull();
    expect(requests.map(({ method }) => method)).toEqual([
      "POST",
      "PATCH",
      "POST",
      "PATCH",
    ]);
  });

  it("preserves a newer projection that arrives during lease reacquisition", async () => {
    const recoveryPost = deferred<Response>();
    const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
    let postCount = 0;
    let patchCount = 0;
    globalThis.fetch = mock(async (_input, init) => {
      const method = init?.method ?? "GET";
      requests.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
      if (method === "POST") {
        postCount += 1;
        return postCount === 1 ? acquisition() : recoveryPost.promise;
      }
      patchCount += 1;
      return Response.json({
        session: patchCount === 1 ? agentSession(1) : agentSession(5),
      });
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ projectedSession }) =>
        useCanonicalAgentSession({
          audioReady: true,
          clientInstanceId: "browser-1",
          connectionState: "READY",
          microphoneReady: true,
          presence: "AVAILABLE",
          projectedSession,
        }),
      { initialProps: { projectedSession: null as AgentSessionView | null } },
    );

    await act(() => result.current.start());
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));
    rerender({ projectedSession: activeAgentSession(2, true) });
    await waitFor(() => expect(postCount).toBe(2));

    rerender({ projectedSession: agentSession(4) });
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(4));
    recoveryPost.resolve(
      Response.json({
        leaseDurationMs: 60_000,
        session: activeAgentSession(3),
      }),
    );

    await waitFor(() => expect(result.current.session?.stateVersion).toBe(5));
    expect(result.current.session?.presence).toBe("AVAILABLE");
    expect(requests.at(-1)).toMatchObject({
      method: "PATCH",
      body: { expectedStateVersion: 4, presence: "AVAILABLE" },
    });
  });

  it("restores availability after recovering an expired paused lease", async () => {
    const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
    let postCount = 0;
    let patchCount = 0;
    const pausedSession = (stateVersion: number, expired = false): AgentSessionView => ({
      ...agentSession(stateVersion),
      connectionState: expired ? "DISCONNECTED" : "READY",
      leaseExpiresAt: new Date(Date.now() + (expired ? -1_000 : 60_000)).toISOString(),
      presence: expired ? "OFFLINE" : "PAUSED",
    });
    globalThis.fetch = mock(async (_input, init) => {
      const method = init?.method ?? "GET";
      requests.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
      if (method === "POST") {
        postCount += 1;
        return Response.json({
          leaseDurationMs: 60_000,
          session: postCount === 1 ? agentSession() : pausedSession(3),
        });
      }
      patchCount += 1;
      return Response.json({
        session:
          patchCount === 1
            ? agentSession(1)
            : { ...pausedSession(4), presence: "AVAILABLE" },
      });
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ projectedSession }) =>
        useCanonicalAgentSession({
          audioReady: true,
          clientInstanceId: "browser-1",
          connectionState: "READY",
          microphoneReady: true,
          presence: "AVAILABLE",
          projectedSession,
        }),
      { initialProps: { projectedSession: null as AgentSessionView | null } },
    );

    await act(() => result.current.start());
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));
    rerender({ projectedSession: pausedSession(2, true) });

    await waitFor(() => expect(result.current.session?.stateVersion).toBe(4));
    expect(result.current.session?.presence).toBe("AVAILABLE");
    expect(requests.at(-1)).toMatchObject({
      method: "PATCH",
      body: { presence: "AVAILABLE" },
    });
  });

  it("heartbeats the recovered session after an old readiness PATCH settles", async () => {
    const recoveryPost = deferred<Response>();
    const expiredPatch = deferred<Response>();
    let postCount = 0;
    let patchCount = 0;
    globalThis.fetch = mock(async (_input, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        return postCount === 1 ? acquisition() : recoveryPost.promise;
      }
      patchCount += 1;
      if (patchCount === 2) return expiredPatch.promise;
      return Response.json({
        session: patchCount === 1 ? agentSession(1) : activeAgentSession(5),
      });
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ presence, projectedSession }) =>
        useCanonicalAgentSession({
          audioReady: true,
          clientInstanceId: "browser-1",
          connectionState: "READY",
          microphoneReady: true,
          presence,
          projectedSession,
        }),
      {
        initialProps: {
          presence: "AVAILABLE" as AgentSessionView["presence"],
          projectedSession: null as AgentSessionView | null,
        },
      },
    );

    await act(() => result.current.start());
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));
    rerender({
      presence: "AVAILABLE",
      projectedSession: activeAgentSession(2, true),
    });
    await waitFor(() => expect(postCount).toBe(2));

    rerender({
      presence: "BUSY",
      projectedSession: activeAgentSession(2, true),
    });
    await waitFor(() => expect(patchCount).toBe(2));
    recoveryPost.resolve(
      Response.json({
        leaseDurationMs: 60_000,
        session: activeAgentSession(3),
      }),
    );
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(3));
    expiredPatch.resolve(Response.json({ session: activeAgentSession(3) }));

    await waitFor(() => expect(patchCount).toBe(3));
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(5));
    expect(result.current.session?.presence).toBe("BUSY");
  });

  it("re-arms readiness when an in-flight PATCH renews a busy lease", async () => {
    const renewingPatch = deferred<Response>();
    let postCount = 0;
    let patchCount = 0;
    globalThis.fetch = mock(async (_input, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        return acquisition();
      }
      patchCount += 1;
      if (patchCount === 2) return renewingPatch.promise;
      return Response.json({
        session: patchCount === 1 ? agentSession(1) : activeAgentSession(4),
      });
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ presence, projectedSession }) =>
        useCanonicalAgentSession({
          audioReady: true,
          clientInstanceId: "browser-1",
          connectionState: "READY",
          microphoneReady: true,
          presence,
          projectedSession,
        }),
      {
        initialProps: {
          presence: "AVAILABLE" as AgentSessionView["presence"],
          projectedSession: null as AgentSessionView | null,
        },
      },
    );

    await act(() => result.current.start());
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));
    rerender({ presence: "BUSY", projectedSession: null });
    await waitFor(() => expect(patchCount).toBe(2));
    rerender({
      presence: "BUSY",
      projectedSession: {
        ...activeAgentSession(2),
        leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
    });
    renewingPatch.resolve(Response.json({ session: activeAgentSession(3) }));

    await waitFor(() => expect(patchCount).toBe(3));
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(4));
    expect(postCount).toBe(1);
    expect(result.current.session?.presence).toBe("BUSY");
  });

  it("treats server-reported busy lease expiry as authoritative", async () => {
    let postCount = 0;
    let patchCount = 0;
    globalThis.fetch = mock(async (_input, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        return Response.json({
          leaseDurationMs: 60_000,
          session: postCount === 1 ? agentSession() : activeAgentSession(4),
        });
      }
      patchCount += 1;
      if (patchCount === 2) {
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
      return Response.json({
        session: patchCount === 1 ? agentSession(1) : activeAgentSession(5),
      });
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ presence, projectedSession }) =>
        useCanonicalAgentSession({
          audioReady: true,
          clientInstanceId: "browser-1",
          connectionState: "READY",
          microphoneReady: true,
          presence,
          projectedSession,
        }),
      {
        initialProps: {
          presence: "AVAILABLE" as AgentSessionView["presence"],
          projectedSession: null as AgentSessionView | null,
        },
      },
    );

    await act(() => result.current.start());
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));
    rerender({
      presence: "AVAILABLE",
      projectedSession: activeAgentSession(2),
    });
    await waitFor(() => expect(result.current.session?.presence).toBe("BUSY"));
    rerender({
      presence: "BUSY",
      projectedSession: activeAgentSession(2),
    });

    await waitFor(() => expect(postCount).toBe(2));
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(5));
    expect(result.current.session?.presence).toBe("BUSY");
    expect(result.current.error).toBeNull();
  });

  it("reacquires when readiness returns before expiry is observed", async () => {
    const expiredPatch = deferred<Response>();
    let postCount = 0;
    let patchCount = 0;
    globalThis.fetch = mock(async (_input, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        return Response.json({
          leaseDurationMs: 60_000,
          session: postCount === 1 ? agentSession() : agentSession(4),
        });
      }
      patchCount += 1;
      if (patchCount === 2) return expiredPatch.promise;
      return Response.json({ session: agentSession(patchCount === 1 ? 1 : 5) });
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ presence, projectedSession }) =>
        useCanonicalAgentSession({
          audioReady: true,
          clientInstanceId: "browser-1",
          connectionState: "READY",
          microphoneReady: true,
          presence,
          projectedSession,
        }),
      {
        initialProps: {
          presence: "AVAILABLE" as AgentSessionView["presence"],
          projectedSession: null as AgentSessionView | null,
        },
      },
    );

    await act(() => result.current.start());
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));
    rerender({ presence: "BUSY", projectedSession: activeAgentSession(2) });
    await waitFor(() => expect(patchCount).toBe(2));

    rerender({
      presence: "AVAILABLE",
      projectedSession: {
        ...agentSession(3),
        connectionState: "DISCONNECTED",
        leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
        presence: "PAUSED",
      },
    });
    expiredPatch.resolve(
      Response.json(
        {
          error: {
            code: "SESSION_EXPIRED",
            referenceId: "ABC123",
            retryable: true,
          },
        },
        { status: 409 },
      ),
    );

    await waitFor(() => expect(postCount).toBe(2));
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(5));
    expect(result.current.session?.presence).toBe("AVAILABLE");
    expect(result.current.error).toBeNull();
  });

  it("coalesces overlapping server and realtime lease-expiry recovery", async () => {
    const recoveryPost = deferred<Response>();
    let deleteCount = 0;
    let postCount = 0;
    let patchCount = 0;
    globalThis.fetch = mock(async (_input, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        if (postCount === 2) return recoveryPost.promise;
        return acquisition();
      }
      if (init?.method === "DELETE") {
        deleteCount += 1;
        return Response.json({ session: activeAgentSession(4) });
      }
      patchCount += 1;
      if (patchCount === 2) {
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
      return Response.json({
        session: patchCount === 1 ? agentSession(1) : activeAgentSession(5),
      });
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ presence, projectedSession }) =>
        useCanonicalAgentSession({
          audioReady: true,
          clientInstanceId: "browser-1",
          connectionState: "READY",
          microphoneReady: true,
          presence,
          projectedSession,
        }),
      {
        initialProps: {
          presence: "AVAILABLE" as AgentSessionView["presence"],
          projectedSession: null as AgentSessionView | null,
        },
      },
    );

    await act(() => result.current.start());
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));
    rerender({ presence: "AVAILABLE", projectedSession: activeAgentSession(2) });
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(2));
    rerender({ presence: "BUSY", projectedSession: activeAgentSession(2) });
    await waitFor(() => expect(postCount).toBe(2));

    rerender({ presence: "BUSY", projectedSession: activeAgentSession(3, true) });
    recoveryPost.resolve(
      Response.json({
        leaseDurationMs: 60_000,
        session: activeAgentSession(4),
      }),
    );

    await waitFor(() => expect(result.current.session?.stateVersion).toBe(5));
    expect(postCount).toBe(2);
    expect(deleteCount).toBe(0);
  });

  it("retries a transient active-call lease recovery failure", async () => {
    let postCount = 0;
    let patchCount = 0;
    globalThis.fetch = mock(async (_input, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        if (postCount === 2) {
          return Response.json(
            {
              error: {
                code: "TEMPORARY_SERVICE_FAILURE",
                referenceId: "ABC123",
                retryable: true,
              },
            },
            { status: 503 },
          );
        }
        return Response.json({
          leaseDurationMs: 60_000,
          session: postCount === 1 ? agentSession() : agentSession(4),
        });
      }
      patchCount += 1;
      return Response.json({
        session: patchCount === 1 ? agentSession(1) : agentSession(5),
      });
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ projectedSession }) =>
        useCanonicalAgentSession({
          audioReady: true,
          clientInstanceId: "browser-1",
          connectionState: "READY",
          microphoneReady: true,
          presence: "AVAILABLE",
          projectedSession,
        }),
      { initialProps: { projectedSession: null as AgentSessionView | null } },
    );

    await act(() => result.current.start());
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));
    rerender({ projectedSession: activeAgentSession(2, true) });

    await waitFor(() => expect(postCount).toBe(2));
    rerender({
      projectedSession: agentSession(3),
    });
    await waitFor(() => expect(postCount).toBe(3), { timeout: 2_000 });
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(5));
    expect(result.current.session?.presence).toBe("AVAILABLE");
    expect(result.current.error).toBeNull();
  });

  it("keeps a recovery retry scheduled across readiness changes", async () => {
    let postCount = 0;
    let patchCount = 0;
    globalThis.fetch = mock(async (_input, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        if (postCount === 2) {
          return Response.json(
            {
              error: {
                code: "TEMPORARY_SERVICE_FAILURE",
                referenceId: "ABC123",
                retryable: true,
              },
            },
            { status: 503 },
          );
        }
        return Response.json({
          leaseDurationMs: 60_000,
          session: postCount === 1 ? agentSession() : activeAgentSession(4),
        });
      }
      patchCount += 1;
      if (patchCount === 2) {
        return Response.json(
          {
            error: {
              code: "TEMPORARY_SERVICE_FAILURE",
              referenceId: "ABC123",
              retryable: true,
            },
          },
          { status: 503 },
        );
      }
      return Response.json({
        session: patchCount === 1 ? agentSession(1) : activeAgentSession(5),
      });
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ presence, projectedSession }) =>
        useCanonicalAgentSession({
          audioReady: true,
          clientInstanceId: "browser-1",
          connectionState: "READY",
          microphoneReady: true,
          presence,
          projectedSession,
        }),
      {
        initialProps: {
          presence: "AVAILABLE" as AgentSessionView["presence"],
          projectedSession: null as AgentSessionView | null,
        },
      },
    );

    await act(() => result.current.start());
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));
    rerender({ presence: "AVAILABLE", projectedSession: activeAgentSession(2, true) });
    await waitFor(() => expect(postCount).toBe(2));

    rerender({ presence: "BUSY", projectedSession: activeAgentSession(2, true) });
    await waitFor(() => expect(patchCount).toBe(2));
    await waitFor(() => expect(postCount).toBe(3), { timeout: 2_000 });
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(5));
  });

  it("does not retry a non-retryable active-call recovery failure", async () => {
    let postCount = 0;
    globalThis.fetch = mock(async (_input, init) => {
      if (init?.method === "POST") {
        postCount += 1;
        if (postCount > 1) {
          return Response.json(
            {
              error: {
                code: "ACCESS_DENIED",
                referenceId: "ABC123",
                retryable: false,
              },
            },
            { status: 403 },
          );
        }
        return acquisition();
      }
      return Response.json({ session: agentSession(1) });
    }) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ projectedSession }) =>
        useCanonicalAgentSession({
          audioReady: true,
          clientInstanceId: "browser-1",
          connectionState: "READY",
          microphoneReady: true,
          presence: "AVAILABLE",
          projectedSession,
        }),
      { initialProps: { projectedSession: null as AgentSessionView | null } },
    );

    await act(() => result.current.start());
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));
    rerender({ projectedSession: activeAgentSession(2, true) });

    await waitFor(() => expect(postCount).toBe(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 1_100)));
    expect(postCount).toBe(2);
    expect(result.current.error).toBe(
      "You do not have access to this calling queue. Ask an administrator to update your access. Reference: ABC123.",
    );
  });

  it("refreshes and republishes readiness without dropping the media session", async () => {
    const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
    let postCount = 0;
    let patchCount = 0;
    globalThis.fetch = mock(async (_input, init) => {
      const method = init?.method ?? "GET";
      requests.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
      if (method === "POST") {
        postCount += 1;
        return Response.json({
          leaseDurationMs: 60_000,
          session: agentSession(postCount === 1 ? 0 : 2),
        });
      }
      patchCount += 1;
      return Response.json({ session: agentSession(patchCount === 1 ? 1 : 3) });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useCanonicalAgentSession({
        audioReady: true,
        clientInstanceId: "browser-1",
        connectionState: "READY",
        microphoneReady: true,
        presence: "AVAILABLE",
      }),
    );
    await act(() => result.current.start());
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));

    await act(() => result.current.refresh());

    expect(requests.map(({ method }) => method)).toEqual([
      "POST",
      "PATCH",
      "POST",
      "PATCH",
    ]);
    expect(requests[2]?.body).toEqual({ clientInstanceId: "browser-1" });
    expect(requests[3]?.body).toMatchObject({
      clientInstanceId: "browser-1",
      expectedStateVersion: 2,
      presence: "AVAILABLE",
    });
    expect(result.current.session?.stateVersion).toBe(3);
  });

  it("releases a refreshed lease that finishes after an intentional stop", async () => {
    const refreshPost = deferred<Response>();
    const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
    let postCount = 0;
    globalThis.fetch = mock(async (_input, init) => {
      const method = init?.method ?? "GET";
      requests.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
      if (method === "POST") {
        postCount += 1;
        return postCount === 1 ? acquisition() : refreshPost.promise;
      }
      return Response.json({ session: agentSession(1) });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useCanonicalAgentSession({
        audioReady: true,
        clientInstanceId: "browser-1",
        connectionState: "READY",
        microphoneReady: true,
        presence: "AVAILABLE",
      }),
    );
    await act(() => result.current.start());
    await waitFor(() =>
      expect(requests.map(({ method }) => method)).toEqual(["POST", "PATCH"]),
    );

    let refreshError: unknown;
    let refreshing!: Promise<void>;
    act(() => {
      refreshing = result.current.refresh().then(
        () => undefined,
        (error) => {
          refreshError = error;
        },
      );
    });
    await waitFor(() =>
      expect(requests.map(({ method }) => method)).toEqual(["POST", "PATCH", "POST"]),
    );

    await act(() => result.current.stop());
    refreshPost.resolve(
      Response.json({
        leaseDurationMs: 60_000,
        session: agentSession(2),
      }),
    );
    await act(() => refreshing);

    await waitFor(() =>
      expect(requests.map(({ method }) => method)).toEqual([
        "POST",
        "PATCH",
        "POST",
        "DELETE",
        "DELETE",
      ]),
    );
    expect(refreshError).toEqual(new Error("Call center session is unavailable"));
    expect(result.current.session).toBeNull();
  });

  it("propagates an actionable readiness failure during refresh", async () => {
    let postCount = 0;
    let patchCount = 0;
    globalThis.fetch = mock(async (_input, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        postCount += 1;
        return Response.json({
          leaseDurationMs: 60_000,
          session: agentSession(postCount === 1 ? 0 : 2),
        });
      }
      patchCount += 1;
      if (patchCount === 1) {
        return Response.json({ session: agentSession(1) });
      }
      return Response.json(
        {
          error: {
            code: "MICROPHONE_REQUIRED",
            referenceId: "ABC123",
            retryable: true,
          },
        },
        { status: 409 },
      );
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useCanonicalAgentSession({
        audioReady: true,
        clientInstanceId: "browser-1",
        connectionState: "READY",
        microphoneReady: true,
        presence: "AVAILABLE",
      }),
    );
    await act(() => result.current.start());
    await waitFor(() => expect(result.current.session?.stateVersion).toBe(1));

    let refreshError: unknown;
    await act(async () => {
      try {
        await result.current.refresh();
      } catch (error) {
        refreshError = error;
      }
    });

    expect(refreshError).toBeInstanceOf(CallCenterRequestError);
    expect((refreshError as CallCenterRequestError).operatorError.code).toBe(
      "MICROPHONE_REQUIRED",
    );
  });

  it("releases the lease instead of heartbeating an offline session", async () => {
    const methods: string[] = [];
    globalThis.fetch = mock(async (_input, init) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "POST") return acquisition();
      return Response.json({ session: agentSession(1) });
    }) as unknown as typeof fetch;
    const { result, rerender } = renderHook(
      ({ presence }) =>
        useCanonicalAgentSession({
          audioReady: presence === "AVAILABLE",
          clientInstanceId: "browser-1",
          connectionState: presence === "AVAILABLE" ? "READY" : "CONNECTING",
          microphoneReady: presence === "AVAILABLE",
          presence,
        }),
      { initialProps: { presence: "AVAILABLE" as AgentSessionView["presence"] } },
    );

    await act(() => result.current.start());
    await waitFor(() => expect(methods).toEqual(["POST", "PATCH"]));
    rerender({ presence: "OFFLINE" });

    await waitFor(() => expect(methods).toEqual(["POST", "PATCH", "DELETE"]));
    expect(result.current.session).toBeNull();
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
  });

  it("surfaces acquisition failures without creating a session", async () => {
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
      useCanonicalAgentSession({
        audioReady: false,
        clientInstanceId: "browser-1",
        connectionState: "CONNECTING",
        microphoneReady: false,
        presence: "PAUSED",
      }),
    );

    await act(() => result.current.start());
    expect(result.current.error).toBe("Phone active in another tab");
    expect(result.current.session).toBeNull();
  });
});
