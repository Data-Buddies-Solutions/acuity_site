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
  return direction === "inbound";
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
  const [incomingFrom, setIncomingFrom] = useState("");
  const [dialedNumber, setDialedNumber] = useState("");
  const [draftNumber, setDraftNumber] = useState("");
  const [direction, setDirection] = useState<CallDirection>(null);
  const [isMuted, setMuted] = useState(false);
  const [isHeld, setHeld] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

  const resetCall = useCallback(() => {
    clearTimer();
    detachAudio();
    setActiveCall(null);
    setIncomingCall(null);
    setIncomingFrom("");
    setDialedNumber("");
    setDirection(null);
    setMuted(false);
    setHeld(false);
    setShowKeypad(false);
    setCallDuration(0);
    setStatus("ready");
  }, [clearTimer, detachAudio]);

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

          if (
            ["new", "trying", "requesting", "ringing", "early"].includes(call.state || "")
          ) {
            if (inbound) {
              setIncomingCall(call);
              setActiveCall(null);
              setIncomingFrom(
                call.options?.remoteCallerNumber ||
                  call.options?.callerNumber ||
                  "Unknown",
              );
              setDirection("inbound");
            } else {
              setActiveCall(call);
              setDirection("outbound");
            }
            setStatus("ringing");
            return;
          }

          if (call.state === "active") {
            attachAudio(call);
            startTimer();
            setActiveCall(call);
            setIncomingCall(null);
            setDirection((current) => current || (inbound ? "inbound" : "outbound"));
            setStatus("on-call");
            return;
          }

          if (call.state === "hangup" || call.state === "destroy") {
            resetCall();
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
      detachAudio();
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [attachAudio, clearTimer, detachAudio, enabled, resetCall, startTimer]);

  useEffect(() => {
    if (!incomingCall || activeCall) {
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
  }, [activeCall, incomingCall]);

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
      client.newCall({
        callerNumber,
        destinationNumber: to,
      });
      setDraftNumber("");
    } catch (callError) {
      setStatus("error");
      setError(callError instanceof Error ? callError.message : "Unable to start call");
    }
  }, [callerNumber, draftNumber, status]);

  const answerCall = useCallback(() => {
    incomingCall?.answer();
  }, [incomingCall]);

  const hangUp = useCallback(() => {
    if (activeCall) {
      activeCall.hangup();
      return;
    }

    if (incomingCall) {
      incomingCall.hangup();
      resetCall();
    }
  }, [activeCall, incomingCall, resetCall]);

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

  const activeNumber = direction === "inbound" ? incomingFrom : dialedNumber;
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
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center gap-2 text-emerald-800">
              <PhoneIncoming className="h-4 w-4" aria-hidden="true" />
              <p className="text-sm font-semibold">Incoming call</p>
            </div>
            <p className="mt-2 text-lg font-semibold text-[#10272c]">
              {formatPhone(incomingFrom)}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button onClick={answerCall} variant="primary">
                <Phone className="h-4 w-4" aria-hidden="true" />
                Accept
              </Button>
              <Button onClick={hangUp} variant="secondary">
                <PhoneOff className="h-4 w-4" aria-hidden="true" />
                Decline
              </Button>
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

        {!activeCall && !incomingCall ? (
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
