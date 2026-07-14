import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import {
  applyProjectionEvent,
  CALL_CENTER_SCHEMA_VERSION,
  createRealtimeState,
  type AgentSessionView,
  type CallView,
  type OperationView,
} from "@/lib/call-center/realtime-contract";

import {
  selectIncomingRingtoneOffer,
  useIncomingCallRingtone,
} from "./use-incoming-call-ringtone";

const call: CallView = {
  answeredAt: null,
  callerName: "Patient",
  direction: "INBOUND",
  endedAt: null,
  fromPhone: "+13055550100",
  id: "call-1",
  legs: [],
  queueId: "queue-1",
  receivedAt: "2026-07-14T12:00:00.000Z",
  stateVersion: 1,
  status: "RINGING",
  toPhone: "+17865550100",
  winningLegId: null,
};

const session: AgentSessionView = {
  audioReady: true,
  clientInstanceId: "browser-1",
  connectionState: "READY",
  currentCallId: null,
  endpointId: "endpoint-1",
  id: "session-1",
  leaseExpiresAt: "2026-07-14T12:01:00.000Z",
  microphoneReady: true,
  offeredCallId: call.id,
  presence: "AVAILABLE",
  stateVersion: 1,
};

const transferOperation: OperationView = {
  callId: call.id,
  errorCode: null,
  operationEventRevision: "12",
  providerCommandId: "command-1",
  status: "SENT",
  targetAgentSessionId: session.id,
  targetEndpointId: session.endpointId,
  targetLegId: "leg-1",
  targetUserId: "user-1",
  type: "TRANSFER",
};

function select({
  calls = [call],
  connection = "CONNECTED" as const,
  operations = null,
  queueId = "queue-1",
  selectedSession = session,
}: {
  calls?: CallView[];
  connection?: "CONNECTED" | "RECONNECTING";
  operations?: OperationView[] | null;
  queueId?: string;
  selectedSession?: AgentSessionView | null;
} = {}) {
  return selectIncomingRingtoneOffer({
    calls,
    connection,
    operations,
    queueId,
    session: selectedSession,
  });
}

describe("selectIncomingRingtoneOffer", () => {
  it("selects only this ready operator's canonical inbound offer", () => {
    expect(select()).toBe(call.id);
    expect(select({ selectedSession: { ...session, offeredCallId: null } })).toBeNull();
    expect(select({ selectedSession: null })).toBeNull();
    expect(select({ calls: [] })).toBeNull();
    expect(select({ calls: [{ ...call, direction: "OUTBOUND" }] })).toBeNull();
    expect(select({ calls: [{ ...call, queueId: "queue-2" }] })).toBeNull();
    expect(select({ queueId: "queue-2" })).toBeNull();
  });

  it("stops when the operator is occupied or no longer ready or connected", () => {
    expect(
      select({ selectedSession: { ...session, currentCallId: call.id } }),
    ).toBeNull();
    expect(select({ selectedSession: { ...session, presence: "PAUSED" } })).toBeNull();
    expect(
      select({ selectedSession: { ...session, connectionState: "CONNECTING" } }),
    ).toBeNull();
    expect(
      select({ selectedSession: { ...session, microphoneReady: false } }),
    ).toBeNull();
    expect(select({ selectedSession: { ...session, audioReady: false } })).toBeNull();
    expect(select({ connection: "RECONNECTING" })).toBeNull();
  });

  it.each(["ABANDONED", "COMPLETED", "FAILED", "VOICEMAIL", "WRAP_UP"] as const)(
    "does not ring for a %s call",
    (status) => {
      expect(select({ calls: [{ ...call, status }] })).toBeNull();
    },
  );

  it("keeps a transferred inbound offer actionable while the source leg is connected", () => {
    expect(
      select({
        calls: [{ ...call, status: "CONNECTED" }],
        operations: [transferOperation],
      }),
    ).toBe(call.id);
  });

  it("stops on a connected winner that is not this operator's transfer offer", () => {
    expect(select({ calls: [{ ...call, status: "CONNECTED" }] })).toBeNull();
    expect(
      select({
        calls: [{ ...call, status: "CONNECTED" }],
        operations: [{ ...transferOperation, targetAgentSessionId: "session-2" }],
      }),
    ).toBeNull();
  });

  it("does not restore a cleared offer from a stale realtime event", () => {
    const clearedSession = { ...session, offeredCallId: null, stateVersion: 2 };
    const state = createRealtimeState({
      agentProfile: null,
      agentSession: clearedSession,
      availableQueues: [{ id: "queue-1", name: "Optical" }],
      calls: [call],
      counts: { active: 0, openTasks: 0, recent: 0, waiting: 1 },
      operations: null,
      queue: {
        id: "queue-1",
        maxWaitSec: 30,
        name: "Optical",
        ringTimeoutSec: 20,
        routingMode: "ACTIVE",
      },
      revision: "20",
      schemaVersion: CALL_CENTER_SCHEMA_VERSION,
      tasks: [],
      transferTargets: [],
    });
    const next = applyProjectionEvent(state, {
      aggregateId: session.id,
      aggregateType: "AGENT_SESSION",
      delta: { kind: "AGENT_SESSION_UPSERT", session },
      revision: "21",
      schemaVersion: CALL_CENTER_SCHEMA_VERSION,
      stateVersion: session.stateVersion,
    });

    expect(next.agentSession?.offeredCallId).toBeNull();
    expect(
      selectIncomingRingtoneOffer({
        calls: next.calls,
        connection: next.connection,
        operations: next.operations,
        queueId: next.queue.id,
        session: next.agentSession,
      }),
    ).toBeNull();
  });
});

