import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import {
  CALL_CENTER_SCHEMA_VERSION,
  type CallCenterSnapshot,
} from "@/lib/call-center/realtime-contract";

import { useCanonicalCallCenter } from "./use-canonical-call-center";

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

function snapshot(revision = "10", queueId = "queue-1"): CallCenterSnapshot {
  return {
    agentProfile: null,
    agentSession: null,
    availableQueues: [{ id: queueId, name: "Optical" }],
    calls: [],
    counts: { active: 0, openTasks: 0, recent: 0, waiting: 0 },
    operations: null,
    queue: {
      id: queueId,
      maxWaitSec: 20,
      name: "Optical",
      ringTimeoutSec: 20,
    },
    revision,
    schemaVersion: CALL_CENTER_SCHEMA_VERSION,
    tasks: [],
    transferTargets: [],
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
      return Response.json(snapshot(String(requestCount * 10)));
    }) as unknown as typeof fetch;
    globalThis.EventSource = class {
      constructor() {
        throw new Error("SSE must not be opened");
      }
    } as unknown as typeof EventSource;

    const { result, unmount } = renderHook(() =>
      useCanonicalCallCenter({
        clientInstanceId: "tab-1",
        pollIntervalMs: 20,
        queueId: "queue-1",
      }),
    );

    await waitFor(() =>
      expect(Number(result.current.state?.revision)).toBeGreaterThanOrEqual(20),
    );
    expect(result.current.loading).toBe(false);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "/api/portal/call-center/snapshot?clientInstanceId=tab-1&queueId=queue-1",
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
        clientInstanceId: "tab-1",
        pollIntervalMs: 20,
        queueId: "queue-1",
      }),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 70));
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);

    await act(async () => finish?.(Response.json(snapshot("10"))));
    await waitFor(() => expect(result.current.state?.revision).toBe("10"));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
  });

  it("keeps the last state after a failed read and retries on the next interval", async () => {
    let requestCount = 0;
    globalThis.fetch = mock(async () => {
      requestCount += 1;
      if (requestCount === 1) return Response.json(snapshot("10"));
      if (requestCount === 2) return temporaryFailure();
      return Response.json(snapshot("30"));
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useCanonicalCallCenter({
        clientInstanceId: "tab-1",
        pollIntervalMs: 30,
        queueId: "queue-1",
      }),
    );

    await waitFor(() => expect(result.current.state?.revision).toBe("10"));
    await waitFor(() =>
      expect(result.current.error?.message).toBe("TEMPORARY_SERVICE_FAILURE"),
    );
    expect(result.current.state?.revision).toBe("10");
    expect(result.current.loading).toBe(false);

    await waitFor(() => expect(result.current.state?.revision).toBe("30"));
    expect(result.current.error).toBeNull();
  });

  it("supports an immediate read without overlapping the current request", async () => {
    let requestCount = 0;
    globalThis.fetch = mock(async () => {
      requestCount += 1;
      return Response.json(snapshot(String(requestCount * 10)));
    }) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useCanonicalCallCenter({
        clientInstanceId: "tab-1",
        pollIntervalMs: 60_000,
        queueId: "queue-1",
      }),
    );

    await waitFor(() => expect(result.current.state?.revision).toBe("10"));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.state?.revision).toBe("20"));
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
      return Promise.resolve(Response.json(snapshot("50", "queue-2")));
    }) as unknown as typeof fetch;
    const { result, rerender } = renderHook(
      ({ queueId }) =>
        useCanonicalCallCenter({
          clientInstanceId: "tab-1",
          pollIntervalMs: 60_000,
          queueId,
        }),
      { initialProps: { queueId: "queue-1" } },
    );

    rerender({ queueId: "queue-2" });
    expect(firstSignal?.aborted).toBe(true);
    resolveFirst?.(Response.json(snapshot("20")));

    await waitFor(() => expect(result.current.state?.revision).toBe("50"));
  });
});
