"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const RINGTONE_PATH = "/audio/call-center/incoming-ring.wav";
const RINGTONE_VOLUME = 0.35;

function stop(audio: HTMLAudioElement) {
  audio.pause();
  audio.currentTime = 0;
}

export function useIncomingCallRingtone(offerId: string | null) {
  const [blockedOfferId, setBlockedOfferId] = useState<string | null>(null);
  const activeOfferRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(true);
  const playAttemptRef = useRef(0);

  const play = useCallback((audio: HTMLAudioElement, activeOfferId: string) => {
    const attempt = ++playAttemptRef.current;
    try {
      void audio.play().then(
        () => {
          if (
            mountedRef.current &&
            attempt === playAttemptRef.current &&
            activeOfferRef.current === activeOfferId
          ) {
            setBlockedOfferId((current) => (current === activeOfferId ? null : current));
          }
        },
        () => {
          if (
            mountedRef.current &&
            attempt === playAttemptRef.current &&
            activeOfferRef.current === activeOfferId
          ) {
            setBlockedOfferId(activeOfferId);
          }
        },
      );
    } catch {
      queueMicrotask(() => {
        if (
          mountedRef.current &&
          attempt === playAttemptRef.current &&
          activeOfferRef.current === activeOfferId
        ) {
          setBlockedOfferId(activeOfferId);
        }
      });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const audio = new Audio(RINGTONE_PATH);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = RINGTONE_VOLUME;
    audioRef.current = audio;

    const prime = () => {
      window.removeEventListener("keydown", prime);
      window.removeEventListener("pointerdown", prime);
      if (activeOfferRef.current) return;
      audio.muted = true;
      try {
        void audio.play().then(
          () => {
            audio.muted = false;
            if (!activeOfferRef.current) stop(audio);
          },
          () => {
            audio.muted = false;
          },
        );
      } catch {
        audio.muted = false;
      }
    };

    window.addEventListener("keydown", prime);
    window.addEventListener("pointerdown", prime);

    return () => {
      mountedRef.current = false;
      playAttemptRef.current += 1;
      window.removeEventListener("keydown", prime);
      window.removeEventListener("pointerdown", prime);
      activeOfferRef.current = null;
      stop(audio);
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || activeOfferRef.current === offerId) return;

    playAttemptRef.current += 1;
    stop(audio);
    activeOfferRef.current = offerId;
    if (offerId) play(audio, offerId);
  }, [offerId, play]);

  const retry = useCallback(() => {
    const audio = audioRef.current;
    const activeOfferId = activeOfferRef.current;
    if (!audio || !activeOfferId) return;
    audio.muted = false;
    play(audio, activeOfferId);
  }, [play]);

  return { blocked: blockedOfferId === offerId && Boolean(offerId), retry };
}
