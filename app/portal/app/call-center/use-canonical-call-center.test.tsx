import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import type { CallCenterSnapshot } from "@/lib/call-center/realtime-contract";

import { useCanonicalCallCenter } from "./use-canonical-call-center";

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

function snapshot(stateVersion = 0, queueId = "queue-1"): CallCenterSnapshot {
  return {
    calls: stateVersion
      ? [
          {
            answeredAt: null,
            callOfficeLabel: null,
            callerName: null,
            direction: "INBOUND",
            endedAt: null,
            fromPhone: "+17865550100",
            id: "call-1",
            legs: [],
            queueId,
            receivedAt: "2026-07-19T10:00:00.000Z",
            stateVersion,
            status: "RINGING",
            toPhone: "+17865550101",
            winningLegId: null,
          },
        ]
      : [],
    observedAt: "2026-07-19T10:00:00.000Z",
    queueId,
    schemaVersion: 6,
  };
}

function temporaryFailure() {
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

function accessDenied() {
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

describe("useCanonicalCallCenter", () => {
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
  });

  it("reads authoritative state repeatedly without opening an event stream", async () => {
    let requestCount = 0;
    globalThis.fetch = mock(async () => {
      requestCount += 1;
      return Response.json(snapshot(requestCount));
    }) as unknown as typeof fetch;
    globalThis.EventSource = class {
      constructor() {
        throw new Error("SSE must not be opened");
      }
    } as unknown as typeof EventSource;

    const { result, unmount } = renderHook(() =>
      useCanonicalCallCenter({
        pollIntervalMs: 20,
        queueId: "queue-1",
      }),
    );

    await waitFor(() =>
      expect(result.current.state?.calls[0]?.stateVersion).toBeGreaterThan(1),
    );
    expect(result.current.loading).toBe(false);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "/api/portal/call-center/snapshot?queueId=queue-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    unmount();
  });

  it("never starts a second read while the current read is in flight", async () => {
    let finish: ((response: Response) => void) | null = null;
    globalThis.fetch = mock(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useCanonicalCallCenter({
        pollIntervalMs: 20,
        queueId: "queue-1",
      }),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 70));
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);

    await act(async () => finish?.(Response.json(snapshot(1))));
    await waitFor(() => expect(result.current.state?.calls[0]?.stateVersion).toBe(1));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
  });

  it("keeps the last state after a failed read and retries on the next interval", async () => {
    let finishRetry: ((response: Response) => void) | null = null;
    let requestCount = 0;
    const requestHeaders: Record<string, string>[] = [];
    globalThis.fetch = mock(async (_input, init) => {
      requestCount += 1;
      requestHeaders.push(init?.headers as Record<string, string>);
      if (requestCount === 1) return Response.json(snapshot(1));
      if (requestCount === 2) return temporaryFailure();
      return new Promise<Response>((resolve) => {
        finishRetry = resolve;
      });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useCanonicalCallCenter({
        pollIntervalMs: 30,
        queueId: "queue-1",
        retryBaseMs: 30,
      }),
    );

    await waitFor(() => expect(result.current.state?.calls[0]?.stateVersion).toBe(1));
    await waitFor(() =>
      expect(result.current.error?.message).toBe("TEMPORARY_SERVICE_FAILURE"),
    );
    expect(result.current.state?.calls[0]?.stateVersion).toBe(1);
    expect(result.current.loading).toBe(false);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));
    await act(async () => finishRetry?.(Response.json(snapshot(3))));
    await waitFor(() => expect(result.current.state?.calls[0]?.stateVersion).toBe(3));
    expect(result.current.error).toBeNull();
    expect(
      requestHeaders.slice(0, 3).map((headers) => headers["X-Call-Center-Retry-Attempt"]),
    ).toEqual(["0", "0", "1"]);
    expect(Number(requestHeaders[2]?.["X-Call-Center-Retry-Delay-Ms"])).toBeGreaterThan(
      0,
    );
  });

  it("supports an immediate read without overlapping the current request", async () => {
    let requestCount = 0;
    globalThis.fetch = mock(async () => {
      requestCount += 1;
      return Response.json(snapshot(requestCount));
    }) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useCanonicalCallCenter({
        pollIntervalMs: 60_000,
        queueId: "queue-1",
      }),
    );

    await waitFor(() => expect(result.current.state?.calls[0]?.stateVersion).toBe(1));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.state?.calls[0]?.stateVersion).toBe(2));
  });

  it("clears retained calls when queue authorization is lost", async () => {
    let requestCount = 0;
    globalThis.fetch = mock(async () => {
      requestCount += 1;
      return requestCount === 1 ? Response.json(snapshot(1)) : accessDenied();
    }) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useCanonicalCallCenter({
        pollIntervalMs: 60_000,
        queueId: "queue-1",
      }),
    );

    await waitFor(() => expect(result.current.state?.calls[0]?.id).toBe("call-1"));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.error?.message).toBe("ACCESS_DENIED"));
    expect(result.current.state).toBeNull();
  });

  it("aborts an obsolete read when the operator scope changes", async () => {
    let firstSignal: AbortSignal | undefined;
    let resolveFirst: ((response: Response) => void) | undefined;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("queueId=queue-1")) {
        firstSignal = init?.signal as AbortSignal;
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(Response.json(snapshot(2, "queue-2")));
    }) as unknown as typeof fetch;
    const { result, rerender } = renderHook(
      ({ queueId }) =>
        useCanonicalCallCenter({
          pollIntervalMs: 60_000,
          queueId,
        }),
      { initialProps: { queueId: "queue-1" } },
    );

    rerender({ queueId: "queue-2" });
    expect(firstSignal?.aborted).toBe(true);
    resolveFirst?.(Response.json(snapshot(1)));

    await waitFor(() => expect(result.current.state?.calls[0]?.stateVersion).toBe(2));
  });

  it("rejects an incompatible snapshot schema", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ ...snapshot(), schemaVersion: 1 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useCanonicalCallCenter({
        pollIntervalMs: 60_000,
        queueId: "queue-1",
      }),
    );

    await waitFor(() =>
      expect(result.current.error?.message).toBe(
        "Call center returned an incompatible snapshot",
      ),
    );
    expect(result.current.state).toBeNull();
  });
});
