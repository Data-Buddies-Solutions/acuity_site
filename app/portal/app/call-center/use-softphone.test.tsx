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
const originalAudioContext = Object.getOwnPropertyDescriptor(window, "AudioContext");
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
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
    if (originalAudioContext) {
      Object.defineProperty(window, "AudioContext", originalAudioContext);
    } else {
      delete (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    }
    if (originalMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    } else {
      delete (navigator as unknown as { mediaDevices?: MediaDevices }).mediaDevices;
    }
  });

  it("keeps one registered client warm through Answer", async () => {
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

    const call = {
      answer: mock(async () => {}),
      direction: "incoming",
      id: "media-leg-1",
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {},
    };
    act(() => clients[0]?.emitCallUpdate(call));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    let answerPromise!: Promise<void>;
    act(() => {
      answerPromise = result.current.answer("media-leg-1");
    });
    act(() => clients[0]?.emitCallUpdate({ ...call, state: "active" }));
    await act(async () => {
      await answerPromise;
    });

    expect(call.answer).toHaveBeenCalledTimes(1);
    expect(clients).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it("completes Available media preflight without retaining a microphone stream", async () => {
    const stop = mock(() => {});
    const getUserMedia = mock(async () => ({
      getTracks: () => [{ stop }],
    }));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    class FakeAudioContext {
      currentTime = 0;
      destination = {};
      close = mock(async () => {});
      resume = mock(async () => {});
      createGain() {
        return {
          connect: mock(() => {}),
          gain: {
            linearRampToValueAtTime: mock(() => {}),
            setValueAtTime: mock(() => {}),
          },
        };
      }
      createOscillator() {
        return {
          connect: mock(() => {}),
          frequency: { value: 0 },
          start: mock(() => {}),
          stop: mock(() => {}),
        };
      }
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    globalThis.fetch = mock(async () =>
      Response.json({ token: "canonical-token" }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        autoPrepare: true,
        browserSessionId: "browser-1",
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.connection).toBe("READY");
      expect(result.current.microphoneReady).toBe(true);
      expect(result.current.soundReady).toBe(true);
    });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(result.current.observations).toEqual([]);
  });

  it("retries a transient token failure without overlapping requests", async () => {
    let concurrentRequests = 0;
    let maxConcurrentRequests = 0;
    let requestCount = 0;
    globalThis.fetch = mock(async () => {
      requestCount += 1;
      concurrentRequests += 1;
      maxConcurrentRequests = Math.max(maxConcurrentRequests, concurrentRequests);
      await Promise.resolve();
      concurrentRequests -= 1;
      if (requestCount === 1) {
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
      return Response.json({ token: "canonical-token" });
    }) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        enabled: true,
        retryBaseMs: 10,
      }),
    );

    await waitFor(() => expect(result.current.connection).toBe("READY"));
    expect(requestCount).toBe(2);
    expect(maxConcurrentRequests).toBe(1);
    expect(clients).toHaveLength(1);
  });

  it("creates a fresh Telnyx client after fatal registration failure", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ token: "canonical-token" }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        enabled: true,
        retryBaseMs: 10,
      }),
    );
    await waitFor(() => expect(result.current.connection).toBe("READY"));

    act(() =>
      clients[0]?.emit("telnyx.error", {
        error: { fatal: true, message: "Registration failed" },
      }),
    );

    await waitFor(() => expect(clients).toHaveLength(2));
    await waitFor(() => expect(result.current.connection).toBe("READY"));
    expect(clients[0]?.disconnectCount).toBe(1);
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

  it("moves one pending Answer to its exact recovered SDK Call", async () => {
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

    const clientState = btoa(
      JSON.stringify({
        callId: "call-1",
        canonicalCommand: true,
        legId: "leg-1",
      }),
    );
    const predecessor = {
      answer: mock(async () => {}),
      direction: "incoming",
      id: "media-leg-1",
      options: { clientState },
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {
        telnyxCallControlId: "control-1",
        telnyxLegId: "provider-leg-1",
        telnyxSessionId: "provider-session-1",
      },
    };
    act(() => clients[0]?.emitCallUpdate(predecessor));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    let answerPromise!: Promise<void>;
    act(() => {
      answerPromise = result.current.answer("media-leg-1");
    });
    await waitFor(() => expect(predecessor.answer).toHaveBeenCalledTimes(1));
    expect(result.current.answeringMediaLegId).toBe("media-leg-1");

    const replacement = {
      ...predecessor,
      answer: mock(async () => {}),
      id: "media-leg-2",
      options: undefined,
      recoveredCallId: "media-leg-1",
    };
    act(() => clients[0]?.emitCallUpdate(replacement));
    act(() => clients[0]?.emitCallUpdate(replacement));
    await waitFor(() => expect(replacement.answer).toHaveBeenCalledTimes(1));
    expect(result.current.answeringMediaLegId).toBe("media-leg-2");
    expect(predecessor.answer).toHaveBeenCalledTimes(1);
    expect(result.current.observations).toEqual([
      expect.objectContaining({
        canonicalCallId: "call-1",
        canonicalLegId: "leg-1",
        mediaLegId: "media-leg-2",
      }),
    ]);

    act(() => clients[0]?.emitCallUpdate({ ...replacement, state: "active" }));
    await act(async () => {
      await expect(answerPromise).resolves.toBeUndefined();
    });
    await waitFor(() => expect(result.current.answeringMediaLegId).toBeNull());
  });

  it("accepts an already-active exact replacement without answering it again", async () => {
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

    const predecessor = {
      answer: mock(async () => {}),
      direction: "incoming",
      id: "media-leg-1",
      options: {
        clientState: btoa(
          JSON.stringify({
            callId: "call-1",
            canonicalCommand: true,
            legId: "leg-1",
          }),
        ),
      },
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {},
    };
    act(() => clients[0]?.emitCallUpdate(predecessor));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    let answerPromise!: Promise<void>;
    act(() => {
      answerPromise = result.current.answer("media-leg-1");
    });
    await waitFor(() => expect(predecessor.answer).toHaveBeenCalledTimes(1));

    const replacement = {
      ...predecessor,
      answer: mock(async () => {}),
      id: "media-leg-2",
      options: undefined,
      recoveredCallId: "media-leg-1",
      state: "active",
    };
    act(() => clients[0]?.emitCallUpdate(replacement));
    await act(async () => {
      await answerPromise;
    });

    expect(replacement.answer).not.toHaveBeenCalled();
    expect(result.current.observations).toEqual([
      expect.objectContaining({
        canonicalCallId: "call-1",
        canonicalLegId: "leg-1",
        mediaLegId: "media-leg-2",
        state: "ACTIVE",
      }),
    ]);
  });

  it("fails a pending Answer when its exact replacement is already failed", async () => {
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

    const predecessor = {
      answer: mock(async () => {}),
      direction: "incoming",
      id: "media-leg-1",
      options: {
        clientState: btoa(
          JSON.stringify({
            callId: "call-1",
            canonicalCommand: true,
            legId: "leg-1",
          }),
        ),
      },
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {},
    };
    act(() => clients[0]?.emitCallUpdate(predecessor));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    let answerPromise!: Promise<void>;
    act(() => {
      answerPromise = result.current.answer("media-leg-1");
    });
    await waitFor(() => expect(predecessor.answer).toHaveBeenCalledTimes(1));

    const replacement = {
      ...predecessor,
      answer: mock(async () => {}),
      id: "media-leg-2",
      options: undefined,
      recoveredCallId: "media-leg-1",
      state: "failed",
    };
    act(() => clients[0]?.emitCallUpdate(replacement));
    await act(async () => {
      await expect(answerPromise).rejects.toMatchObject({
        operatorError: { code: "CALL_NOT_CONNECTED", retryable: false },
      });
    });

    expect(replacement.answer).not.toHaveBeenCalled();
    expect(result.current.answeringMediaLegId).toBeNull();
  });

  it("does not answer an exact replacement after the canonical reservation expires", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ token: "canonical-token" }),
    ) as unknown as typeof fetch;
    let currentTime = 1_000;
    const now = () => currentTime;
    const { result } = renderHook(() =>
      useSoftphoneMedia({
        agentSessionId: "session-1",
        browserSessionId: "browser-1",
        enabled: true,
        now,
      }),
    );
    await waitFor(() => expect(result.current.connection).toBe("READY"));

    const predecessor = {
      answer: mock(async () => {}),
      direction: "incoming",
      id: "media-leg-1",
      options: {
        clientState: btoa(
          JSON.stringify({
            callId: "call-1",
            canonicalCommand: true,
            legId: "leg-1",
          }),
        ),
      },
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {},
    };
    act(() => clients[0]?.emitCallUpdate(predecessor));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    let answerPromise!: Promise<void>;
    act(() => {
      answerPromise = result.current.answer("media-leg-1", new Date(1_500).toISOString());
    });
    await waitFor(() => expect(predecessor.answer).toHaveBeenCalledTimes(1));

    currentTime = 1_500;
    const replacement = {
      ...predecessor,
      answer: mock(async () => {}),
      id: "media-leg-2",
      options: undefined,
      recoveredCallId: "media-leg-1",
    };
    act(() => clients[0]?.emitCallUpdate(replacement));
    await act(async () => {
      await expect(answerPromise).rejects.toMatchObject({
        operatorError: { code: "CALL_NOT_CONNECTED", retryable: false },
      });
    });

    expect(replacement.answer).not.toHaveBeenCalled();
    expect(result.current.answeringMediaLegId).toBeNull();
  });

  it("does not revive an Answer that failed before its exact replacement arrived", async () => {
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

    const predecessor = {
      answer: mock(async () => {
        throw new Error("answer failed");
      }),
      direction: "incoming",
      id: "media-leg-1",
      options: {
        clientState: btoa(
          JSON.stringify({
            callId: "call-1",
            canonicalCommand: true,
            legId: "leg-1",
          }),
        ),
      },
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {},
    };
    act(() => clients[0]?.emitCallUpdate(predecessor));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    await act(async () => {
      await expect(result.current.answer("media-leg-1")).rejects.toMatchObject({
        operatorError: { code: "CALL_NOT_CONNECTED", retryable: false },
      });
    });

    const replacement = {
      ...predecessor,
      answer: mock(async () => {}),
      id: "media-leg-2",
      options: undefined,
      recoveredCallId: "media-leg-1",
    };
    act(() => clients[0]?.emitCallUpdate(replacement));

    expect(replacement.answer).not.toHaveBeenCalled();
    expect(result.current.answeringMediaLegId).toBeNull();
    expect(result.current.observations).toEqual([
      expect.objectContaining({ mediaLegId: "media-leg-2" }),
    ]);
  });

  it("clears pending Answer ownership when the registered client is replaced", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ token: "canonical-token" }),
    ) as unknown as typeof fetch;

    const { rerender, result } = renderHook(
      ({ agentSessionId }: { agentSessionId: string }) =>
        useSoftphoneMedia({
          agentSessionId,
          browserSessionId: "browser-1",
          enabled: true,
        }),
      { initialProps: { agentSessionId: "session-1" } },
    );
    await waitFor(() => expect(result.current.connection).toBe("READY"));

    const first = {
      answer: mock(async () => {}),
      direction: "incoming",
      id: "media-leg-1",
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {},
    };
    act(() => clients[0]?.emitCallUpdate(first));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));
    let firstAnswer!: Promise<void>;
    act(() => {
      firstAnswer = result.current.answer("media-leg-1");
    });
    await waitFor(() => expect(result.current.answeringMediaLegId).toBe("media-leg-1"));

    rerender({ agentSessionId: "session-2" });
    await act(async () => {
      await expect(firstAnswer).rejects.toMatchObject({
        operatorError: { code: "CALL_NOT_CONNECTED" },
      });
    });
    await waitFor(() => {
      expect(clients).toHaveLength(2);
      expect(result.current.connection).toBe("READY");
      expect(result.current.answeringMediaLegId).toBeNull();
    });

    const second = {
      ...first,
      answer: mock(async () => {}),
      id: "media-leg-2",
    };
    act(() => clients[1]?.emitCallUpdate(second));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));
    let secondAnswer!: Promise<void>;
    act(() => {
      secondAnswer = result.current.answer("media-leg-2");
    });
    act(() => clients[1]?.emitCallUpdate({ ...second, state: "active" }));
    await act(async () => {
      await secondAnswer;
    });
    expect(second.answer).toHaveBeenCalledTimes(1);
  });

  it("fails closed when recoveredCallId carries conflicting canonical identity", async () => {
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

    const predecessor = {
      answer: mock(async () => {}),
      direction: "incoming",
      id: "media-leg-1",
      options: {
        clientState: btoa(
          JSON.stringify({
            callId: "call-1",
            canonicalCommand: true,
            legId: "leg-1",
          }),
        ),
      },
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {},
    };
    act(() => clients[0]?.emitCallUpdate(predecessor));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    act(() =>
      clients[0]?.emitCallUpdate({
        ...predecessor,
        answer: mock(async () => {}),
        id: "media-leg-2",
        options: {
          clientState: btoa(
            JSON.stringify({
              callId: "call-2",
              canonicalCommand: true,
              legId: "leg-2",
            }),
          ),
        },
        recoveredCallId: "media-leg-1",
      }),
    );

    expect(result.current.observations).toEqual([
      expect.objectContaining({ mediaLegId: "media-leg-1" }),
    ]);
  });

  it("uses one exact provider identity as a recovered-call fallback", async () => {
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

    const clientState = btoa(
      JSON.stringify({
        callId: "call-1",
        canonicalCommand: true,
        legId: "leg-1",
      }),
    );
    const predecessor = {
      answer: mock(async () => {}),
      direction: "incoming",
      id: "media-leg-1",
      options: { clientState },
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {
        telnyxCallControlId: "control-1",
        telnyxLegId: "provider-leg-1",
        telnyxSessionId: "provider-session-1",
      },
    };
    act(() => clients[0]?.emitCallUpdate(predecessor));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    const replacement = {
      ...predecessor,
      answer: mock(async () => {}),
      id: "media-leg-2",
      options: undefined,
    };
    act(() => clients[0]?.emitCallUpdate(replacement));

    expect(result.current.observations).toEqual([
      expect.objectContaining({
        canonicalCallId: "call-1",
        canonicalLegId: "leg-1",
        mediaLegId: "media-leg-2",
      }),
    ]);

    let answerPromise!: Promise<void>;
    act(() => {
      answerPromise = result.current.answer("media-leg-2");
    });
    await waitFor(() => expect(replacement.answer).toHaveBeenCalledTimes(1));
    act(() => clients[0]?.emitCallUpdate({ ...replacement, state: "active" }));
    await act(async () => {
      await answerPromise;
    });
    expect(predecessor.answer).not.toHaveBeenCalled();
  });

  it("does not move a pending Answer through ambiguous provider identity", async () => {
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

    const providerIdentity = {
      telnyxCallControlId: "control-1",
      telnyxLegId: "provider-leg-1",
      telnyxSessionId: "provider-session-1",
    };
    const first = {
      answer: mock(async () => {}),
      direction: "incoming",
      id: "media-leg-1",
      options: {
        clientState: btoa(
          JSON.stringify({
            callId: "call-1",
            canonicalCommand: true,
            legId: "leg-1",
          }),
        ),
      },
      remoteStream: null,
      state: "ringing",
      telnyxIDs: {},
    };
    const second = {
      ...first,
      answer: mock(async () => {}),
      id: "media-leg-2",
      options: {
        clientState: btoa(
          JSON.stringify({
            callId: "call-2",
            canonicalCommand: true,
            legId: "leg-2",
          }),
        ),
      },
    };
    act(() => {
      clients[0]?.emitCallUpdate(first);
      clients[0]?.emitCallUpdate(second);
    });
    await waitFor(() => expect(result.current.observations).toHaveLength(2));
    first.telnyxIDs = providerIdentity;
    second.telnyxIDs = providerIdentity;

    let answerPromise!: Promise<void>;
    act(() => {
      answerPromise = result.current.answer("media-leg-1");
    });
    await waitFor(() => expect(first.answer).toHaveBeenCalledTimes(1));

    const replacement = {
      ...first,
      answer: mock(async () => {}),
      id: "media-leg-3",
      options: undefined,
      telnyxIDs: providerIdentity,
    };
    act(() => clients[0]?.emitCallUpdate(replacement));

    expect(replacement.answer).not.toHaveBeenCalled();
    expect(result.current.answeringMediaLegId).toBe("media-leg-1");
    expect(result.current.observations.map(({ mediaLegId }) => mediaLegId)).toEqual([
      "media-leg-1",
      "media-leg-2",
    ]);

    act(() => clients[0]?.emitCallUpdate({ ...first, state: "active" }));
    await act(async () => {
      await answerPromise;
    });
  });

  it("holds and resumes the exact correlated media leg", async () => {
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
      direction: "incoming",
      hold: mock(async () => true),
      id: "media-leg-1",
      remoteStream: null,
      state: "active",
      telnyxIDs: {
        telnyxCallControlId: "control-1",
        telnyxLegId: "provider-leg-1",
        telnyxSessionId: "provider-session-1",
      },
      unhold: mock(async () => true),
    };
    act(() => clients[0]?.emitCallUpdate(call));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));

    await act(async () => {
      await result.current.hold("media-leg-1", true);
    });
    expect(result.current.observations[0]?.state).toBe("HELD");

    await act(async () => {
      await result.current.hold("media-leg-1", false);
    });
    expect(result.current.observations[0]?.state).toBe("ACTIVE");

    expect(call.hold).toHaveBeenCalledTimes(1);
    expect(call.unhold).toHaveBeenCalledTimes(1);

    call.hold.mockImplementation(async () => false);
    await expect(result.current.hold("media-leg-1", true)).rejects.toMatchObject({
      operatorError: { code: "PROVIDER_UNAVAILABLE", retryable: true },
    });
  });

  it("keeps the phone ready when a hold operation fails", async () => {
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

    act(() =>
      clients[0]?.emit("telnyx.error", {
        error: { fatal: false, name: "HOLD_FAILED" },
      }),
    );

    expect(result.current.connection).toBe("READY");
    expect(result.current.error).toBeNull();
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
