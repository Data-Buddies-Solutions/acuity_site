"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Delete,
  Grid3X3,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneForwarded,
  PhoneOff,
  Play,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PortalCallCenterSeat } from "@/lib/call-center";
import { cn } from "@/lib/utils";

import { saveCallCenterNoteAction } from "./actions";
import {
  callCenterResponse,
  localCallCenterError,
  operatorErrorCopy,
  type CallCenterAction,
} from "./call-center-errors";
import { sanitizeCallCenterDebugDetails } from "./call-center-debug";
import {
  hasLocalProviderCallLeg,
  resolveSoftphoneReadiness,
  type SoftphoneReadiness,
} from "./call-center-readiness";
import { useLegacySoftphoneMedia, type LegacySoftphoneCall } from "./use-softphone";

type TelnyxStatus =
  "initializing" | "ready" | "ringing" | "on-call" | "error" | "offline";

type CallDirection = "inbound" | "outbound" | null;

type CompletedCallWrapUp = {
  direction: "inbound" | "outbound";
  phone: string;
  stationLabel: string | null;
  stationSeatId: string | null;
  token: number;
};

type TelnyxCall = LegacySoftphoneCall;

const CALL_CENTER_DEBUG = process.env.NEXT_PUBLIC_CALL_CENTER_DEBUG === "true";
const AGENT_RING_UI_TIMEOUT_MS = 30_500;
const DEBUG_START_MS =
  typeof performance === "undefined" ? Date.now() : performance.now();

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

function isOutboundDirection(direction: unknown) {
  if (typeof direction !== "string") {
    return false;
  }

  return ["outbound", "outgoing"].includes(direction.toLowerCase());
}

function callerNumberFor(call: TelnyxCall) {
  const clientState = decodeCallClientState(call);
  const callerNumber =
    typeof clientState?.callerNumber === "string" ? clientState.callerNumber : "";

  return (
    callerNumber ||
    call.options?.remoteCallerNumber ||
    call.options?.callerNumber ||
    "Unknown"
  );
}

function callerKeyFor(call: TelnyxCall) {
  return normalizeToE164(callerNumberFor(call)) || callerNumberFor(call);
}

function postCallPhoneFor(call: TelnyxCall, inbound: boolean, outboundNumber: string) {
  const rawPhone = inbound
    ? callerNumberFor(call)
    : outboundNumber || callerNumberFor(call);
  const normalized = normalizeToE164(rawPhone);

  if (normalized) {
    return normalized;
  }

  const trimmed = rawPhone.trim();

  return trimmed && !/^(unknown|anonymous)/i.test(trimmed) ? trimmed : "";
}

