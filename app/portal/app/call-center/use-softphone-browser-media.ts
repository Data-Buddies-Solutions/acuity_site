"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Call } from "@telnyx/webrtc";

type Debug = (event: string, details?: Record<string, unknown>) => void;

function playRemoteStream(audio: HTMLAudioElement, stream: MediaStream) {
  audio.autoplay = true;
  audio.setAttribute("playsinline", "true");
  audio.srcObject = stream;
  void audio.play().catch(() => {});
}

export function useSoftphoneBrowserMedia({
  autoPrepare,
  debug,
}: {
  autoPrepare: boolean;
  debug: Debug;
}) {
  const attachedMediaLegRef = useRef<string | null>(null);
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const autoPrepareAttemptedRef = useRef(false);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [soundReady, setSoundReady] = useState(false);

  const detachAudio = useCallback(
    (mediaLegId?: string) => {
      if (
        mediaLegId &&
        attachedMediaLegRef.current &&
        attachedMediaLegRef.current !== mediaLegId
      ) {
        return;
      }
      if (fallbackAudioRef.current) {
        fallbackAudioRef.current.srcObject = null;
        fallbackAudioRef.current.remove();
        fallbackAudioRef.current = null;
      }
      if (remoteAudioElementRef.current) {
        remoteAudioElementRef.current.srcObject = null;
      }
      attachedMediaLegRef.current = null;
      debug("audio-detached");
    },
    [debug],
  );

  const attachAudio = useCallback(
    (call: Call) => {
      const stream = call.remoteStream;
      if (!stream) {
        debug("audio-attach-skipped", { mediaLegId: call.id });
        return;
      }

      const currentAudio = remoteAudioElementRef.current ?? fallbackAudioRef.current;
      if (attachedMediaLegRef.current === call.id && currentAudio?.srcObject === stream) {
        return;
      }

      detachAudio();
      const audio = remoteAudioElementRef.current ?? document.createElement("audio");
      playRemoteStream(audio, stream);
      if (!remoteAudioElementRef.current) {
        document.body.appendChild(audio);
        fallbackAudioRef.current = audio;
      }
      attachedMediaLegRef.current = call.id;
      debug("audio-attached", { mediaLegId: call.id });
    },
    [debug, detachAudio],
  );

  const prepare = useCallback(async () => {
    const AudioCtxCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    const soundPromise = (async () => {
      if (soundReady) return true;
      if (!AudioCtxCtor) return false;

      const ctx = new AudioCtxCtor();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.03, now + 0.01);
      gain.gain.linearRampToValueAtTime(0, now + 0.06);
      oscillator.frequency.value = 880;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.07);

      try {
        await ctx.resume();
        setSoundReady(true);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => void ctx.close().catch(() => {}), 120);
      }
    })();

    const microphonePromise = (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMicrophoneReady(false);
        return false;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        stream.getTracks().forEach((track) => track.stop());
        setMicrophoneReady(true);
        return true;
      } catch (permissionError) {
        setMicrophoneReady(false);
        debug("microphone-permission-failed", {
          causeName: permissionError instanceof Error ? permissionError.name : "unknown",
        });
        return false;
      }
    })();

    const [audioReady, microphoneAllowed] = await Promise.all([
      soundPromise,
      microphonePromise,
    ]);
    return audioReady && microphoneAllowed;
  }, [debug, soundReady]);

  useEffect(() => {
    if (!autoPrepare) {
      autoPrepareAttemptedRef.current = false;
      return;
    }
    if (autoPrepareAttemptedRef.current) return;

    autoPrepareAttemptedRef.current = true;
    void prepare();
  }, [autoPrepare, prepare]);

  useEffect(() => {
    if (!navigator.permissions?.query) return;

    let cancelled = false;
    let permission: PermissionStatus | null = null;
    const syncPermission = () => {
      if (permission?.state !== "granted") setMicrophoneReady(false);
    };

    void navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((status) => {
        if (cancelled) return;
        permission = status;
        syncPermission();
        permission.addEventListener("change", syncPermission);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      permission?.removeEventListener("change", syncPermission);
    };
  }, []);

  const setRemoteAudioElement = useCallback((element: HTMLAudioElement | null) => {
    remoteAudioElementRef.current = element;
  }, []);

  const remoteAudioElement = useCallback(() => remoteAudioElementRef.current, []);

  return {
    attachAudio,
    detachAudio,
    microphoneReady,
    prepare,
    remoteAudioElement,
    setRemoteAudioElement,
    soundReady,
  };
}
