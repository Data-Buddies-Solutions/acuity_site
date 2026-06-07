"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  CirclePause,
  MinusCircle,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
} from "lucide-react";

import { Button } from "@/app/components/ui/button";

import type {
  PortalCallActivityItem,
  PortalCallCenterSeat,
  PortalCallQueueItem,
  PortalOutboundCallerNumber,
  PortalRecentCallItem,
} from "@/lib/call-center";

import ActivityRail from "./ActivityRail";
import SoftphonePanel, { type SoftphoneHandle } from "./SoftphonePanel";

type PresenceStatus = "AVAILABLE" | "BUSY" | "PAUSED";

const presenceOptions: Array<{
  icon: typeof CheckCircle2;
  label: string;
  value: PresenceStatus;
}> = [
  { icon: CheckCircle2, label: "Available", value: "AVAILABLE" },
  { icon: MinusCircle, label: "Busy", value: "BUSY" },
  { icon: CirclePause, label: "Paused", value: "PAUSED" },
];

export default function CallCenterWorkspace({
  activity,
  configured,
  configurationMessage,
  enabled,
  eventLocationId,
  inboundEnabled,
  outboundCallerNumber,
  outboundCallerNumbers,
  queue,
  recentCalls,
  seats,
  totals,
  voicemailTimeoutSec,
}: {
  activity: PortalCallActivityItem[];
  configured: boolean;
  configurationMessage: string;
  enabled: boolean;
  eventLocationId?: string | null;
  inboundEnabled: boolean;
  outboundCallerNumber: string;
  outboundCallerNumbers: PortalOutboundCallerNumber[];
  queue: PortalCallQueueItem[];
  recentCalls: PortalRecentCallItem[];
  seats: PortalCallCenterSeat[];
  totals: { missedCalls: number; voicemails: number };
  voicemailTimeoutSec: number;
}) {
  const router = useRouter();
  const [browserSessionId] = useState(getInitialBrowserSessionId);
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>("AVAILABLE");
  const [seed, setSeed] = useState<{ value: string; token: number } | null>(null);
  const [selectedOutboundCallerNumber, setSelectedOutboundCallerNumber] =
    useState(outboundCallerNumber);
  const [selectedSeatId, setSelectedSeatId] = useState(() => seats[0]?.id ?? "");
  const [softphoneBusy, setSoftphoneBusy] = useState(false);
  const [softphoneEngaged, setSoftphoneEngaged] = useState(false);
  const [takingTransferIds, setTakingTransferIds] = useState<Set<string>>(
    () => new Set(),
  );
  const takingTransferIdsRef = useRef(new Set<string>());
  const softphoneEngagedRef = useRef(false);
  const softphoneRef = useRef<SoftphoneHandle | null>(null);
  const selectedSeat = useMemo(
    () => seats.find((seat) => seat.id === selectedSeatId) ?? seats[0] ?? null,
    [seats, selectedSeatId],
  );
  const effectivePresenceStatus: PresenceStatus = softphoneBusy ? "BUSY" : presenceStatus;

  useEffect(() => {
    setSelectedOutboundCallerNumber(outboundCallerNumber);
  }, [outboundCallerNumber]);

  useEffect(() => {
    softphoneEngagedRef.current = softphoneEngaged;
  }, [softphoneEngaged]);

  useEffect(() => {
    if (!browserSessionId || !selectedSeat?.id) {
      return;
    }

    const updatePresence = (status: PresenceStatus | "OFFLINE") =>
      fetch("/api/portal/call-center/presence", {
        body: JSON.stringify({
          browserSessionId,
          seatId: selectedSeat.id,
          status,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        keepalive: status === "OFFLINE",
        method: "POST",
      }).catch(() => {});

    void updatePresence(effectivePresenceStatus);
    const heartbeat = setInterval(() => {
      void updatePresence(effectivePresenceStatus);
    }, 20_000);

    return () => {
      clearInterval(heartbeat);
      void updatePresence("OFFLINE");
    };
  }, [browserSessionId, effectivePresenceStatus, selectedSeat?.id]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const query =
      eventLocationId === undefined
        ? ""
        : `?locationId=${encodeURIComponent(eventLocationId ?? "__NULL__")}`;
    const source = new EventSource(`/api/portal/call-center/events${query}`);
    const refresh = () => {
      if (!softphoneEngagedRef.current) {
        router.refresh();
      }
    };

    source.addEventListener("refresh", refresh);

    return () => {
      source.removeEventListener("refresh", refresh);
      source.close();
    };
  }, [enabled, eventLocationId, router]);

  const handleCallback = useCallback((number: string) => {
    setSeed({ token: Date.now(), value: number });
  }, []);
  const handleTakeQueuedCall = useCallback(
    async (queueItemId: string) => {
      const selectedSeatId = selectedSeat?.id;

      if (!selectedSeatId) {
        return;
      }

      // Arm the softphone to auto-answer when the SIP INVITE arrives. The
      // Telnyx Call Control `client_state` we attach on the backend dial does
      // NOT propagate to the WebRTC SDK's call.options.clientState, so the
      // softphone's only stable identifier for this call is the caller's
      // E.164 number (resolved from the INVITE's remoteCallerNumber).
      const item = queue.find((entry) => entry.id === queueItemId);
      const callerKey = normalizeQueueCallerKey(item?.fromPhone);
      if (callerKey) {
        softphoneRef.current?.markAnswerPending(callerKey);
      }

      try {
        const response = await fetch("/api/portal/call-center/queue/take", {
          body: JSON.stringify({
            browserSessionId,
            queueItemId,
            seatId: selectedSeatId,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });

        if (!response.ok && callerKey) {
          softphoneRef.current?.clearAnswerPending(callerKey);
        }
      } catch (error) {
        if (callerKey) {
          softphoneRef.current?.clearAnswerPending(callerKey);
        }

        console.error("[call-center] failed to take queued call", error);
      } finally {
        router.refresh();
      }
    },
    [browserSessionId, queue, router, selectedSeat],
  );
  const handleTakeTransfer = useCallback(
    async (queueItemId: string) => {
      const selectedSeatId = selectedSeat?.id;

      if (!selectedSeatId) {
        return;
      }

      if (takingTransferIdsRef.current.has(queueItemId)) {
        return;
      }

      takingTransferIdsRef.current.add(queueItemId);
      setTakingTransferIds((current) => {
        const next = new Set(current);
        next.add(queueItemId);
        return next;
      });

      const item = queue.find((entry) => entry.id === queueItemId);
      const callerKey = normalizeQueueCallerKey(item?.fromPhone);
      if (callerKey) {
        softphoneRef.current?.markAnswerPending(callerKey);
      }

      try {
        const response = await fetch("/api/portal/call-center/transfer/take", {
          body: JSON.stringify({
            browserSessionId,
            queueItemId,
            seatId: selectedSeatId,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });

        if (!response.ok && callerKey) {
          softphoneRef.current?.clearAnswerPending(callerKey);
        }
      } catch (error) {
        if (callerKey) {
          softphoneRef.current?.clearAnswerPending(callerKey);
        }

        console.error("[call-center] failed to take transfer", error);
      } finally {
        takingTransferIdsRef.current.delete(queueItemId);
        setTakingTransferIds((current) => {
          const next = new Set(current);
          next.delete(queueItemId);
          return next;
        });
        router.refresh();
      }
    },
    [browserSessionId, queue, router, selectedSeat],
  );

  const hasWaitingCaller = useMemo(
    () =>
      queue.some(
        (item) =>
          ["WAITING", "RINGING", "ASSIGNED"].includes(item.status) &&
          !item.ringAttempts.some((attempt) =>
            ["DIALING", "RINGING", "ANSWERED"].includes(attempt.status),
          ),
      ),
    [queue],
  );

  useEffect(() => {
    if (!enabled || !hasWaitingCaller || softphoneBusy || softphoneEngaged) {
      return;
    }

    const AudioCtxCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtxCtor) return;

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

    const playCycle = () => {
      if (cancelled) return;
      const now = ctx.currentTime;
      playTone(now, 784, 0.16);
      playTone(now + 0.22, 988, 0.18);
      scheduleHandle = setTimeout(playCycle, 2400);
    };

    const start = () => {
      ctx
        .resume()
        .then(playCycle)
        .catch(() => {});
    };

    if (ctx.state === "suspended") {
      window.addEventListener("pointerdown", start, { once: true });
      window.addEventListener("keydown", start, { once: true });
    } else {
      playCycle();
    }

    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      if (scheduleHandle) clearTimeout(scheduleHandle);
      ctx.close().catch(() => {});
    };
  }, [enabled, hasWaitingCaller, softphoneBusy, softphoneEngaged]);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {inboundEnabled ? (
          <QueuePanel
            canTake={Boolean(selectedSeat)}
            isAvailable={effectivePresenceStatus === "AVAILABLE"}
            onCallback={handleCallback}
            onTake={handleTakeQueuedCall}
            onTakeTransfer={handleTakeTransfer}
            queue={queue}
            selectedSeatId={selectedSeat?.id ?? null}
            takingTransferIds={takingTransferIds}
          />
        ) : null}
        <ActivityRail activity={activity} onCallback={handleCallback} totals={totals} />
        <RecentCallsPanel calls={recentCalls} onCallback={handleCallback} />
      </div>
      <div>
        {enabled && configured ? (
          <div className="space-y-3">
            {seats.length ? (
              <section className="rounded-xl border border-black/6 bg-white p-4 shadow-sm">
                <label className="flex flex-col gap-1.5 text-sm font-medium text-[#10272c]">
                  Station
                  <select
                    className="h-10 rounded-lg border border-black/8 bg-white px-3 text-sm text-[#10272c] outline-none transition focus:border-[#0d7377] disabled:cursor-not-allowed disabled:bg-[#f3f6f6] disabled:text-[#8aa0a3]"
                    disabled={softphoneEngaged}
                    onChange={(event) => setSelectedSeatId(event.target.value)}
                    value={selectedSeat?.id ?? ""}
                  >
                    {seats.map((seat) => (
                      <option key={seat.id} value={seat.id}>
                        {seat.extension
                          ? `${seat.extension} - ${seat.label}`
                          : seat.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  {presenceOptions.map((option) => {
                    const Icon = option.icon;
                    const selected = presenceStatus === option.value;
                    const disabled = softphoneBusy && option.value !== "BUSY";

                    return (
                      <Button
                        aria-pressed={selected}
                        className="px-2"
                        disabled={disabled}
                        key={option.value}
                        onClick={() => setPresenceStatus(option.value)}
                        size="sm"
                        variant={
                          effectivePresenceStatus === option.value
                            ? "primary"
                            : "secondary"
                        }
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {option.label}
                      </Button>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {outboundCallerNumbers.length > 1 ? (
              <section className="rounded-xl border border-black/6 bg-white p-4 shadow-sm">
                <label className="flex flex-col gap-1.5 text-sm font-medium text-[#10272c]">
                  Outbound number
                  <select
                    className="h-10 rounded-lg border border-black/8 bg-white px-3 text-sm text-[#10272c] outline-none transition focus:border-[#0d7377]"
                    onChange={(event) =>
                      setSelectedOutboundCallerNumber(event.target.value)
                    }
                    value={selectedOutboundCallerNumber}
                  >
                    {outboundCallerNumbers.map((number) => (
                      <option key={number.phoneNumber} value={number.phoneNumber}>
                        {number.label} - {formatQueuePhone(number.phoneNumber)}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
            ) : null}
            <SoftphonePanel
              browserSessionId={browserSessionId}
              callerNumber={selectedOutboundCallerNumber || outboundCallerNumber}
              enabled={enabled}
              inboundEnabled={inboundEnabled}
              onActivityChange={setSoftphoneEngaged}
              onBusyChange={setSoftphoneBusy}
              ref={softphoneRef}
              seedNumber={seed}
              stationLabel={selectedSeat?.label ?? null}
              stationSeatId={selectedSeat?.id ?? null}
              transferTargets={seats}
              voicemailTimeoutSec={voicemailTimeoutSec}
            />
          </div>
        ) : (
          <section className="rounded-xl border border-black/6 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold tracking-[-0.02em] text-[#10272c]">
              Softphone standby
            </h3>
            <p className="mt-2 text-sm text-[#617477]">
              {enabled
                ? configurationMessage
                : "Enable the call center to start placing and receiving calls in the browser."}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function getInitialBrowserSessionId() {
  return typeof window === "undefined" ? "" : getBrowserSessionId();
}

function getBrowserSessionId() {
  const storageKey = "acuity-call-center-browser-session-id";

  try {
    const existing = window.localStorage.getItem(storageKey);

    if (existing) {
      return existing;
    }

    const generated =
      window.crypto?.randomUUID?.() ??
      `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(storageKey, generated);

    return generated;
  } catch {
    return `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function normalizeQueueCallerKey(phone: string | null | undefined) {
  // Mirror SoftphonePanel's normalizeToE164 so the armed key matches the
  // softphone's ringKeyFor(call) = normalizeToE164(remoteCallerNumber).
  if (!phone) return "";
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

function formatQueuePhone(phone: string | null) {
  const digits = phone?.replace(/\D/g, "") ?? "";

  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return phone || "Unknown caller";
}

function queueStatusLabel(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRecentCallTime(date: Date) {
  const value = new Date(date);
  const diff = Date.now() - value.getTime();
  const minutes = Math.round(diff / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + "h ago";

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
  }).format(value);
}

function hasLiveRingAttempt(item: PortalCallQueueItem) {
  return item.ringAttempts.some((attempt) =>
    ["DIALING", "RINGING", "ANSWERED"].includes(attempt.status),
  );
}

function RecentCallsPanel({
  calls,
  onCallback,
}: {
  calls: PortalRecentCallItem[];
  onCallback: (number: string) => void;
}) {
  return (
    <section className="rounded-xl border border-black/6 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-[-0.02em] text-[#10272c]">
            Recent calls
          </h3>
          <p className="mt-1 text-sm text-[#617477]">
            Completed inbound calls for this location.
          </p>
        </div>
        <span className="rounded-full border border-black/8 px-2.5 py-1 text-xs font-semibold text-[#617477]">
          {calls.length}
        </span>
      </div>

      {calls.length ? (
        <ul className="mt-4 divide-y divide-black/6 rounded-lg border border-black/6">
          {calls.map((call) => {
            const callbackTarget = call.fromPhone || "";

            return (
              <li
                className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                key={call.id}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <PhoneIncoming
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-[#0d7377]"
                    />
                    <p className="truncate text-sm font-semibold text-[#10272c]">
                      {formatQueuePhone(call.fromPhone)}
                    </p>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-[#617477]">
                    <span>{formatRecentCallTime(call.occurredAt)}</span>
                    {call.locationName ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{call.locationName}</span>
                      </>
                    ) : null}
                    {call.answeredBy ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{call.answeredBy}</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <Button
                  className="w-fit"
                  disabled={!callbackTarget}
                  onClick={() => {
                    if (callbackTarget) {
                      onCallback(callbackTarget);
                    }
                  }}
                  size="sm"
                  variant="secondary"
                >
                  <PhoneCall className="h-4 w-4" aria-hidden="true" />
                  Call back
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-black/10 px-3 py-6 text-center text-sm text-[#617477]">
          No completed inbound calls yet.
        </div>
      )}
    </section>
  );
}

function QueuePanel({
  canTake,
  isAvailable,
  onCallback,
  onTake,
  onTakeTransfer,
  queue,
  selectedSeatId,
  takingTransferIds,
}: {
  canTake: boolean;
  isAvailable: boolean;
  onCallback: (number: string) => void;
  onTake: (queueItemId: string) => void;
  onTakeTransfer: (queueItemId: string) => void;
  queue: PortalCallQueueItem[];
  selectedSeatId: string | null;
  takingTransferIds: Set<string>;
}) {
  const visibleQueue = queue.filter(
    (item) =>
      !item.transferRequest || item.transferRequest.targetSeatId === selectedSeatId,
  );

  return (
    <section className="rounded-xl border border-black/6 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-[-0.02em] text-[#10272c]">
            Live queue
          </h3>
          <p className="mt-1 text-sm text-[#617477]">
            Inbound callers for this location.
          </p>
        </div>
        <span className="rounded-full border border-black/8 px-2.5 py-1 text-xs font-semibold text-[#617477]">
          {visibleQueue.length}
        </span>
      </div>

      {visibleQueue.length ? (
        <ul className="mt-4 divide-y divide-black/6 rounded-lg border border-black/6">
          {visibleQueue.map((item) => (
            <li
              className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              key={item.id}
            >
              {(() => {
                const liveRingAttempt = hasLiveRingAttempt(item);
                const isTransferRequest =
                  item.transferRequest?.targetSeatId === selectedSeatId;
                const isTakeableStatus = ["WAITING", "RINGING", "ASSIGNED"].includes(
                  item.status,
                );
                const canManuallyTake = canTake && isTakeableStatus && !liveRingAttempt;
                const canTakeTransfer =
                  canTake && isTransferRequest && !liveRingAttempt;
                const isTakingTransfer = takingTransferIds.has(item.id);

                return (
                  <>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#10272c]">
                        {formatQueuePhone(item.fromPhone)}
                      </p>
                      <p className="mt-1 text-xs text-[#617477]">
                        {isTransferRequest ? "Transfer request" : queueStatusLabel(item.status)}
                        {isTransferRequest && item.transferRequest?.fromSeatLabel
                          ? ` from ${item.transferRequest.fromSeatLabel}`
                          : ""}
                        {item.locationName ? ` · ${item.locationName}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {liveRingAttempt ? (
                        <Button className="w-fit" disabled size="sm" variant="secondary">
                          Ringing
                        </Button>
                      ) : null}
                      {canManuallyTake ? (
                        <Button
                          className="w-fit"
                          disabled={!isAvailable}
                          onClick={() => onTake(item.id)}
                          size="sm"
                          variant="primary"
                        >
                          Take
                        </Button>
                      ) : null}
                      {canTakeTransfer ? (
                        <Button
                          className="w-fit"
                          disabled={!isAvailable || isTakingTransfer}
                          onClick={() => onTakeTransfer(item.id)}
                          size="sm"
                          variant="primary"
                        >
                          Take transfer
                        </Button>
                      ) : null}
                      {item.fromPhone ? (
                        <Button
                          className="w-fit"
                          onClick={() => onCallback(item.fromPhone || "")}
                          size="sm"
                          variant="secondary"
                        >
                          <PhoneOutgoing className="h-4 w-4" aria-hidden="true" />
                          Call back
                        </Button>
                      ) : null}
                    </div>
                  </>
                );
              })()}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-black/10 px-3 py-6 text-center text-sm text-[#617477]">
          No callers waiting.
        </div>
      )}
    </section>
  );
}