function decodeCallClientState(call: TelnyxCall) {
  const raw = call.options?.clientState;

  if (!raw) {
    return null;
  }

  try {
    const decoded =
      typeof window === "undefined"
        ? Buffer.from(raw, "base64").toString("utf8")
        : new TextDecoder().decode(
            Uint8Array.from(window.atob(raw), (char) => char.charCodeAt(0)),
          );
    const parsed = JSON.parse(decoded);

    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function encodeCallClientState(value: Record<string, unknown>) {
  const serialized = JSON.stringify(value);

  if (typeof window === "undefined") {
    return Buffer.from(serialized, "utf8").toString("base64");
  }

  const bytes = new TextEncoder().encode(serialized);
  return window.btoa(String.fromCharCode(...bytes));
}

function ringKeyFor(call: TelnyxCall) {
  const clientState = decodeCallClientState(call);
  const ringAttemptId =
    typeof clientState?.ringAttemptId === "string" ? clientState.ringAttemptId : "";
  const queueItemId =
    typeof clientState?.queueItemId === "string" ? clientState.queueItemId : "";

  return ringAttemptId || queueItemId || callerKeyFor(call) || call.id;
}

function clientStateQueueItemId(call: TelnyxCall) {
  const clientState = decodeCallClientState(call);

  return typeof clientState?.queueItemId === "string" ? clientState.queueItemId : "";
}

function isSameCaller(a: TelnyxCall, b: TelnyxCall) {
  return callerKeyFor(a) === callerKeyFor(b);
}

function isEndedCall(call: TelnyxCall) {
  return call.state === "hangup" || call.state === "destroy";
}

function isAnswerableInboundCall(call: TelnyxCall) {
  return ["new", "trying", "requesting", "ringing", "early"].includes(call.state || "");
}

function errorMessageFor(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown call error";
  }
}

function operatorMessage(error: unknown, action: CallCenterAction) {
  return operatorErrorCopy(error, action).message;
}

function isStaleTelnyxCallError(error: unknown) {
  const message = errorMessageFor(error);

  return /CALL DOES NOT EXIST|Failed to hang up cleanly|BYE_SEND_FAILED|does not exist/i.test(
    message,
  );
}

function callDebugSnapshot(call: TelnyxCall | null | undefined) {
  if (!call) {
    return null;
  }

  return {
    callerNumber: call.options?.callerNumber ?? null,
    direction: call.direction ?? null,
    hasRemoteStream: call.remoteAudioReady,
    id: call.id,
    remoteCallerNumber: call.options?.remoteCallerNumber ?? null,
    state: call.state ?? null,
    telnyxCallControlId: call.providerCallControlId,
    telnyxLegId: call.providerCallLegId,
    telnyxSessionId: call.providerCallSessionId,
  };
}

export type SoftphoneHandle = {
  clearAnswerPending: (ringKey: string) => void;
  markAnswerPending: (ringKey: string) => boolean;
};

const SoftphonePanel = forwardRef<
  SoftphoneHandle,
  {
    callerNumber: string;
    browserSessionId: string;
    enabled: boolean;
    inboundEnabled: boolean;
    onActivityChange?: (active: boolean) => void;
    onBusyChange?: (busy: boolean) => void;
    onReadinessChange?: (readiness: SoftphoneReadiness) => void;
    onRingingCallerKeysChange?: (callerKeys: readonly string[]) => void;
    office?: string | null;
    seedNumber?: { value: string; token: number } | null;
    stationLabel?: string | null;
    stationRequired?: boolean;
    stationSeatId?: string | null;
    transferTargets?: PortalCallCenterSeat[];
    voicemailTimeoutSec?: number;
  }
>(function SoftphonePanel(
  {
    callerNumber,
    browserSessionId,
    enabled,
    inboundEnabled,
    onActivityChange,
    onBusyChange,
    onReadinessChange,
    onRingingCallerKeysChange,
    office,
    seedNumber,
    stationLabel,
    stationRequired = false,
    stationSeatId,
    transferTargets = [],
    voicemailTimeoutSec,
  },
  ref,
) {
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
  const [selectedTransferSeatId, setSelectedTransferSeatId] = useState("");
  const [transferPending, setTransferPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answeringCallIds, setAnsweringCallIds] = useState<Set<string>>(() => new Set());
  const [, setAnsweringRingKeys] = useState<Set<string>>(() => new Set());
  const [postCallWrapUp, setPostCallWrapUp] = useState<CompletedCallWrapUp | null>(null);

  // Refs mirror state so the Telnyx notification handler (created once) can read latest values
  const activeCallRef = useRef<TelnyxCall | null>(null);
  const activeCallConnectedRef = useRef(false);
  const activeCallWrapUpRef = useRef<CompletedCallWrapUp | null>(null);
  const dialedNumberRef = useRef("");
  const incomingCallRef = useRef<TelnyxCall | null>(null);
  const queuedCallsRef = useRef<TelnyxCall[]>([]);
  const stationLabelRef = useRef<string | null>(stationLabel ?? null);
  const stationSeatIdRef = useRef<string | null>(stationSeatId ?? null);
  const answeringInboundCallIdsRef = useRef<Set<string>>(new Set());
  const answeringRingKeysRef = useRef<Set<string>>(new Set());
  const pendingAnswerExpireTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const answeredInboundCallIdsRef = useRef<Set<string>>(new Set());
  const inboundCallIdsRef = useRef<Set<string>>(new Set());
  const dismissedRingKeysRef = useRef<Set<string>>(new Set());
  const outboundCallIdsRef = useRef<Set<string>>(new Set());
  const expectingOutboundUntilRef = useRef<number>(0);
  const transferPendingRef = useRef(false);
  const transferPendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incomingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringingCallExpireTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // When the SDK briefly transitions a ringing call through "hangup" (e.g.
  // ICE renegotiation, session refresh) we don't want to remove the UI
  // immediately — the next notification often re-rings. Debounce the clear.
  const pendingTerminalClearRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const PENDING_TERMINAL_CLEAR_MS = 1500;
  // Agent rings should be short in V1. The backend is the source of truth for
  // the caller, but this browser leg should disappear quickly if nobody picks up.
  const ringingTimeoutMs = Math.min(
    AGENT_RING_UI_TIMEOUT_MS,
    Math.max(5_000, (voicemailTimeoutSec ?? 30) * 1000),
  );
  const stationSelected = !stationRequired || Boolean(stationSeatId);

  const debugLog = useCallback((event: string, details: Record<string, unknown> = {}) => {
    if (!CALL_CENTER_DEBUG) {
      return;
    }

    const now = typeof performance === "undefined" ? Date.now() : performance.now();

    console.info("[call-center-debug]", {
      at: new Date().toISOString(),
      elapsedMs: Math.round(now - DEBUG_START_MS),
      event,
      ...sanitizeCallCenterDebugDetails(details),
    });
  }, []);

  const media = useLegacySoftphoneMedia({
    autoPrepare: enabled && stationSelected,
    browserSessionId,
    enabled,
    onDebug: debugLog,
    stationSeatId,
  });
  const {
    activate: activateMediaLeg,
    answer: answerMediaLeg,
    connection: mediaConnection,
    deactivate: deactivateMediaLeg,
    decline: declineMediaLeg,
    dial: dialMediaLeg,
    error: mediaError,
    hangup: hangupMediaLeg,
    hold: holdMediaLeg,
    microphoneReady,
    mute: muteMediaLeg,
    prepare: prepareMedia,
    remoteAudioRef,
    sendDtmf,
    setupError,
    setupPending,
    soundReady,
    subscribeLegacy,
  } = media;
  const readiness = useMemo(
    () =>
      resolveSoftphoneReadiness({
        microphoneReady,
        providerReady: mediaConnection === "READY",
        soundReady,
        stationId: stationSeatId ?? null,
        stationSelected,
      }),
    [mediaConnection, microphoneReady, soundReady, stationSeatId, stationSelected],
  );

  const eligibleTransferTargets = useMemo(
    () =>
      transferTargets.filter(
        (seat) => seat.id !== stationSeatId && Boolean(seat.sipUsername),
      ),
    [stationSeatId, transferTargets],
  );

  useEffect(() => {
    if (
      selectedTransferSeatId &&
      eligibleTransferTargets.some((seat) => seat.id === selectedTransferSeatId)
    ) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Keep the selected external station valid.
    setSelectedTransferSeatId(eligibleTransferTargets[0]?.id ?? "");
  }, [eligibleTransferTargets, selectedTransferSeatId]);

  const setAnsweringCallPending = useCallback((callId: string, pending: boolean) => {
    if (pending) {
      answeringInboundCallIdsRef.current.add(callId);
    } else {
      answeringInboundCallIdsRef.current.delete(callId);
    }

    setAnsweringCallIds((current) => {
      const next = new Set(current);

      if (pending) {
        next.add(callId);
      } else {
        next.delete(callId);
      }

      return next;
    });
  }, []);

  const setAnsweringRingPending = useCallback((ringKey: string, pending: boolean) => {
    if (!ringKey) {
      return;
    }

    if (pending) {
      answeringRingKeysRef.current.add(ringKey);
    } else {
      answeringRingKeysRef.current.delete(ringKey);
      const timer = pendingAnswerExpireTimersRef.current.get(ringKey);
      if (timer) {
        clearTimeout(timer);
        pendingAnswerExpireTimersRef.current.delete(ringKey);
      }
    }

    setAnsweringRingKeys((current) => {
      const next = new Set(current);

      if (pending) {
        next.add(ringKey);
      } else {
        next.delete(ringKey);
      }

      return next;
    });
  }, []);

  const setAnsweringPendingForCall = useCallback(
    (call: TelnyxCall, pending: boolean) => {
      setAnsweringCallPending(call.id, pending);
      const keys = new Set(
        [ringKeyFor(call), clientStateQueueItemId(call), callerKeyFor(call)].filter(
          Boolean,
        ),
      );

      for (const key of keys) {
        setAnsweringRingPending(key, pending);
      }
    },
    [setAnsweringCallPending, setAnsweringRingPending],
  );

  const scheduleAnswerPendingExpiry = useCallback(
    (ringKey: string) => {
      if (!ringKey) {
        return;
      }

      const existing = pendingAnswerExpireTimersRef.current.get(ringKey);
      if (existing) {
        clearTimeout(existing);
      }

      const timeoutMs = Math.max(10_000, ringingTimeoutMs + 2_000);
      const timer = setTimeout(() => {
        debugLog("pending-answer-expired", { ringKey, timeoutMs });
        setAnsweringRingPending(ringKey, false);
      }, timeoutMs);
      pendingAnswerExpireTimersRef.current.set(ringKey, timer);
    },
    [debugLog, ringingTimeoutMs, setAnsweringRingPending],
  );

  useImperativeHandle(
    ref,
    () => ({
      clearAnswerPending: (ringKey: string) => {
        if (!ringKey) return;

        setAnsweringRingPending(ringKey, false);

        const callMatchesKey = (call: TelnyxCall) =>
          ringKeyFor(call) === ringKey ||
          clientStateQueueItemId(call) === ringKey ||
          callerKeyFor(call) === ringKey;
        const matches = [
          ...queuedCallsRef.current.filter(callMatchesKey),
          ...(incomingCallRef.current && callMatchesKey(incomingCallRef.current)
            ? [incomingCallRef.current]
            : []),
        ];
        const clearedCallIds = new Set<string>();

        for (const call of matches) {
          if (clearedCallIds.has(call.id)) {
            continue;
          }

          clearedCallIds.add(call.id);
          setAnsweringPendingForCall(call, false);
        }
      },
      markAnswerPending: (ringKey: string) => {
        if (!ringKey) return false;
        // If the ring already arrived for this key, answer it now; otherwise
        // arm the auto-answer so the next ringing notification picks it up.
        dismissedRingKeysRef.current.delete(ringKey);
        setAnsweringRingPending(ringKey, true);
        scheduleAnswerPendingExpiry(ringKey);

        const callMatchesKey = (call: TelnyxCall) =>
          ringKeyFor(call) === ringKey ||
          clientStateQueueItemId(call) === ringKey ||
          callerKeyFor(call) === ringKey;
        const matchInQueue = queuedCallsRef.current.find(callMatchesKey);
        const matchIncoming =
          incomingCallRef.current && callMatchesKey(incomingCallRef.current)
            ? incomingCallRef.current
            : null;
        const match = matchInQueue ?? matchIncoming;

        if (
          match &&
          isAnswerableInboundCall(match) &&
          !answeringInboundCallIdsRef.current.has(match.id)
        ) {
          const currentActiveCall = activeCallRef.current;
          if (currentActiveCall && currentActiveCall.id !== match.id) {
            void holdMediaLeg(currentActiveCall.id, true).catch(() => {});
            setHeldCalls((current) =>
              current.some((call) => call.id === currentActiveCall.id)
                ? current
                : [...current, currentActiveCall],
            );
          }

          setAnsweringCallPending(match.id, true);
          void answerMediaLeg(match.id).catch(() => {
            setAnsweringCallPending(match.id, false);
            setAnsweringRingPending(ringKey, false);
          });
        }

        return Boolean(match && !isEndedCall(match));
      },
    }),
    [
      scheduleAnswerPendingExpiry,
      answerMediaLeg,
      holdMediaLeg,
      setAnsweringCallPending,
      setAnsweringPendingForCall,
      setAnsweringRingPending,
    ],
  );

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);
  useEffect(() => {
    onReadinessChange?.(readiness);
  }, [onReadinessChange, readiness]);
  useEffect(() => {
    dialedNumberRef.current = dialedNumber;
  }, [dialedNumber]);
  const hasLocalCallLeg = hasLocalProviderCallLeg({
    active: Boolean(activeCall),
    heldCount: heldCalls.length,
    incoming: Boolean(incomingCall),
    queuedCount: queuedCalls.length,
  });
  const ringingCallerKeys = useMemo(
    () =>
      [incomingCall, ...queuedCalls]
        .filter((call): call is TelnyxCall => Boolean(call))
        .map(callerKeyFor)
        .filter(Boolean),
    [incomingCall, queuedCalls],
  );
  useEffect(() => {
    onBusyChange?.(hasLocalCallLeg);
  }, [hasLocalCallLeg, onBusyChange]);
  useEffect(() => {
    onActivityChange?.(hasLocalCallLeg);
  }, [hasLocalCallLeg, onActivityChange]);
  useEffect(() => {
    onRingingCallerKeysChange?.([...new Set(ringingCallerKeys)]);
  }, [onRingingCallerKeysChange, ringingCallerKeys]);
  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);
  useEffect(() => {
    queuedCallsRef.current = queuedCalls;
  }, [queuedCalls]);
  useEffect(() => {
    stationLabelRef.current = stationLabel ?? null;
  }, [stationLabel]);
  useEffect(() => {
    stationSeatIdRef.current = stationSeatId ?? null;
  }, [stationSeatId]);

  useEffect(() => {
    debugLog("ui-state-changed", {
      activeCall: callDebugSnapshot(activeCall),
      answeringCallIds: [...answeringCallIds],
      direction,
      heldCallIds: heldCalls.map((call) => call.id),
      incomingCall: callDebugSnapshot(incomingCall),
      queuedCallIds: queuedCalls.map((call) => call.id),
      status,
    });
  }, [
    activeCall,
    answeringCallIds,
    debugLog,
    direction,
    heldCalls,
    incomingCall,
    queuedCalls,
    status,
  ]);

  useEffect(() => {
    if (!seedNumber || !seedNumber.value) {
      return;
    }
    debugLog("callback-seeded", { value: seedNumber.value });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Navigation deliberately seeds the dialer.
    setDraftNumber(seedNumber.value);
  }, [debugLog, seedNumber]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearTransferPendingTimer = useCallback(() => {
    if (transferPendingTimerRef.current) {
      clearTimeout(transferPendingTimerRef.current);
      transferPendingTimerRef.current = null;
    }
  }, []);

  const clearIncomingClearTimer = useCallback(() => {
    if (incomingClearTimerRef.current) {
      clearTimeout(incomingClearTimerRef.current);
      incomingClearTimerRef.current = null;
    }
  }, []);

  const clearRingingCallExpiryTimer = useCallback((ringKey: string) => {
    const timer = ringingCallExpireTimersRef.current.get(ringKey);

    if (timer) {
      clearTimeout(timer);
      ringingCallExpireTimersRef.current.delete(ringKey);
    }
  }, []);

  const clearAllRingingCallExpiryTimers = useCallback(() => {
    for (const timer of ringingCallExpireTimersRef.current.values()) {
      clearTimeout(timer);
    }
    ringingCallExpireTimersRef.current.clear();
    for (const timer of pendingTerminalClearRef.current.values()) {
      clearTimeout(timer);
    }
    pendingTerminalClearRef.current.clear();
    for (const timer of pendingAnswerExpireTimersRef.current.values()) {
      clearTimeout(timer);
    }
    pendingAnswerExpireTimersRef.current.clear();
  }, []);

  const clearRingingCallUi = useCallback(
    (ringKey: string, reason: string) => {
      debugLog("ringing-call-cleared", { reason, ringKey });
      clearRingingCallExpiryTimer(ringKey);
      setAnsweringRingPending(ringKey, false);
      setIncomingCall((current) => {
        if (!current || ringKeyFor(current) !== ringKey) {
          return current;
        }

        setAnsweringCallPending(current.id, false);
        answeredInboundCallIdsRef.current.delete(current.id);
        inboundCallIdsRef.current.delete(current.id);
        return null;
      });
      setQueuedCalls((current) =>
        current.filter((call) => {
          if (ringKeyFor(call) !== ringKey) {
            return true;
          }

          setAnsweringCallPending(call.id, false);
          answeredInboundCallIdsRef.current.delete(call.id);
          inboundCallIdsRef.current.delete(call.id);
          return false;
        }),
      );

      const hasOtherIncoming =
        incomingCallRef.current && ringKeyFor(incomingCallRef.current) !== ringKey;
      const hasOtherQueued = queuedCallsRef.current.some(
        (call) => ringKeyFor(call) !== ringKey,
      );

      if (!activeCallRef.current && !hasOtherIncoming && !hasOtherQueued) {
        setDirection(null);
        setStatus((s) => (s === "error" ? s : "ready"));
      }
    },
    [
      clearRingingCallExpiryTimer,
      debugLog,
      setAnsweringCallPending,
      setAnsweringRingPending,
    ],
  );

  const scheduleRingingCallExpiry = useCallback(
    (call: TelnyxCall) => {
      const ringKey = ringKeyFor(call);

      if (ringingCallExpireTimersRef.current.has(ringKey)) {
        return;
      }

      debugLog("ringing-call-expiry-scheduled", {
        call: callDebugSnapshot(call),
        ringKey,
        timeoutMs: ringingTimeoutMs,
      });
      const timer = setTimeout(() => {
        dismissedRingKeysRef.current.add(ringKey);
        clearRingingCallUi(ringKey, "ring-timeout");
      }, ringingTimeoutMs);
      ringingCallExpireTimersRef.current.set(ringKey, timer);
    },
    [clearRingingCallUi, debugLog, ringingTimeoutMs],
  );

  const startTimer = useCallback(() => {
    if (timerRef.current) {
      return;
    }
    setCallDuration(0);
    timerRef.current = setInterval(() => {
      setCallDuration((current) => current + 1);
    }, 1000);
  }, []);

  const queuePostCallWrapUp = useCallback(
    (reason: string) => {
      const connected = activeCallConnectedRef.current;
      const wrapUp = activeCallWrapUpRef.current;
      const transferHandoffPending = transferPendingRef.current;

      activeCallConnectedRef.current = false;
      activeCallWrapUpRef.current = null;

      if (!connected || !wrapUp?.phone || transferHandoffPending) {
        debugLog("post-call-wrap-up-skipped", {
          connected,
          hadWrapUp: Boolean(wrapUp),
          reason,
          transferHandoffPending,
        });
        return;
      }

      const nextWrapUp = {
        ...wrapUp,
        token: Date.now(),
      };

      debugLog("post-call-wrap-up-queued", {
        direction: nextWrapUp.direction,
        phone: nextWrapUp.phone,
        reason,
      });
      setPostCallWrapUp(nextWrapUp);
    },
    [debugLog],
  );

  const resetActiveCallUi = useCallback(() => {
    const activeMediaLegId = activeCallRef.current?.id ?? null;
    debugLog("active-call-reset", { call: callDebugSnapshot(activeCallRef.current) });
    if (activeMediaLegId) deactivateMediaLeg(activeMediaLegId);
    activeCallConnectedRef.current = false;
    activeCallWrapUpRef.current = null;
    clearTimer();
    setActiveCall(null);
    setDialedNumber("");
    setDirection(null);
    setMuted(false);
    setHeld(false);
    setShowKeypad(false);
    setCallDuration(0);
    clearTransferPendingTimer();
    transferPendingRef.current = false;
    setTransferPending(false);
  }, [clearTimer, clearTransferPendingTimer, deactivateMediaLeg, debugLog]);

  const setInboundRingingCall = useCallback(
    (call: TelnyxCall) => {
      const ringKey = ringKeyFor(call);

      if (dismissedRingKeysRef.current.has(ringKey)) {
        debugLog("inbound-ringing-ignored-dismissed", {
          call: callDebugSnapshot(call),
          ringKey,
        });
        return;
      }

      clearIncomingClearTimer();
      scheduleRingingCallExpiry(call);
      // Cancel any pending debounced terminal-clear for this caller — a new
      // ringing notification means the call is still alive.
      const pendingTerminal = pendingTerminalClearRef.current.get(ringKey);
      if (pendingTerminal) {
        clearTimeout(pendingTerminal);
        pendingTerminalClearRef.current.delete(ringKey);
      }
      inboundCallIdsRef.current.add(call.id);
      debugLog("inbound-ringing-upsert", {
        activeCallId: activeCallRef.current?.id ?? null,
        call: callDebugSnapshot(call),
        incomingCallId: incomingCallRef.current?.id ?? null,
        queuedCallIds: queuedCallsRef.current.map((queuedCall) => queuedCall.id),
      });

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
    [clearIncomingClearTimer, debugLog, scheduleRingingCallExpiry],
  );

  const scheduleIncomingClear = useCallback(
    (call: TelnyxCall) => {
      clearIncomingClearTimer();
      debugLog("incoming-clear-scheduled", { call: callDebugSnapshot(call) });
      incomingClearTimerRef.current = setTimeout(() => {
        debugLog("incoming-clear-fired", { call: callDebugSnapshot(call) });
        setIncomingCall((current) => (current?.id === call.id ? null : current));
        if (!activeCallRef.current && queuedCallsRef.current.length === 0) {
          setDirection(null);
          setStatus((s) => (s === "error" ? s : "ready"));
        }
        incomingClearTimerRef.current = null;
      }, 1500);
    },
    [clearIncomingClearTimer, debugLog],
  );

  const promoteToActiveCall = useCallback(
    (call: TelnyxCall, inbound: boolean) => {
      debugLog("call-promoted-active", {
        call: callDebugSnapshot(call),
        inbound,
      });
      const phone = postCallPhoneFor(call, inbound, dialedNumberRef.current);

      activeCallConnectedRef.current = true;
      activeCallWrapUpRef.current = phone
        ? {
            direction: inbound ? "inbound" : "outbound",
            phone,
            stationLabel: stationLabelRef.current,
            stationSeatId: stationSeatIdRef.current,
            token: Date.now(),
          }
        : null;

      if (inbound) {
        answeredInboundCallIdsRef.current.add(call.id);
      }
      clearRingingCallExpiryTimer(ringKeyFor(call));
      setAnsweringPendingForCall(call, false);
      activateMediaLeg(call.id);
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
    [
      activateMediaLeg,
      clearRingingCallExpiryTimer,
      debugLog,
      setAnsweringPendingForCall,
      startTimer,
    ],
  );

  const handleMediaCallUpdate = useCallback(
    (call: TelnyxCall) => {
      const expectingOutbound =
        expectingOutboundUntilRef.current > 0 &&
        Date.now() < expectingOutboundUntilRef.current &&
        !inboundCallIdsRef.current.has(call.id) &&
        !isInboundDirection(call.direction);
      const outbound = outboundCallIdsRef.current.has(call.id) || expectingOutbound;
      if (expectingOutbound) {
        outboundCallIdsRef.current.add(call.id);
        expectingOutboundUntilRef.current = 0;
      }
      const knownInbound =
        inboundCallIdsRef.current.has(call.id) ||
        incomingCallRef.current?.id === call.id ||
        queuedCallsRef.current.some((queuedCall) => queuedCall.id === call.id);
      const inbound = !outbound;
      const ringingStates = ["new", "trying", "requesting", "ringing", "early"];
      debugLog("call-update", {
        call: callDebugSnapshot(call),
        classifiedInbound: inbound,
        classifiedOutbound: outbound,
        knownInbound,
        incomingCallId: incomingCallRef.current?.id ?? null,
        isAnswerPending: answeringInboundCallIdsRef.current.has(call.id),
        queuedCallIds: queuedCallsRef.current.map((queuedCall) => queuedCall.id),
      });

      if (ringingStates.includes(call.state || "")) {
        if (outbound) {
          activeCallConnectedRef.current = false;
          activeCallWrapUpRef.current = null;
          setIncomingCall((current) => (current?.id === call.id ? null : current));
          setQueuedCalls((current) => current.filter((queued) => queued.id !== call.id));
          setActiveCall(call);
          setDirection("outbound");
          setStatus("ringing");
          startTimer();
        } else if (inbound) {
          if (!inboundEnabled) {
            debugLog("inbound-call-ignored-outbound-only", {
              call: callDebugSnapshot(call),
            });
            void declineMediaLeg(call.id).catch(() => {});
            return;
          }
          setInboundRingingCall(call);
          setStatus("ringing");
          const ringKey = ringKeyFor(call);
          const queueItemId = clientStateQueueItemId(call);
          const armedKey = answeringRingKeysRef.current.has(ringKey)
            ? ringKey
            : queueItemId && answeringRingKeysRef.current.has(queueItemId)
              ? queueItemId
              : "";

          if (
            armedKey &&
            !answeringInboundCallIdsRef.current.has(call.id) &&
            !isEndedCall(call)
          ) {
            if (!isAnswerableInboundCall(call)) {
              debugLog("pending-answer-waiting-for-ringing", {
                armedKey,
                call: callDebugSnapshot(call),
                ringKey,
              });
              return;
            }

            debugLog("pending-answer-resumed", {
              armedKey,
              call: callDebugSnapshot(call),
              ringKey,
            });
            setAnsweringCallPending(call.id, true);
            if (armedKey !== ringKey) {
              setAnsweringRingPending(ringKey, true);
            }
            void answerMediaLeg(call.id).catch((answerError) => {
              debugLog("pending-answer-failed", {
                armedKey,
                call: callDebugSnapshot(call),
                message: errorMessageFor(answerError),
                ringKey,
              });
              setAnsweringCallPending(call.id, false);
              if (isStaleTelnyxCallError(answerError)) {
                clearRingingCallUi(ringKey, "stale-pending-answer");
                if (armedKey !== ringKey) {
                  setAnsweringRingPending(armedKey, false);
                }
              } else {
                setAnsweringRingPending(ringKey, false);
                if (armedKey !== ringKey) {
                  setAnsweringRingPending(armedKey, false);
                }
                setError(operatorMessage(answerError, "take"));
              }
            });
          }
        } else {
          debugLog("call-update-unclassified-ringing", {
            call: callDebugSnapshot(call),
          });
        }
        return;
      }

      if (call.state === "active") {
        if (activeCallRef.current?.id === call.id) {
          if (activeCallConnectedRef.current) {
            setActiveCall(call);
          } else {
            promoteToActiveCall(call, inbound);
          }
          return;
        }

        if (inbound && !inboundEnabled) {
          debugLog("inbound-active-ignored-outbound-only", {
            call: callDebugSnapshot(call),
          });
          void declineMediaLeg(call.id).catch(() => {});
          return;
        }

        const ringKey = ringKeyFor(call);
        const answerWasRequested =
          answeringInboundCallIdsRef.current.has(call.id) ||
          answeringRingKeysRef.current.has(ringKey) ||
          answeredInboundCallIdsRef.current.has(call.id);

        if (inbound && !answerWasRequested && !knownInbound) {
          debugLog("inbound-active-without-answer-flag", {
            call: callDebugSnapshot(call),
          });
          setInboundRingingCall(call);
          setStatus("ringing");
          return;
        }

        promoteToActiveCall(call, inbound);
        return;
      }

      if (call.state === "hangup" || call.state === "destroy") {
        const ringKey = ringKeyFor(call);
        setAnsweringCallPending(call.id, false);
        answeredInboundCallIdsRef.current.delete(call.id);
        inboundCallIdsRef.current.delete(call.id);
        outboundCallIdsRef.current.delete(call.id);

        if (activeCallRef.current?.id === call.id) {
          clearRingingCallExpiryTimer(ringKey);
          setAnsweringRingPending(ringKey, false);
          queuePostCallWrapUp("call-terminal");
          resetActiveCallUi();
          setStatus((s) =>
            incomingCallRef.current || queuedCallsRef.current.length > 0
              ? "ringing"
              : s === "error"
                ? s
                : "ready",
          );
          return;
        }

        if (inbound) {
          debugLog("inbound-terminal-pending", {
            call: callDebugSnapshot(call),
            ringKey,
          });
          // Debounce the clear — if the SDK fires hangup transiently
          // (renegotiation, brief network hiccup) and a fresh ringing
          // notification arrives within PENDING_TERMINAL_CLEAR_MS,
          // setInboundRingingCall will cancel this timer and the UI
          // stays put. Otherwise, we clear after the debounce window.
          const existing = pendingTerminalClearRef.current.get(ringKey);
          if (existing) {
            clearTimeout(existing);
          }
          const timer = setTimeout(() => {
            pendingTerminalClearRef.current.delete(ringKey);
            debugLog("inbound-terminal-cleared", {
              call: callDebugSnapshot(call),
              ringKey,
            });
            clearRingingCallUi(ringKey, "sdk-terminal");
          }, PENDING_TERMINAL_CLEAR_MS);
          pendingTerminalClearRef.current.set(ringKey, timer);
          return;
        }

        clearRingingCallExpiryTimer(ringKey);
        setAnsweringRingPending(ringKey, false);
        let remainingQueuedCalls = queuedCallsRef.current.filter((c) => c.id !== call.id);
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

        if (
          !activeCallRef.current &&
          !remainingIncomingCall &&
          remainingQueuedCalls.length === 0
        ) {
          setDirection(null);
          setStatus((s) => (s === "error" ? s : "ready"));
        }
      }
    },
    [
      clearRingingCallExpiryTimer,
      clearRingingCallUi,
      debugLog,
      answerMediaLeg,
      declineMediaLeg,
      inboundEnabled,
      promoteToActiveCall,
      queuePostCallWrapUp,
      resetActiveCallUi,
      scheduleIncomingClear,
      setAnsweringCallPending,
      setAnsweringRingPending,
      setInboundRingingCall,
      startTimer,
    ],
  );

  useEffect(
    () => subscribeLegacy(handleMediaCallUpdate),
    [handleMediaCallUpdate, subscribeLegacy],
  );

  useEffect(() => {
    if (mediaConnection === "CONNECTING") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Mirror the external media connection state.
      setStatus("initializing");
      return;
    }
    if (mediaConnection === "FAILED") {
      setStatus("error");
      setError(
        mediaError ||
          operatorMessage(localCallCenterError("PROVIDER_UNAVAILABLE"), "connect"),
      );
      return;
    }
    if (mediaConnection === "OFFLINE") {
      setStatus("offline");
      return;
    }
    setStatus((current) =>
      current === "initializing" || current === "offline" || current === "error"
        ? "ready"
        : current,
    );
    setError(null);
  }, [mediaConnection, mediaError]);

  useEffect(() => {
    const answeringRingKeys = answeringRingKeysRef.current;
    const answeredInboundCallIds = answeredInboundCallIdsRef.current;
    const dismissedRingKeys = dismissedRingKeysRef.current;
    const inboundCallIds = inboundCallIdsRef.current;

    return () => {
      clearTimer();
      clearTransferPendingTimer();
      clearIncomingClearTimer();
      clearAllRingingCallExpiryTimers();
      answeringRingKeys.clear();
      answeredInboundCallIds.clear();
      dismissedRingKeys.clear();
      inboundCallIds.clear();
    };
  }, [
    clearAllRingingCallExpiryTimers,
    clearIncomingClearTimer,
    clearTimer,
    clearTransferPendingTimer,
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

    const playTone = (startAt: number, frequency: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.14, startAt + 0.02);
      gain.gain.setValueAtTime(0.14, startAt + duration - 0.03);
      gain.gain.linearRampToValueAtTime(0, startAt + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + duration);
    };

    const playRingCycle = () => {
      if (cancelled) return;
      const now = ctx.currentTime;
      playTone(now, 784, 0.16);
      playTone(now + 0.22, 988, 0.18);

      scheduleHandle = setTimeout(playRingCycle, 2400);
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

  const makeCall = useCallback(async () => {
    const to = normalizeToE164(draftNumber);

    if (mediaConnection !== "READY" || !to || status !== "ready") {
      debugLog("outbound-call-blocked", {
        hasClient: mediaConnection === "READY",
        hasDestination: Boolean(to),
        status,
      });
      return;
    }

    const mediaReady = await prepareMedia();

    if (!mediaReady) {
      return;
    }

    debugLog("outbound-call-start", {
      callerNumber,
      destinationNumber: to,
    });
    activeCallConnectedRef.current = false;
    activeCallWrapUpRef.current = null;
    setPostCallWrapUp(null);
    setDialedNumber(to);
    setDirection("outbound");
    setStatus("ringing");
    setError(null);

    expectingOutboundUntilRef.current = Date.now() + 5_000;

    try {
      const mediaLegId = dialMediaLeg({
        callerNumber,
        clientState: encodeCallClientState({
          browserSessionId,
          locationId: office ?? null,
          stationLabel,
          stationSeatId,
        }),
        destinationNumber: to,
      });
      outboundCallIdsRef.current.add(mediaLegId);
      expectingOutboundUntilRef.current = 0;
      debugLog("outbound-call-created", { mediaLegId });
      setDraftNumber("");
    } catch (callError) {
      expectingOutboundUntilRef.current = 0;
      debugLog("outbound-call-failed", {
        message: callError instanceof Error ? callError.message : "Unable to start call",
      });
      setStatus("error");
      setError(operatorMessage(callError, "outbound"));
    }
  }, [
    browserSessionId,
    callerNumber,
    debugLog,
    draftNumber,
    office,
    dialMediaLeg,
    mediaConnection,
    prepareMedia,
    stationLabel,
    stationSeatId,
    status,
  ]);

  const resumeHeld = useCallback(
    (callId: string) => {
      const held = heldCalls.find((c) => c.id === callId);
      if (!held) return;

      // Hold current active if any, then unhold the selected
      if (activeCall && activeCall.id !== callId) {
        void holdMediaLeg(activeCall.id, true).catch((error) => {
          setError(operatorMessage(error, "hold"));
        });
        setHeldCalls((current) =>
          current.some((c) => c.id === activeCall.id)
            ? current
            : [...current, activeCall],
        );
      }
      void holdMediaLeg(held.id, false).catch((error) => {
        setError(operatorMessage(error, "hold"));
      });
    },
    [activeCall, heldCalls, holdMediaLeg],
  );

  const endHeld = useCallback(
    (callId: string) => {
      const held = heldCalls.find((c) => c.id === callId);
      if (!held) return;
      void hangupMediaLeg(held.id).catch((error) => {
        setError(operatorMessage(error, "end"));
      });
      setHeldCalls((current) => current.filter((c) => c.id !== callId));
    },
    [hangupMediaLeg, heldCalls],
  );

  const hangUp = useCallback(() => {
    if (activeCall) {
      debugLog("hangup-clicked", { call: callDebugSnapshot(activeCall) });
      void hangupMediaLeg(activeCall.id).catch((hangupError) => {
        debugLog("hangup-failed", {
          call: callDebugSnapshot(activeCall),
          message: errorMessageFor(hangupError),
        });
        if (isStaleTelnyxCallError(hangupError)) {
          queuePostCallWrapUp("stale-hangup-error");
          resetActiveCallUi();
        } else {
          setError(operatorMessage(hangupError, "end"));
        }
      });
    }
  }, [activeCall, debugLog, hangupMediaLeg, queuePostCallWrapUp, resetActiveCallUi]);

  const toggleMute = useCallback(() => {
    if (!activeCall) return;
    try {
      muteMediaLeg(activeCall.id, !isMuted);
      setMuted((current) => !current);
      setError(null);
    } catch (error) {
      setError(operatorMessage(error, "mute"));
    }
  }, [activeCall, isMuted, muteMediaLeg]);

  const toggleHold = useCallback(() => {
    if (!activeCall) return;
    void holdMediaLeg(activeCall.id, !isHeld)
      .then(() => {
        setHeld((current) => !current);
        setError(null);
      })
      .catch((error) => setError(operatorMessage(error, "hold")));
  }, [activeCall, holdMediaLeg, isHeld]);

  const sendDigit = useCallback(
    (digit: string) => {
      if (!activeCall) return;
      try {
        sendDtmf(activeCall.id, digit);
        setError(null);
      } catch (error) {
        setError(operatorMessage(error, "keypad"));
      }
    },
    [activeCall, sendDtmf],
  );

  const transferCall = useCallback(async () => {
    const sourceCallControlId = activeCall?.providerCallControlId;

    if (!activeCall || !sourceCallControlId || !selectedTransferSeatId) {
      setError("Choose an available station before transferring.");
      return;
    }

    transferPendingRef.current = true;
    setTransferPending(true);
    clearTransferPendingTimer();
    setError(null);
    debugLog("transfer-request-start", {
      call: callDebugSnapshot(activeCall),
      targetSeatId: selectedTransferSeatId,
    });

    try {
      const response = await fetch("/api/portal/call-center/transfer", {
        body: JSON.stringify({
          browserSessionId,
          sourceCallControlId,
          targetSeatId: selectedTransferSeatId,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        await callCenterResponse(response);
      }

      debugLog("transfer-request-finished", {
        call: callDebugSnapshot(activeCall),
        targetSeatId: selectedTransferSeatId,
      });
      transferPendingTimerRef.current = setTimeout(() => {
        debugLog("transfer-pending-timeout", {
          call: callDebugSnapshot(activeCallRef.current),
          targetSeatId: selectedTransferSeatId,
        });
        transferPendingRef.current = false;
        setTransferPending(false);
      }, AGENT_RING_UI_TIMEOUT_MS + 2000);
    } catch (transferError) {
      debugLog("transfer-request-failed", {
        call: callDebugSnapshot(activeCall),
        message: errorMessageFor(transferError),
        targetSeatId: selectedTransferSeatId,
      });
      transferPendingRef.current = false;
      setTransferPending(false);
      setError(operatorMessage(transferError, "transfer"));
    }
  }, [
    activeCall,
    browserSessionId,
    clearTransferPendingTimer,
    debugLog,
    selectedTransferSeatId,
  ]);

  const activeNumber =
    activeCall && direction === "inbound"
      ? callerNumberFor(activeCall)
      : dialedNumber || (activeCall ? callerNumberFor(activeCall) : "");
  const canDial = status === "ready" && Boolean(normalizeToE164(draftNumber));
  const canTransfer =
    Boolean(activeCall?.providerCallControlId) &&
    Boolean(selectedTransferSeatId) &&
    !transferPending;
  const visualStatus =
    !activeCall && ringingCallerKeys.length > 0 && status === "ringing"
      ? "ready"
      : status;
  const displayedStatus = !readiness.stationSelected
    ? "Station needed"
    : visualStatus === "ready" && !readiness.ready
      ? "Setup needed"
      : statusLabel(visualStatus);
  const visibleError = error ?? setupError;

  return (
    <section className="rounded-lg border border-[var(--portal-border)] bg-white shadow-[0_14px_40px_rgba(16,39,44,0.04)]">
      <div className="flex flex-col gap-3 border-b border-[var(--portal-border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--portal-muted)]">
            Softphone
          </p>
          <p className="mt-1 text-sm font-medium text-[var(--portal-ink)]">
            {formatPhone(callerNumber)}
          </p>
          {stationLabel ? (
            <p className="mt-0.5 text-xs text-[var(--portal-muted)]">{stationLabel}</p>
          ) : null}
        </div>
        <span
          className={cn(
            "inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold",
            visualStatus === "ready" &&
              readiness.ready &&
              "border-[var(--portal-live)] bg-[var(--portal-live-soft)] text-[var(--portal-live)]",
            visualStatus === "ready" &&
              !readiness.ready &&
              "border-[var(--portal-warning)] bg-[var(--portal-warning-soft)] text-[var(--portal-warning)]",
            visualStatus === "on-call" &&
              "border-[var(--portal-accent)] bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]",
            visualStatus === "ringing" &&
              "border-[var(--portal-warning)] bg-[var(--portal-warning-soft)] text-[var(--portal-warning)]",
            (visualStatus === "error" ||
              (visualStatus === "offline" && readiness.stationSelected)) &&
              "border-[var(--portal-danger)] bg-[var(--portal-danger-soft)] text-[var(--portal-danger)]",
            (visualStatus === "initializing" || !readiness.stationSelected) &&
              "border-[var(--portal-border)] bg-[var(--portal-panel-soft)] text-[var(--portal-muted)]",
          )}
        >
          {displayedStatus}
        </span>
      </div>

      <div className="space-y-4 p-4">
        <audio ref={remoteAudioRef} autoPlay className="hidden" playsInline />

        {visibleError ? (
          <div
            className="rounded-lg border border-[var(--portal-danger)] bg-[var(--portal-danger-soft)] px-3 py-2 text-sm text-[var(--portal-danger)]"
            role="alert"
          >
            {visibleError}
          </div>
        ) : null}

        {!readiness.ready ? (
          <div className="rounded-lg border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] px-3 py-3">
            <p className="text-sm font-medium text-[var(--portal-ink)]" role="status">
              {readiness.message}
            </p>
            {readiness.stationSelected &&
            (!readiness.microphoneReady || !readiness.soundReady) ? (
              <Button
                className="mt-2"
                disabled={setupPending}
                onClick={() => void prepareMedia()}
                size="sm"
                variant="secondary"
              >
                <Mic className="h-4 w-4" aria-hidden="true" />
                {setupPending ? "Enabling" : "Enable calling"}
              </Button>
            ) : null}
          </div>
        ) : null}

        {activeCall ? (
          <div className="rounded-lg border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--portal-ink)]">
                  {formatPhone(activeNumber)}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--portal-muted)]">
                  {direction === "inbound" ? "Patient call" : "Outbound"}
                </p>
              </div>
              <p className="font-mono text-lg font-semibold tabular-nums text-[var(--portal-ink)]">
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

            <div className="mt-3 flex flex-col gap-2 rounded-md border border-[var(--portal-border)] bg-white p-3 sm:flex-row sm:items-center">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Transfer station</span>
                <select
                  className="h-9 w-full rounded-md border border-[var(--portal-border-strong)] bg-white px-2.5 text-sm font-medium text-[var(--portal-ink)] outline-none focus:border-[var(--portal-accent)]"
                  disabled={transferPending || eligibleTransferTargets.length === 0}
                  onChange={(event) => setSelectedTransferSeatId(event.target.value)}
                  value={selectedTransferSeatId}
                >
                  {eligibleTransferTargets.length ? (
                    eligibleTransferTargets.map((seat) => (
                      <option key={seat.id} value={seat.id}>
                        {seat.extension
                          ? `${seat.extension} - ${seat.label}`
                          : seat.label}
                      </option>
                    ))
                  ) : (
                    <option value="">No stations available</option>
                  )}
                </select>
              </label>
              <Button
                disabled={!canTransfer}
                onClick={() => void transferCall()}
                variant="secondary"
              >
                <PhoneForwarded className="h-4 w-4" aria-hidden="true" />
                {transferPending ? "Transferring" : "Transfer"}
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

        {postCallWrapUp && !activeCall ? (
          <div className="rounded-lg border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] p-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--portal-ink)]">
                Call outcome
              </p>
              <p className="mt-0.5 truncate text-xs text-[var(--portal-muted)]">
                {formatPhone(postCallWrapUp.phone)} ·{" "}
                {postCallWrapUp.direction === "inbound" ? "Inbound" : "Outbound"}
              </p>
            </div>

            <form
              action={saveCallCenterNoteAction}
              className="mt-3 grid gap-2"
              key={postCallWrapUp.token}
              onSubmit={() => setPostCallWrapUp(null)}
            >
              {office ? <input name="office" type="hidden" value={office} /> : null}
              <input name="phone" type="hidden" value={postCallWrapUp.phone} />
              <input
                name="stationSeatId"
                type="hidden"
                value={postCallWrapUp.stationSeatId ?? ""}
              />
              <input
                name="stationLabel"
                type="hidden"
                value={postCallWrapUp.stationLabel ?? ""}
              />
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--portal-muted)]">
                Outcome
                <select
                  className="h-10 rounded-lg border border-[var(--portal-border)] bg-white px-3 text-sm font-medium text-[var(--portal-ink)] outline-none transition focus:border-[var(--portal-accent)]"
                  defaultValue="RESOLVED"
                  name="disposition"
                >
                  <option value="RESOLVED">Resolved</option>
                  <option value="CALLBACK_NEEDED">Callback needed</option>
                  <option value="FOLLOW_UP_REQUIRED">Follow-up required</option>
                  <option value="WRONG_NUMBER">Wrong number</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--portal-muted)]">
                Note
                <textarea
                  className="min-h-20 rounded-lg border border-[var(--portal-border)] bg-white px-3 py-2 text-sm text-[var(--portal-ink)] outline-none transition placeholder:text-[var(--portal-muted-soft)] focus:border-[var(--portal-accent)]"
                  name="note"
                  placeholder="What happened?"
                  rows={2}
                />
              </label>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  onClick={() => setPostCallWrapUp(null)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Skip
                </Button>
                <Button
                  className="h-8 px-3 text-xs"
                  size="sm"
                  type="submit"
                  variant="primary"
                >
                  Save
                </Button>
              </div>
            </form>
          </div>
        ) : null}

        {heldCalls.length > 0 ? (
          <div className="rounded-lg border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--portal-muted)]">
              On hold · {heldCalls.length}
            </p>
            <ul className="mt-2 space-y-2">
              {heldCalls.map((call) => (
                <li
                  key={call.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-[var(--portal-border)] bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--portal-ink)]">
                      {formatPhone(callerNumberFor(call))}
                    </p>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--portal-muted-soft)]">
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
                      className="h-8 w-8 p-0 text-[var(--portal-muted)] hover:text-[var(--portal-danger)]"
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
                className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--portal-border-strong)] bg-white px-3 text-sm font-medium text-[var(--portal-ink)] outline-none focus:border-[var(--portal-accent)]"
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
});

export default SoftphonePanel;
