"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TelnyxRTC, type Call, type INotification } from "@telnyx/webrtc";
import {
  Delete,
  Grid3X3,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneOff,
  Play,
  X,
} from "lucide-react";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/utils";

type TelnyxStatus =
  | "initializing"
  | "ready"
  | "ringing"
  | "on-call"
  | "error"
  | "offline";

type CallDirection = "inbound" | "outbound" | null;

type TelnyxCall = Call;

type TelnyxTokenResponse =
  | {
      callerNumber?: string;
      login: string;
      password: string;
    }
  | {
      callerNumber?: string;
      token: string;
    };

const keypadRows = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
];

function normalizeToE164(input: string) {
  const digits = input.replace(/\D/g, "");

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (input.trim().startsWith("+")) return input.trim();

  return digits ? `+${digits}` : "";
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return phone || "Unknown";
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainingSeconds = (seconds % 60).toString().padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

function statusLabel(status: TelnyxStatus) {
  switch (status) {
    case "initializing":
      return "Connecting";
    case "ready":
      return "Ready";
    case "ringing":
      return "Ringing";
    case "on-call":
      return "On call";
    case "offline":
      return "Offline";
    case "error":
      return "Error";
  }
}

function isInboundDirection(direction: unknown) {
  if (typeof direction !== "string") {
    return false;
  }

  return ["inbound", "incoming"].includes(direction.toLowerCase());
}

function callerNumberFor(call: TelnyxCall) {
  return call.options?.remoteCallerNumber || call.options?.callerNumber || "Unknown";
}

function callerKeyFor(call: TelnyxCall) {
  return normalizeToE164(callerNumberFor(call)) || callerNumberFor(call);
}

function isSameCaller(a: TelnyxCall, b: TelnyxCall) {
  return callerKeyFor(a) === callerKeyFor(b);
}

function isEndedCall(call: TelnyxCall) {
  return call.state === "hangup" || call.state === "destroy";
}

export default function SoftphonePanel({
  callerNumber,
  enabled,
  seedNumber,
}: {
  callerNumber: string;
  enabled: boolean;
  seedNumber?: { value: string; token: number } | null;
}) {
  const clientRef = useRef<TelnyxRTC | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [status, setStatus] = useState<TelnyxStatus>(
    enabled ? "initializing" : "offline",
  );
  const [activeCall, setActiveCall] = useState<TelnyxCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<TelnyxCall | null>(null);
  const [queuedCalls, setQueuedCalls] = useState<TelnyxCall[]>([]);
  const [heldCalls, setHeldCalls] = useState<TelnyxCall[]>([]);
  const [dialedNumber, setDialedNumber] = useState("");
  const [draftNumber, setDraftNumber] = useState("");
  const [direction, setDirection] = useState<CallDirection>(null);
  const [isMuted, setMuted] = useState(false);
  const [isHeld, setHeld] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Refs mirror state so the Telnyx notification handler (created once) can read latest values
  const activeCallRef = useRef<TelnyxCall | null>(null);
  const incomingCallRef = useRef<TelnyxCall | null>(null);
  const queuedCallsRef = useRef<TelnyxCall[]>([]);
  const answeringInboundCallIdsRef = useRef<Set<string>>(new Set());
  const outboundCallIdsRef = useRef<Set<string>>(new Set());
  const incomingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);
  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);
  useEffect(() => {
    queuedCallsRef.current = queuedCalls;
  }, [queuedCalls]);

  useEffect(() => {
    if (!seedNumber || !seedNumber.value) {
      return;
    }
    setDraftNumber(seedNumber.value);
  }, [seedNumber]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearIncomingClearTimer = useCallback(() => {
    if (incomingClearTimerRef.current) {
      clearTimeout(incomingClearTimerRef.current);
      incomingClearTimerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    setCallDuration(0);
    timerRef.current = setInterval(() => {
      setCallDuration((current) => current + 1);
    }, 1000);
  }, [clearTimer]);

  const detachAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current.remove();
      audioRef.current = null;
    }
  }, []);

  const attachAudio = useCallback(
    (call: TelnyxCall) => {
      detachAudio();
      const stream = call.remoteStream;

      if (!stream) {
        return;
      }

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.srcObject = stream;
      document.body.appendChild(audio);
      audioRef.current = audio;
    },
    [detachAudio],
  );

  const resetActiveCallUi = useCallback(() => {
    clearTimer();
    detachAudio();
    setActiveCall(null);
    setDialedNumber("");
    setDirection(null);
    setMuted(false);
    setHeld(false);
    setShowKeypad(false);
    setCallDuration(0);
  }, [clearTimer, detachAudio]);

  const setInboundRingingCall = useCallback(
    (call: TelnyxCall) => {
      clearIncomingClearTimer();

      if (
        incomingCallRef.current?.id === call.id ||
        (incomingCallRef.current && isSameCaller(incomingCallRef.current, call))
      ) {
        setIncomingCall(call);
        setQueuedCalls((current) => current.filter((c) => !isSameCaller(c, call)));
        return;
      }

      if (!incomingCallRef.current && !activeCallRef.current) {
        const queuedSameCaller = queuedCallsRef.current.find((c) =>
          isSameCaller(c, call),
        );
        setIncomingCall(queuedSameCaller ?? call);
        setQueuedCalls((current) => current.filter((c) => !isSameCaller(c, call)));
        return;
      }

      setQueuedCalls((current) => {
        const existingIndex = current.findIndex(
          (c) => c.id === call.id || isSameCaller(c, call),
        );

        if (existingIndex === -1) {
          return [...current, call];
        }

        const next = [...current];
        next[existingIndex] = call;
        return next;
      });
    },
    [clearIncomingClearTimer],
  );

  const scheduleIncomingClear = useCallback(
    (call: TelnyxCall) => {
      clearIncomingClearTimer();
      incomingClearTimerRef.current = setTimeout(() => {
        setIncomingCall((current) => (current?.id === call.id ? null : current));
        if (!activeCallRef.current && queuedCallsRef.current.length === 0) {
          setDirection(null);
          setStatus((s) => (s === "error" ? s : "ready"));
        }
        incomingClearTimerRef.current = null;
      }, 1500);
    },
    [clearIncomingClearTimer],
  );

  const promoteToActiveCall = useCallback(
    (call: TelnyxCall, inbound: boolean) => {
      answeringInboundCallIdsRef.current.delete(call.id);
      attachAudio(call);
      startTimer();
      setActiveCall(call);
      setIncomingCall((current) => (current?.id === call.id ? null : current));
      setQueuedCalls((current) => current.filter((c) => c.id !== call.id));
      setHeldCalls((current) => current.filter((c) => c.id !== call.id));
      setHeld(false);
      setMuted(false);
      setDirection(inbound ? "inbound" : "outbound");
      setStatus("on-call");
    },
    [attachAudio, startTimer],
  );

  useEffect(() => {
    if (!enabled) {
      setStatus("offline");
      return;
    }

    let cancelled = false;

    async function connect() {
      try {
        const response = await fetch("/api/portal/call-center/telnyx-token");
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Unable to connect Telnyx");
        }

        if (cancelled) {
          return;
        }

        const auth = data as TelnyxTokenResponse;
        const client =
          "login" in auth && auth.login && auth.password
            ? new TelnyxRTC({ login: auth.login, password: auth.password })
            : new TelnyxRTC({ login_token: (auth as { token: string }).token });

        client.on("telnyx.ready", () => {
          if (!cancelled) {
            setStatus("ready");
            setError(null);
          }
        });

        client.on("telnyx.error", (event) => {
          if (!cancelled) {
            setStatus("error");
            setError(event.error?.message || "Telnyx connection failed");
          }
        });

        client.on("telnyx.socket.close", () => {
          if (!cancelled) {
            setStatus("offline");
          }
        });

        client.on("telnyx.notification", (notification: INotification) => {
          if (cancelled || notification.type !== "callUpdate") {
            return;
          }

          const call = notification.call;
          if (!call) {
            return;
          }

          const inbound = isInboundDirection(call.direction);
          const outbound = outboundCallIdsRef.current.has(call.id);
          const ringingStates = ["new", "trying", "requesting", "ringing", "early"];

          if (ringingStates.includes(call.state || "")) {
            if (outbound) {
              setActiveCall(call);
              setDirection("outbound");
              setStatus("ringing");
            } else {
              setInboundRingingCall(call);
              setStatus("ringing");
            }
            return;
          }

          if (call.state === "active") {
            if (!outbound && !answeringInboundCallIdsRef.current.has(call.id)) {
              setInboundRingingCall(call);
              setStatus("ringing");
              return;
            }

            promoteToActiveCall(call, inbound || !outbound);
            return;
          }

          if (call.state === "hangup" || call.state === "destroy") {
            answeringInboundCallIdsRef.current.delete(call.id);
            outboundCallIdsRef.current.delete(call.id);
            let remainingQueuedCalls = queuedCallsRef.current.filter(
              (c) => c.id !== call.id,
            );
            let remainingIncomingCall = incomingCallRef.current;

            if (incomingCallRef.current?.id === call.id) {
              const replacement = remainingQueuedCalls.find((c) => isSameCaller(c, call));

              if (replacement) {
                remainingIncomingCall = replacement;
                remainingQueuedCalls = remainingQueuedCalls.filter(
                  (c) => c.id !== replacement.id,
                );
              } else {
                scheduleIncomingClear(call);
              }
            }

            setIncomingCall(remainingIncomingCall);
            setQueuedCalls(remainingQueuedCalls);
            setHeldCalls((current) => current.filter((c) => c.id !== call.id));

            if (activeCallRef.current?.id === call.id) {
              resetActiveCallUi();
              // After clearing active, settle status based on what's left
              setStatus((s) =>
                remainingIncomingCall || remainingQueuedCalls.length > 0
                  ? "ringing"
                  : s === "error"
                    ? s
                    : "ready",
              );
              return;
            }

            if (
              !activeCallRef.current &&
              !remainingIncomingCall &&
              remainingQueuedCalls.length === 0
            ) {
              setDirection(null);
              setStatus((s) => (s === "error" ? s : "ready"));
            }
          }
        });

        client.connect();
        clientRef.current = client;
      } catch (connectError) {
        if (!cancelled) {
          setStatus("error");
          setError(
            connectError instanceof Error
              ? connectError.message
              : "Telnyx connection failed",
          );
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      clearTimer();
      clearIncomingClearTimer();
      detachAudio();
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [
    clearTimer,
    clearIncomingClearTimer,
    detachAudio,
    enabled,
    promoteToActiveCall,
    resetActiveCallUi,
    scheduleIncomingClear,
    setInboundRingingCall,
  ]);

  // Ringtone for queued incoming calls when nothing else is active.
  useEffect(() => {
    if ((!incomingCall && queuedCalls.length === 0) || activeCall) {
      return;
    }

    const AudioCtxCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtxCtor) {
      return;
    }

    const ctx = new AudioCtxCtor();
    let cancelled = false;
    let scheduleHandle: ReturnType<typeof setTimeout> | null = null;

    const playRingCycle = () => {
      if (cancelled) return;
      const now = ctx.currentTime;
      const ringDuration = 2;
      const silenceDuration = 4;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.frequency.value = 440;
      osc2.frequency.value = 480;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
      gain.gain.setValueAtTime(0.12, now + ringDuration - 0.05);
      gain.gain.linearRampToValueAtTime(0, now + ringDuration);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + ringDuration);
      osc2.stop(now + ringDuration);

      scheduleHandle = setTimeout(playRingCycle, (ringDuration + silenceDuration) * 1000);
    };

    if (ctx.state === "suspended") {
      ctx
        .resume()
        .then(playRingCycle)
        .catch(() => {});
    } else {
      playRingCycle();
    }

    return () => {
      cancelled = true;
      if (scheduleHandle) clearTimeout(scheduleHandle);
      ctx.close().catch(() => {});
    };
  }, [activeCall, incomingCall, queuedCalls.length]);

  // Subtle "call waiting" beep when a queued call is added during an active call
  useEffect(() => {
    if (queuedCalls.length === 0 || !activeCall) return;

    const AudioCtxCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtxCtor) return;

    const ctx = new AudioCtxCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.02);
    gain.gain.setValueAtTime(0.06, now + 0.18);
    gain.gain.linearRampToValueAtTime(0, now + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);

    const closeHandle = setTimeout(() => {
      ctx.close().catch(() => {});
    }, 400);
    return () => clearTimeout(closeHandle);
  }, [queuedCalls.length, activeCall]);

  const makeCall = useCallback(() => {
    const to = normalizeToE164(draftNumber);
    const client = clientRef.current;

    if (!client || !to || status !== "ready") {
      return;
    }

    setDialedNumber(to);
    setDirection("outbound");
    setError(null);

    try {
      const call = client.newCall({
        callerNumber,
        destinationNumber: to,
      });
      outboundCallIdsRef.current.add(call.id);
      setDraftNumber("");
    } catch (callError) {
      setStatus("error");
      setError(callError instanceof Error ? callError.message : "Unable to start call");
    }
  }, [callerNumber, draftNumber, status]);

  const answerCall = useCallback(
    (callId: string) => {
      const queued =
        incomingCall?.id === callId
          ? incomingCall
          : queuedCalls.find((c) => c.id === callId);
      if (!queued) return;
      if (answeringInboundCallIdsRef.current.has(callId)) return;

      // Put current active on hold (if any), move it to held list
      if (activeCall) {
        try {
          activeCall.hold();
        } catch {
          // ignore — Telnyx will reject if not in a holdable state
        }
        setHeldCalls((current) =>
          current.some((c) => c.id === activeCall.id)
            ? current
            : [...current, activeCall],
        );
      }
      // The queued call answering will trigger an "active" notification, which
      // promotes it to activeCall and removes it from queuedCalls.
      answeringInboundCallIdsRef.current.add(callId);
      try {
        if (queued.state !== "active") {
          queued.answer();
        }
      } catch {
        answeringInboundCallIdsRef.current.delete(callId);
        return;
      }

      if (queued.state === "active") {
        promoteToActiveCall(queued, true);
      }
    },
    [activeCall, incomingCall, promoteToActiveCall, queuedCalls],
  );

  const declineCall = useCallback(
    (callId: string) => {
      const queued =
        incomingCall?.id === callId
          ? incomingCall
          : queuedCalls.find((c) => c.id === callId);
      if (!queued) return;
      try {
        queued.hangup();
      } catch {
        // ignore
      }
      answeringInboundCallIdsRef.current.delete(callId);
      const remainingIncomingCall = incomingCall?.id === callId ? null : incomingCall;
      const remainingQueuedCalls = queuedCalls.filter((c) => c.id !== callId);
      setIncomingCall(remainingIncomingCall);
      setQueuedCalls(remainingQueuedCalls);
      if (!activeCall && !remainingIncomingCall && remainingQueuedCalls.length === 0) {
        setDirection(null);
        setStatus((s) => (s === "error" ? s : "ready"));
      }
    },
    [activeCall, incomingCall, queuedCalls],
  );

  const resumeHeld = useCallback(
    (callId: string) => {
      const held = heldCalls.find((c) => c.id === callId);
      if (!held) return;

      // Hold current active if any, then unhold the selected
      if (activeCall && activeCall.id !== callId) {
        try {
          activeCall.hold();
        } catch {
          // ignore
        }
        setHeldCalls((current) =>
          current.some((c) => c.id === activeCall.id)
            ? current
            : [...current, activeCall],
        );
      }
      try {
        held.unhold();
      } catch {
        // ignore
      }
    },
    [activeCall, heldCalls],
  );

  const endHeld = useCallback(
    (callId: string) => {
      const held = heldCalls.find((c) => c.id === callId);
      if (!held) return;
      try {
        held.hangup();
      } catch {
        // ignore
      }
      setHeldCalls((current) => current.filter((c) => c.id !== callId));
    },
    [heldCalls],
  );

  const hangUp = useCallback(() => {
    if (activeCall) {
      activeCall.hangup();
    }
  }, [activeCall]);

  const toggleMute = useCallback(() => {
    if (!activeCall) return;
    if (isMuted) activeCall.unmuteAudio();
    else activeCall.muteAudio();
    setMuted((current) => !current);
  }, [activeCall, isMuted]);

  const toggleHold = useCallback(() => {
    if (!activeCall) return;
    if (isHeld) activeCall.unhold();
    else activeCall.hold();
    setHeld((current) => !current);
  }, [activeCall, isHeld]);

  const sendDigit = useCallback(
    (digit: string) => {
      activeCall?.dtmf(digit);
    },
    [activeCall],
  );

  const activeNumber =
    activeCall && direction === "inbound"
      ? callerNumberFor(activeCall)
      : dialedNumber || (activeCall ? callerNumberFor(activeCall) : "");
  const canDial = status === "ready" && Boolean(normalizeToE164(draftNumber));

  return (
    <section className="rounded-lg border border-black/8 bg-white shadow-[0_14px_40px_rgba(16,39,44,0.04)]">
      <div className="flex flex-col gap-3 border-b border-black/8 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6f8083]">
            Softphone
          </p>
          <p className="mt-1 text-sm font-medium text-[#10272c]">
            {formatPhone(callerNumber)}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold",
            status === "ready" && "border-emerald-200 bg-emerald-50 text-emerald-700",
            status === "on-call" && "border-blue-200 bg-blue-50 text-blue-700",
            status === "ringing" && "border-amber-200 bg-amber-50 text-amber-700",
            (status === "error" || status === "offline") &&
              "border-red-200 bg-red-50 text-red-700",
            status === "initializing" && "border-slate-200 bg-slate-50 text-slate-700",
          )}
        >
          {statusLabel(status)}
        </span>
      </div>

      <div className="space-y-4 p-4">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {incomingCall && !activeCall ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <div className="flex items-center gap-2 text-amber-800">
              <PhoneIncoming className="h-4 w-4" aria-hidden="true" />
              <p className="text-xs font-semibold uppercase tracking-[0.14em]">
                Incoming call
              </p>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-amber-100 bg-white px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#10272c]">
                  {formatPhone(callerNumberFor(incomingCall))}
                </p>
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#8a999b]">
                  Ringing
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  aria-label="Answer incoming call"
                  className="h-8 px-2"
                  disabled={
                    answeringInboundCallIdsRef.current.has(incomingCall.id) ||
                    isEndedCall(incomingCall)
                  }
                  onClick={() => answerCall(incomingCall.id)}
                  size="sm"
                  variant="primary"
                >
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  Answer
                </Button>
                <Button
                  aria-label="Decline incoming call"
                  className="h-8 w-8 p-0 text-[#617477] hover:text-red-600"
                  onClick={() => declineCall(incomingCall.id)}
                  size="sm"
                  variant="ghost"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {activeCall ? (
          <div className="rounded-lg border border-black/8 bg-[#f7fbfa] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#10272c]">
                  {formatPhone(activeNumber)}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[#6f8083]">
                  {direction === "inbound" ? "Inbound" : "Outbound"}
                </p>
              </div>
              <p className="font-mono text-lg font-semibold tabular-nums text-[#10272c]">
                {formatDuration(callDuration)}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button onClick={toggleMute} variant={isMuted ? "default" : "secondary"}>
                {isMuted ? (
                  <MicOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Mic className="h-4 w-4" aria-hidden="true" />
                )}
                {isMuted ? "Unmute" : "Mute"}
              </Button>
              <Button onClick={toggleHold} variant={isHeld ? "default" : "secondary"}>
                {isHeld ? (
                  <Play className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Pause className="h-4 w-4" aria-hidden="true" />
                )}
                {isHeld ? "Resume" : "Hold"}
              </Button>
              <Button
                onClick={() => setShowKeypad((current) => !current)}
                variant={showKeypad ? "default" : "secondary"}
              >
                <Grid3X3 className="h-4 w-4" aria-hidden="true" />
                Keypad
              </Button>
              <Button onClick={hangUp} variant="secondary">
                <PhoneOff className="h-4 w-4" aria-hidden="true" />
                End
              </Button>
            </div>

            {showKeypad ? (
              <div className="mt-4 grid max-w-60 grid-cols-3 gap-2">
                {keypadRows.flat().map((digit) => (
                  <Button
                    key={digit}
                    onClick={() => sendDigit(digit)}
                    variant="secondary"
                  >
                    {digit}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {queuedCalls.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <div className="flex items-center gap-2 text-amber-800">
              <PhoneIncoming className="h-4 w-4" aria-hidden="true" />
              <p className="text-xs font-semibold uppercase tracking-[0.14em]">
                In queue · {queuedCalls.length}
              </p>
            </div>
            <ul className="mt-2 space-y-2">
              {queuedCalls.map((call) => (
                <li
                  key={call.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-amber-100 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#10272c]">
                      {formatPhone(callerNumberFor(call))}
                    </p>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-[#8a999b]">
                      Ringing
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      aria-label="Answer queued call"
                      className="h-8 px-2"
                      disabled={
                        answeringInboundCallIdsRef.current.has(call.id) ||
                        isEndedCall(call)
                      }
                      onClick={() => answerCall(call.id)}
                      size="sm"
                      variant="primary"
                    >
                      <Phone className="h-4 w-4" aria-hidden="true" />
                      Answer
                    </Button>
                    <Button
                      aria-label="Decline queued call"
                      className="h-8 w-8 p-0 text-[#617477] hover:text-red-600"
                      onClick={() => declineCall(call.id)}
                      size="sm"
                      variant="ghost"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {heldCalls.length > 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6f8083]">
              On hold · {heldCalls.length}
            </p>
            <ul className="mt-2 space-y-2">
              {heldCalls.map((call) => (
                <li
                  key={call.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#10272c]">
                      {formatPhone(callerNumberFor(call))}
                    </p>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-[#8a999b]">
                      Holding
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      aria-label="Resume held call"
                      className="h-8 px-2"
                      onClick={() => resumeHeld(call.id)}
                      size="sm"
                      variant="secondary"
                    >
                      <Play className="h-4 w-4" aria-hidden="true" />
                      Resume
                    </Button>
                    <Button
                      aria-label="End held call"
                      className="h-8 w-8 p-0 text-[#617477] hover:text-red-600"
                      onClick={() => endHeld(call.id)}
                      size="sm"
                      variant="ghost"
                    >
                      <PhoneOff className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!activeCall && !incomingCall && queuedCalls.length === 0 ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                aria-label="Phone number"
                className="h-10 min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-3 text-sm font-medium text-[#10272c] outline-none focus:border-[#0d7377]"
                inputMode="tel"
                onChange={(event) => setDraftNumber(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canDial) {
                    makeCall();
                  }
                }}
                placeholder="Phone number"
                type="tel"
                value={draftNumber}
              />
              <Button
                aria-label="Clear number"
                disabled={!draftNumber}
                onClick={() => setDraftNumber("")}
                variant="secondary"
              >
                <Delete className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button disabled={!canDial} onClick={makeCall} variant="primary">
                <Phone className="h-4 w-4" aria-hidden="true" />
                Call
              </Button>
            </div>
            <div className="grid max-w-60 grid-cols-3 gap-2">
              {keypadRows.flat().map((digit) => (
                <Button
                  key={digit}
                  onClick={() => setDraftNumber((current) => current + digit)}
                  variant="secondary"
                >
                  {digit}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
