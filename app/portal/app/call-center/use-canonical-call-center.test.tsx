import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import {
  CALL_CENTER_SCHEMA_VERSION,
  type CallCenterSnapshot,
  type ProjectionEvent,
} from "@/lib/call-center/realtime-contract";

import { useCanonicalCallCenter } from "./use-canonical-call-center";

const sources: FakeEventSource[] = [];

class FakeEventSource {
  closeCount = 0;
  listeners = new Map<string, Set<EventListener>>();

  constructor(readonly url: string | URL) {
    sources.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.closeCount += 1;
  }

  emit(type: string, data?: unknown) {
    const event =
      data === undefined
        ? new Event(type)
        : new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const originalEventSource = globalThis.EventSource;
const originalFetch = globalThis.fetch;

function snapshot(revision = "10"): CallCenterSnapshot {
  return {
    agentSession: null,
    availableQueues: [{ id: "queue-1", name: "Optical" }],
    calls: [],
    counts: { active: 0, openTasks: 0, recent: 0, waiting: 0 },
    endpoints: [],
    operations: null,
    queue: {
      id: "queue-1",
      maxWaitSec: 30,
      name: "Optical",
      ringTimeoutSec: 20,
      routingMode: "SHADOW",
    },
    revision,
    schemaVersion: CALL_CENTER_SCHEMA_VERSION,
    tasks: [],
  };
}

function projection(revision: string): ProjectionEvent {
  return {
    aggregateId: "call-1",
    aggregateType: "CALL",
    delta: {
      call: {
        answeredAt: null,
        callerName: "Patient",
        direction: "INBOUND",
        endedAt: null,
        fromPhone: "+13055550100",
        id: "call-1",
        legs: [],
        queueId: "queue-1",
        receivedAt: "2026-07-12T12:00:00.000Z",
        stateVersion: 1,
        status: "RINGING",
        toPhone: "+17865550100",
        winningLegId: null,
      },
      kind: "CALL_UPSERT",
    },
    revision,
    schemaVersion: CALL_CENTER_SCHEMA_VERSION,
    stateVersion: 1,
  };
}

describe("useCanonicalCallCenter", () => {
  beforeEach(() => {
    sources.length = 0;
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    cleanup();
    globalThis.EventSource = originalEventSource;
    globalThis.fetch = originalFetch;
  });

  it("hydrates one canonical state and applies projection and cursor events", async () => {
    globalThis.fetch = mock(async () =>
      Response.json(snapshot()),
    ) as unknown as typeof fetch;
    const { result, unmount } = renderHook(() =>
      useCanonicalCallCenter({ clientInstanceId: "tab-1", queueId: "queue-1" }),
    );

    await waitFor(() => expect(result.current.state?.revision).toBe("10"));
    expect(result.current.loading).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      "/api/portal/call-center/snapshot?clientInstanceId=tab-1&queueId=queue-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(String(sources[0]?.url)).toBe(
      "/api/portal/call-center/events?after=10&clientInstanceId=tab-1&contract=canonical&queueId=queue-1",
    );

    act(() => sources[0]?.emit("projection", projection("12")));
    expect(result.current.state?.calls[0]?.status).toBe("RINGING");
    expect(result.current.state?.revision).toBe("12");

    act(() => sources[0]?.emit("cursor", { revision: "18" }));
    expect(result.current.state?.revision).toBe("18");

    act(() => sources[0]?.emit("error"));
    expect(result.current.state?.connection).toBe("RECONNECTING");
    expect(sources).toHaveLength(1);

    act(() => sources[0]?.emit("open"));
    expect(result.current.state?.connection).toBe("CONNECTED");
    expect(sources).toHaveLength(1);

    unmount();
    expect(sources[0]?.closeCount).toBe(1);
  });

  it("closes the stale stream and refetches a snapshot on reset", async () => {
    let requestCount = 0;
    globalThis.fetch = mock(async () => {
      requestCount += 1;
      return Response.json(snapshot(requestCount === 1 ? "10" : "30"));
    }) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useCanonicalCallCenter({ clientInstanceId: "tab-1", queueId: "queue-1" }),
    );

    await waitFor(() => expect(sources).toHaveLength(1));
    act(() => sources[0]?.emit("reset", { reason: "RETENTION_GAP", revision: "20" }));

    expect(sources[0]?.closeCount).toBe(1);
    await waitFor(() => expect(result.current.state?.revision).toBe("30"));
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(sources).toHaveLength(2);
    expect(String(sources[1]?.url)).toContain("after=30");
  });

  it("surfaces snapshot failure and allows an explicit refetch", async () => {
    let requestCount = 0;
    globalThis.fetch = mock(async () => {
      requestCount += 1;
      return requestCount === 1
        ? new Response(null, { status: 503 })
        : Response.json(snapshot("40"));
    }) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useCanonicalCallCenter({ clientInstanceId: "tab-1", queueId: "queue-1" }),
    );

    await waitFor(() => expect(result.current.error?.message).toContain("503"));
    expect(result.current.loading).toBe(false);

    act(() => result.current.refetch());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.state?.revision).toBe("40"));
    expect(result.current.error).toBeNull();
    expect(sources).toHaveLength(1);
  });

  it("aborts an obsolete snapshot request when its identity changes", async () => {
    let firstSignal: AbortSignal | undefined;
    let resolveFirst: ((response: Response) => void) | undefined;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("queueId=queue-1")) {
        firstSignal = init?.signal as AbortSignal;
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(Response.json(snapshot("50")));
    }) as unknown as typeof fetch;
    const { result, rerender } = renderHook(
      ({ queueId }) => useCanonicalCallCenter({ clientInstanceId: "tab-1", queueId }),
      { initialProps: { queueId: "queue-1" } },
    );

    rerender({ queueId: "queue-2" });
    expect(firstSignal?.aborted).toBe(true);
    resolveFirst?.(Response.json(snapshot("20")));

    await waitFor(() => expect(result.current.state?.revision).toBe("50"));
    expect(sources).toHaveLength(1);
    expect(String(sources[0]?.url)).toContain("queueId=queue-2");
  });
});
