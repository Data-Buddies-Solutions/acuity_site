import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import { useIncomingCallRingtone } from "./use-incoming-call-ringtone";

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

  it("uses one looping audio instance without restarting for the same offer", async () => {
    const { rerender } = renderHook(({ offerId }) => useIncomingCallRingtone(offerId), {
      initialProps: { offerId: null as string | null },
    });
    const audio = FakeAudio.instances[0]!;

    expect(audio.src).toBe("/audio/call-center/incoming-ring.wav");
    expect(audio.loop).toBe(true);
    expect(audio.volume).toBe(0.35);

    rerender({ offerId: "leg-1" });
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));
    rerender({ offerId: "leg-1" });
    expect(FakeAudio.instances).toHaveLength(1);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("stops immediately when the active offer clears", async () => {
    const { rerender } = renderHook(({ offerId }) => useIncomingCallRingtone(offerId), {
      initialProps: { offerId: "leg-1" as string | null },
    });
    const audio = FakeAudio.instances[0]!;
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));

    audio.currentTime = 1.4;
    rerender({ offerId: null });
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.currentTime).toBe(0);
  });

  it("recovers from autoplay rejection through an operator action", async () => {
    const { result, rerender } = renderHook(
      ({ offerId }) => useIncomingCallRingtone(offerId),
      { initialProps: { offerId: null as string | null } },
    );
    const audio = FakeAudio.instances[0]!;
    audio.play.mockImplementationOnce(() => Promise.reject(new Error("NotAllowedError")));

    rerender({ offerId: "leg-1" });
    await waitFor(() => expect(result.current.blocked).toBe(true));

    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.blocked).toBe(false));
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("stops and releases the audio asset on unmount", () => {
    const { unmount } = renderHook(() => useIncomingCallRingtone("leg-1"));
    const audio = FakeAudio.instances[0]!;
    audio.currentTime = 1;

    unmount();
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.currentTime).toBe(0);
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.load).toHaveBeenCalled();
  });
});