class FakeAudio {
  static instances: FakeAudio[] = [];

  currentTime = 0;
  load = mock(() => {});
  loop = false;
  muted = false;
  pause = mock(() => {});
  play = mock<() => Promise<void>>(() => Promise.resolve());
  preload = "";
  removeAttribute = mock(() => {});
  volume = 1;

  constructor(readonly src: string) {
    FakeAudio.instances.push(this);
  }
}

const originalAudio = globalThis.Audio;

describe("useIncomingCallRingtone", () => {
  beforeEach(() => {
    FakeAudio.instances.length = 0;
    globalThis.Audio = FakeAudio as unknown as typeof Audio;
  });

  afterEach(() => {
    cleanup();
    globalThis.Audio = originalAudio;
  });

  it("loops one audio instance once per offer across repeated renders", async () => {
    const { rerender } = renderHook(({ offerId }) => useIncomingCallRingtone(offerId), {
      initialProps: { offerId: null as string | null },
    });
    const audio = FakeAudio.instances[0]!;

    expect(audio.src).toBe("/audio/call-center/incoming-ring.wav");
    expect(audio.loop).toBe(true);
    expect(audio.volume).toBe(0.35);

    rerender({ offerId: "call-1" });
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));
    rerender({ offerId: "call-1" });
    rerender({ offerId: "call-1" });
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("primes quietly on the first operator interaction", async () => {
    renderHook(() => useIncomingCallRingtone(null));
    const audio = FakeAudio.instances[0]!;

    act(() => window.dispatchEvent(new Event("pointerdown")));
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));
    expect(audio.muted).toBe(false);
    expect(audio.pause).toHaveBeenCalledTimes(1);

    act(() => window.dispatchEvent(new Event("pointerdown")));
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("does not let delayed priming stop a newly active offer", async () => {
    let finishPrime!: () => void;
    const { rerender } = renderHook(({ offerId }) => useIncomingCallRingtone(offerId), {
      initialProps: { offerId: null as string | null },
    });
    const audio = FakeAudio.instances[0]!;
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPrime = resolve;
        }),
    );

    act(() => window.dispatchEvent(new Event("keydown")));
    rerender({ offerId: "call-1" });
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2));
    const pausesBeforePrimeFinished = audio.pause.mock.calls.length;

    await act(async () => finishPrime());
    expect(audio.muted).toBe(false);
    expect(audio.pause).toHaveBeenCalledTimes(pausesBeforePrimeFinished);
  });

  it("stops immediately and can ring for the next fully cleared offer", async () => {
    const { rerender } = renderHook(({ offerId }) => useIncomingCallRingtone(offerId), {
      initialProps: { offerId: "call-1" as string | null },
    });
    const audio = FakeAudio.instances[0]!;
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));

    audio.currentTime = 1.4;
    rerender({ offerId: null });
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.currentTime).toBe(0);

    rerender({ offerId: "call-2" });
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2));
  });

  it("fails quietly when autoplay is blocked and retries from the recovery action", async () => {
    const { result, rerender } = renderHook(
      ({ offerId }) => useIncomingCallRingtone(offerId),
      { initialProps: { offerId: null as string | null } },
    );
    const audio = FakeAudio.instances[0]!;
    audio.play.mockImplementationOnce(() => Promise.reject(new Error("NotAllowedError")));

    rerender({ offerId: "call-1" });
    await waitFor(() => expect(result.current.blocked).toBe(true));

    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.blocked).toBe(false));
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale playback rejection after the offer clears", async () => {
    let rejectPlayback!: () => void;
    const { result, rerender } = renderHook(
      ({ offerId }) => useIncomingCallRingtone(offerId),
      { initialProps: { offerId: null as string | null } },
    );
    const audio = FakeAudio.instances[0]!;
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPlayback = () => reject(new Error("NotAllowedError"));
        }),
    );

    rerender({ offerId: "call-1" });
    rerender({ offerId: null });
    await act(async () => rejectPlayback());
    expect(result.current.blocked).toBe(false);
  });

  it("stops and releases the audio asset on unmount", () => {
    const { unmount } = renderHook(() => useIncomingCallRingtone("call-1"));
    const audio = FakeAudio.instances[0]!;
    audio.currentTime = 1;

    unmount();
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.currentTime).toBe(0);
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.load).toHaveBeenCalled();
  });
});
