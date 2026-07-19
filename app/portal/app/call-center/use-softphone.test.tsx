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
type SoftphoneLifecycleEvent = import("./use-softphone").SoftphoneLifecycleEvent;
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

  it("waits for provider state and rejects a late Telnyx answer failure", async () => {
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

    const call = {
      answer: mock(async () => {}),
      direction: "incoming",
      id: "media-leg-1",
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {
        telnyxCallControlId: "control-1",
        telnyxLegId: "provider-leg-1",
        telnyxSessionId: "provider-session-1",
      },
    };
    act(() => clients[0]?.emitCallUpdate(call));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    let outcome = "pending";
    let failure: unknown = null;
    act(() => {
      void result.current.answer("media-leg-1").then(
        () => {
          outcome = "resolved";
        },
        (error) => {
          outcome = "rejected";
          failure = error;
        },
      );
    });
    await waitFor(() => expect(call.answer).toHaveBeenCalledTimes(1));
    expect(outcome).toBe("pending");

    act(() =>
      clients[0]?.emit("telnyx.error", {
        error: { fatal: true, name: "SDP_CREATE_ANSWER_FAILED" },
        sessionId: "browser-provider-session-1",
      }),
    );
    await waitFor(() => {
      expect(outcome).toBe("rejected");
      expect(failure).toMatchObject({
        operatorError: { code: "CALL_NOT_CONNECTED", retryable: false },
      });
    });
    expect(result.current.connection).toBe("READY");
  });

  it("keeps a recovering offer visible and answers only its exact replacement", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ token: "canonical-token" }),
    ) as unknown as typeof fetch;

    const onLifecycle = mock((_event: SoftphoneLifecycleEvent) => {});
    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        enabled: true,
        onLifecycle,
      }),
    );
    await waitFor(() => expect(result.current.connection).toBe("READY"));

    const staleAnswer = mock(async () => {});
    const staleCall = {
      answer: staleAnswer,
      direction: "incoming",
      id: "media-leg-1",
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {
        telnyxCallControlId: "control-1",
        telnyxLegId: "provider-leg-1",
        telnyxSessionId: "provider-session-1",
      },
    };
    act(() => clients[0]?.emitCallUpdate(staleCall));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    act(() => clients[0]?.emit("telnyx.socket.close"));
    expect(result.current.observations[0]).toMatchObject({
      availability: "RECOVERING",
      mediaLegId: "media-leg-1",
    });
    act(() => clients[0]?.emit("telnyx.ready"));
    expect(result.current.connection).toBe("READY");
    expect(result.current.observations[0]?.availability).toBe("RECOVERING");
    await expect(result.current.answer("media-leg-1")).rejects.toThrow();
    expect(staleAnswer).not.toHaveBeenCalled();

    const replacementAnswer = mock(async () => {});
    const replacementCall = {
      ...staleCall,
      answer: replacementAnswer,
      id: "media-leg-2",
      recoveredCallId: "media-leg-1",
    };
    act(() => clients[0]?.emitCallUpdate(replacementCall));
    await waitFor(() =>
      expect(result.current.observations).toEqual([
        expect.objectContaining({
          availability: "READY",
          mediaLegId: "media-leg-2",
          recoveredMediaLegId: "media-leg-1",
        }),
      ]),
    );

    let answerPromise!: Promise<void>;
    act(() => {
      answerPromise = result.current.answer("media-leg-2");
    });
    await waitFor(() => expect(replacementAnswer).toHaveBeenCalledTimes(1));
    act(() => clients[0]?.emitCallUpdate({ ...replacementCall, state: "active" }));
    await expect(answerPromise).resolves.toBeUndefined();
    expect(staleAnswer).not.toHaveBeenCalled();
    expect(onLifecycle.mock.calls.map(([event]) => event.category)).toContain(
      "SIGNALING_INTERRUPTED",
    );
    expect(onLifecycle.mock.calls.map(([event]) => event.category)).toContain(
      "REATTACH_SUCCEEDED",
    );
  });

  it("correlates one recovering replacement through exact provider identity", async () => {
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

    const providerIds = {
      telnyxCallControlId: "control-1",
      telnyxLegId: "provider-leg-1",
      telnyxSessionId: "provider-session-1",
    };
    act(() =>
      clients[0]?.emitCallUpdate({
        answer: mock(async () => {}),
        direction: "incoming",
        id: "media-leg-1",
        remoteStream: null,
        state: "ringing",
        telnyxIDs: providerIds,
      }),
    );
    await waitFor(() => expect(result.current.observations).toHaveLength(1));
    act(() => clients[0]?.emit("telnyx.socket.close"));

    const replacementAnswer = mock(async () => {});
    const replacementCall = {
      answer: replacementAnswer,
      direction: "incoming",
      id: "media-leg-2",
      remoteStream: null,
      state: "ringing",
      telnyxIDs: providerIds,
    };
    act(() => clients[0]?.emitCallUpdate(replacementCall));

    await waitFor(() =>
      expect(result.current.observations).toEqual([
        expect.objectContaining({
          availability: "READY",
          mediaLegId: "media-leg-2",
          recoveredMediaLegId: "media-leg-1",
        }),
      ]),
    );
    let answerPromise!: Promise<void>;
    act(() => {
      answerPromise = result.current.answer("media-leg-2");
    });
    act(() => clients[0]?.emitCallUpdate({ ...replacementCall, state: "active" }));
    await expect(answerPromise).resolves.toBeUndefined();
    expect(replacementAnswer).toHaveBeenCalledTimes(1);
  });

  it("moves one pending Answer intent to a recovered SDK call", async () => {
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

    const staleAnswer = mock(async () => {});
    const staleCall = {
      answer: staleAnswer,
      direction: "incoming",
      id: "media-leg-1",
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {
        telnyxCallControlId: "control-1",
        telnyxLegId: "provider-leg-1",
        telnyxSessionId: "provider-session-1",
      },
    };
    act(() => clients[0]?.emitCallUpdate(staleCall));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    let answerPromise!: Promise<void>;
    act(() => {
      answerPromise = result.current.answer("media-leg-1");
    });
    await waitFor(() => expect(staleAnswer).toHaveBeenCalledTimes(1));

    act(() => clients[0]?.emit("telnyx.socket.close"));
    const replacementAnswer = mock(async () => {});
    const replacementCall = {
      ...staleCall,
      answer: replacementAnswer,
      id: "media-leg-2",
      recoveredCallId: "media-leg-1",
    };
    act(() => clients[0]?.emitCallUpdate(replacementCall));
    await waitFor(() => expect(replacementAnswer).toHaveBeenCalledTimes(1));

    act(() => clients[0]?.emitCallUpdate({ ...replacementCall, state: "active" }));
    await expect(answerPromise).resolves.toBeUndefined();
    expect(staleAnswer).toHaveBeenCalledTimes(1);
  });

  it("does not transfer a pending Answer after its canonical intent expires", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ token: "canonical-token" }),
    ) as unknown as typeof fetch;
    const canContinueAnswer = mock(() => false);
    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        canContinueAnswer,
        enabled: true,
      }),
    );
    await waitFor(() => expect(result.current.connection).toBe("READY"));

    const staleCall = {
      answer: mock(async () => {}),
      direction: "incoming",
      id: "media-leg-1",
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {
        telnyxCallControlId: "control-1",
        telnyxLegId: "provider-leg-1",
        telnyxSessionId: "provider-session-1",
      },
    };
    act(() => clients[0]?.emitCallUpdate(staleCall));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    let answerPromise!: Promise<void>;
    act(() => {
      answerPromise = result.current.answer("media-leg-1");
    });
    await waitFor(() => expect(staleCall.answer).toHaveBeenCalledTimes(1));
    act(() => clients[0]?.emit("telnyx.socket.close"));

    const replacementAnswer = mock(async () => {});
    act(() =>
      clients[0]?.emitCallUpdate({
        ...staleCall,
        answer: replacementAnswer,
        id: "media-leg-2",
        recoveredCallId: "media-leg-1",
      }),
    );

    await expect(answerPromise).rejects.toThrow();
    expect(canContinueAnswer).toHaveBeenCalledWith("media-leg-1");
    expect(replacementAnswer).not.toHaveBeenCalled();
  });

  it("fails closed when recoveredCallId cannot identify one predecessor", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ token: "canonical-token" }),
    ) as unknown as typeof fetch;
    const onLifecycle = mock((_event: SoftphoneLifecycleEvent) => {});
    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        enabled: true,
        onLifecycle,
      }),
    );
    await waitFor(() => expect(result.current.connection).toBe("READY"));

    act(() =>
      clients[0]?.emitCallUpdate({
        answer: mock(async () => {}),
        direction: "incoming",
        id: "media-leg-1",
        remoteStream: null,
        state: "ringing",
        telnyxIDs: {
          telnyxCallControlId: "control-1",
          telnyxLegId: "provider-leg-1",
          telnyxSessionId: "provider-session-1",
        },
      }),
    );
    await waitFor(() => expect(result.current.observations).toHaveLength(1));
    act(() => clients[0]?.emit("telnyx.socket.close"));
    act(() =>
      clients[0]?.emitCallUpdate({
        answer: mock(async () => {}),
        direction: "incoming",
        id: "media-leg-2",
        recoveredCallId: "unknown-media-leg",
        remoteStream: null,
        state: "ringing",
        telnyxIDs: {
          telnyxCallControlId: "control-2",
          telnyxLegId: "provider-leg-2",
          telnyxSessionId: "provider-session-2",
        },
      }),
    );

    expect(result.current.observations).toEqual([
      expect.objectContaining({
        availability: "RECOVERING",
        mediaLegId: "media-leg-1",
      }),
    ]);
    expect(onLifecycle.mock.calls.map(([event]) => event.category)).toContain(
      "REATTACH_CORRELATION_FAILED",
    );
    await expect(result.current.answer("media-leg-2")).rejects.toThrow();
  });

  it("deduplicates repeated SESSION_NOT_REATTACHED recovery requests", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ token: "canonical-token" }),
    ) as unknown as typeof fetch;
    const onRecoveryNeeded = mock(() => {});
    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        enabled: true,
        onRecoveryNeeded,
      }),
    );
    await waitFor(() => expect(result.current.connection).toBe("READY"));
    act(() =>
      clients[0]?.emitCallUpdate({
        answer: mock(async () => {}),
        direction: "incoming",
        id: "media-leg-1",
        remoteStream: null,
        state: "ringing",
        telnyxIDs: {
          telnyxCallControlId: "control-1",
          telnyxLegId: "provider-leg-1",
          telnyxSessionId: "provider-session-1",
        },
      }),
    );
    await waitFor(() => expect(result.current.observations).toHaveLength(1));
    act(() => clients[0]?.emit("telnyx.socket.close"));
    act(() => clients[0]?.emit("telnyx.ready"));

    const error = {
      callId: "media-leg-1",
      error: { code: 48501, fatal: true, name: "SESSION_NOT_REATTACHED" },
    };
    act(() => {
      clients[0]?.emit("telnyx.error", error);
      clients[0]?.emit("telnyx.error", error);
    });

    expect(result.current.observations[0]?.availability).toBe("FAILED");
    expect(result.current.connection).toBe("READY");
    expect(onRecoveryNeeded).toHaveBeenCalledTimes(1);
    expect(onRecoveryNeeded).toHaveBeenCalledWith({
      mediaLegId: "media-leg-1",
      reason: "SESSION_NOT_REATTACHED",
      recoveryGeneration: 1,
    });
  });

  it("invalidates CALL DOES NOT EXIST before requesting one replacement", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ token: "canonical-token" }),
    ) as unknown as typeof fetch;
    const onRecoveryNeeded = mock(() => {});
    const onLifecycle = mock((_event: SoftphoneLifecycleEvent) => {});

    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        enabled: true,
        onLifecycle,
        onRecoveryNeeded,
      }),
    );
    await waitFor(() => expect(result.current.connection).toBe("READY"));

    const answer = mock(async () => {
      throw { code: -32002, message: "CALL DOES NOT EXIST" };
    });
    act(() =>
      clients[0]?.emitCallUpdate({
        answer,
        direction: "incoming",
        id: "media-leg-1",
        remoteStream: null,
        state: "ringing",
        telnyxIDs: {
          telnyxCallControlId: "control-1",
          telnyxLegId: "provider-leg-1",
          telnyxSessionId: "provider-session-1",
        },
      }),
    );
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    await act(async () => {
      await expect(result.current.answer("media-leg-1")).rejects.toMatchObject({
        operatorError: { code: "CALL_NOT_CONNECTED", retryable: false },
      });
    });
    await waitFor(() =>
      expect(result.current.observations[0]).toMatchObject({
        availability: "FAILED",
        mediaLegId: "media-leg-1",
      }),
    );
    expect(onRecoveryNeeded).toHaveBeenCalledTimes(1);
    expect(onRecoveryNeeded).toHaveBeenCalledWith({
      mediaLegId: "media-leg-1",
      reason: "CALL_DOES_NOT_EXIST",
      recoveryGeneration: 0,
    });

    await expect(result.current.answer("media-leg-1")).rejects.toThrow();
    expect(answer).toHaveBeenCalledTimes(1);
    expect(onRecoveryNeeded).toHaveBeenCalledTimes(1);
    const lifecycleEvents = onLifecycle.mock.calls.map(([event]) => event);
    expect(lifecycleEvents.map(({ category }) => category)).toContain("ANSWER_FAILED");
    expect(lifecycleEvents.map(({ category }) => category)).toContain("REATTACH_FAILED");
    expect(JSON.stringify(lifecycleEvents)).not.toContain("phoneNumber");
    expect(JSON.stringify(lifecycleEvents)).not.toContain("rawProviderPayload");

    const replacementAnswer = mock(async () => {});
    const replacement = {
      answer: replacementAnswer,
      direction: "incoming",
      id: "media-leg-2",
      recoveredCallId: "media-leg-1",
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {
        telnyxCallControlId: "control-2",
        telnyxLegId: "provider-leg-2",
        telnyxSessionId: "provider-session-2",
      },
    };
    act(() => clients[0]?.emitCallUpdate(replacement));
    await waitFor(() =>
      expect(result.current.observations[0]).toMatchObject({
        availability: "READY",
        mediaLegId: "media-leg-2",
      }),
    );
    let replacementAnswerPromise!: Promise<void>;
    act(() => {
      replacementAnswerPromise = result.current.answer("media-leg-2");
    });
    act(() => clients[0]?.emitCallUpdate({ ...replacement, state: "active" }));
    await expect(replacementAnswerPromise).resolves.toBeUndefined();
    expect(replacementAnswer).toHaveBeenCalledTimes(1);
  });

  it("invalidates a terminal SDK offer and requests one fresh agent leg", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ token: "canonical-token" }),
    ) as unknown as typeof fetch;
    const onRecoveryNeeded = mock(() => {});
    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        enabled: true,
        onRecoveryNeeded,
      }),
    );
    await waitFor(() => expect(result.current.connection).toBe("READY"));
    const call = {
      answer: mock(async () => {}),
      direction: "incoming",
      id: "media-leg-1",
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {
        telnyxCallControlId: "control-1",
        telnyxLegId: "provider-leg-1",
        telnyxSessionId: "provider-session-1",
      },
    };
    act(() => clients[0]?.emitCallUpdate(call));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    act(() => clients[0]?.emitCallUpdate({ ...call, state: "failed" }));

    expect(result.current.observations).toEqual([]);
    expect(onRecoveryNeeded).toHaveBeenCalledWith({
      mediaLegId: "media-leg-1",
      reason: "SDK_CALL_TERMINAL",
      recoveryGeneration: 0,
    });
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
    expect(result.current.error).toBe("Phone active in another tab");
  });
});
