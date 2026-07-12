"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CirclePause,
  MinusCircle,
  PhoneIncoming,
  PhoneOutgoing,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { PortalBadge } from "@/app/portal/app/PortalBadge";

import type {
  PortalCallCenterSeat,
  PortalCallCenterTotals,
  PortalCallQueueItem,
  PortalNeedsActionGroup,
  PortalOutboundCallerNumber,
  PortalRecentCallItem,
} from "@/lib/call-center";
import { isLegacyPresenceReadyForCalls } from "@/lib/call-center/legacy-presence";

import ActivityRail from "./ActivityRail";
import CanonicalShadowBridge from "./CanonicalShadowBridge";
import SoftphonePanel, { type SoftphoneHandle } from "./SoftphonePanel";
import {
  desiredPresenceStatus,
  readinessForStation,
  reportedPresenceStatus,
  resolveSoftphoneReadiness,
  type PresenceStatus,
  type SoftphoneReadiness,
} from "./call-center-readiness";

type PresenceSyncState = {
  acknowledgedStatus: PresenceStatus | null;
  phase: "idle" | "registering" | "online" | "failed";
  seatId: string | null;
};

const PRESENCE_HEARTBEAT_MS = 20_000;
const PRESENCE_REQUEST_TIMEOUT_MS = 8_000;

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
  configured,
  configurationMessage,
  enabled,
  eventLocationId,
  followUpHref,
  historyHref,
  initialDialNumber,
  inboundEnabled,
  needsAction,
  office,
  outboundCallerNumber,
  outboundCallerNumbers,
  queue,
  recentCalls,
  seats,
  shadowQueueId,
  totals,
  voicemailTimeoutSec,
}: {
  configured: boolean;
  configurationMessage: string;
  enabled: boolean;
  eventLocationId?: string | null;
  followUpHref: string;
  historyHref: string;
  initialDialNumber?: string | null;
  inboundEnabled: boolean;
  needsAction: PortalNeedsActionGroup[];
  office?: string | null;
  outboundCallerNumber: string;
  outboundCallerNumbers: PortalOutboundCallerNumber[];
  queue: PortalCallQueueItem[];
  recentCalls: PortalRecentCallItem[];
  seats: PortalCallCenterSeat[];
  shadowQueueId?: string | null;
  totals: PortalCallCenterTotals;
  voicemailTimeoutSec: number;
}) {
  const router = useRouter();
  const [browserSessionId] = useState(getInitialBrowserSessionId);
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>("AVAILABLE");
  const [seed, setSeed] = useState<{ value: string; token: number } | null>(null);
  const [selectedOutboundCallerNumber, setSelectedOutboundCallerNumber] =
    useState(outboundCallerNumber);
  const [selectedSeatId, setSelectedSeatId] = useState("");
  const [seatPreferenceLoaded, setSeatPreferenceLoaded] = useState(false);
  const [softphoneBusy, setSoftphoneBusy] = useState(false);
  const [softphoneEngaged, setSoftphoneEngaged] = useState(false);
  const [softphoneReadiness, setSoftphoneReadiness] = useState<SoftphoneReadiness>(() =>
    resolveSoftphoneReadiness({
      microphoneReady: false,
      providerReady: false,
      soundReady: false,
      stationId: null,
      stationSelected: false,
    }),
  );
  const [presenceSync, setPresenceSync] = useState<PresenceSyncState>({
    acknowledgedStatus: null,
    phase: "idle",
    seatId: null,
  });
  const [presenceRetryToken, setPresenceRetryToken] = useState(0);
  const [ringingCallerKeys, setRingingCallerKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [takingQueueIds, setTakingQueueIds] = useState<Set<string>>(() => new Set());
  const takingQueueIdsRef = useRef(new Set<string>());
  const softphoneRef = useRef<SoftphoneHandle | null>(null);
  const presenceWriteQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const selectedSeat = useMemo(
    () => seats.find((seat) => seat.id === selectedSeatId) ?? null,
    [seats, selectedSeatId],
  );
  const selectedStationId = selectedSeat?.id ?? null;
  const currentSoftphoneReadiness = readinessForStation(
    softphoneReadiness,
    selectedStationId,
    !seats.length || Boolean(selectedSeat),
  );
  const desiredStatus = desiredPresenceStatus({
    busy: softphoneBusy,
    requestedStatus: presenceStatus,
    softphoneReady: currentSoftphoneReadiness.ready,
  });
  const acknowledgedStatus =
    presenceSync.phase === "online" && presenceSync.seatId === selectedStationId
      ? presenceSync.acknowledgedStatus
      : null;
  const effectivePresenceStatus = reportedPresenceStatus({
    acknowledgedStatus,
    desiredStatus,
  });
  const presenceFailed =
    currentSoftphoneReadiness.ready &&
    presenceSync.phase === "failed" &&
    presenceSync.seatId === selectedStationId;
  const stationStatusMessage = !currentSoftphoneReadiness.ready
    ? currentSoftphoneReadiness.message
    : presenceFailed
      ? "Station is offline because its presence update failed."
      : effectivePresenceStatus === "AVAILABLE"
        ? "Ready to receive calls."
        : effectivePresenceStatus === "BUSY"
          ? "Busy."
          : effectivePresenceStatus === "PAUSED"
            ? "Paused."
            : "Registering this station.";
  const softphoneEnabled = enabled && (!seats.length || Boolean(selectedSeat));
  const sendPresence = useCallback(
    (seatId: string, status: PresenceStatus | "OFFLINE", readyForCalls = false) => {
      if (!browserSessionId) {
        return Promise.resolve(false);
      }

      const write = presenceWriteQueueRef.current.then(async () => {
        const controller = new AbortController();
        const timeout = window.setTimeout(
          () => controller.abort(),
          PRESENCE_REQUEST_TIMEOUT_MS,
        );

        try {
          const response = await fetch("/api/portal/call-center/presence", {
            body: JSON.stringify({
              browserSessionId,
              readyForCalls,
              seatId,
              status,
            }),
            headers: {
              "Content-Type": "application/json",
            },
            keepalive: status === "OFFLINE",
            method: "POST",
            signal: controller.signal,
          });

          return response.ok;
        } catch {
          return false;
        } finally {
          window.clearTimeout(timeout);
        }
      });

      presenceWriteQueueRef.current = write;
      return write;
    },
    [browserSessionId],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Sync a server-selected default into this legacy control.
    setSelectedOutboundCallerNumber(outboundCallerNumber);
  }, [outboundCallerNumber]);

  useEffect(() => {
    if (!initialDialNumber) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Navigation input intentionally seeds the imperative dialer.
    setSeed({ token: Date.now(), value: initialDialNumber });
  }, [initialDialNumber]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore the persisted legacy station selection after hydration.
    setSelectedSeatId((current) => {
      if (current && seats.some((seat) => seat.id === current)) {
        return current;
      }

      return getStoredSelectedSeatId(seats);
    });
    setSeatPreferenceLoaded(true);
  }, [seats]);

  useEffect(() => {
    if (!seatPreferenceLoaded) {
      return;
    }

    rememberSelectedSeatId(selectedSeatId);
  }, [seatPreferenceLoaded, selectedSeatId]);

  useEffect(() => {
    const seatId = selectedSeat?.id;

    if (!seatId || desiredStatus === "OFFLINE") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Clear legacy presence when its external station owner disappears.
      setPresenceSync({
        acknowledgedStatus: null,
        phase: "idle",
        seatId: seatId ?? null,
      });

      if (seatId) {
        void sendPresence(seatId, "OFFLINE");
      }

      return;
    }

    let cancelled = false;
    setPresenceSync({
      acknowledgedStatus: null,
      phase: "registering",
      seatId,
    });

    void sendPresence(
      seatId,
      desiredStatus,
      isLegacyPresenceReadyForCalls({
        readyForCalls: currentSoftphoneReadiness.ready,
        status: desiredStatus,
      }),
    ).then((ok) => {
      if (cancelled) {
        return;
      }

      if (!ok) {
        void sendPresence(seatId, "OFFLINE");
      }

      setPresenceSync({
        acknowledgedStatus: ok ? desiredStatus : null,
        phase: ok ? "online" : "failed",
        seatId,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    currentSoftphoneReadiness.ready,
    desiredStatus,
    presenceRetryToken,
    selectedSeat?.id,
    sendPresence,
  ]);

  useEffect(() => {
    const seatId = selectedSeat?.id;

    if (!seatId || !currentSoftphoneReadiness.ready) {
      return;
    }

    return () => {
      void sendPresence(seatId, "OFFLINE");
    };
  }, [currentSoftphoneReadiness.ready, selectedSeat?.id, sendPresence]);

  useEffect(() => {
    const seatId = selectedSeat?.id;

    if (
      !seatId ||
      desiredStatus === "OFFLINE" ||
      presenceSync.phase !== "online" ||
      presenceSync.seatId !== seatId ||
      presenceSync.acknowledgedStatus !== desiredStatus
    ) {
      return;
    }

    let stopped = false;
    let heartbeat: ReturnType<typeof setTimeout> | null = null;
    const scheduleHeartbeat = () => {
      heartbeat = setTimeout(() => {
        void sendPresence(
          seatId,
          desiredStatus,
          isLegacyPresenceReadyForCalls({
            readyForCalls: currentSoftphoneReadiness.ready,
            status: desiredStatus,
          }),
        ).then((ok) => {
          if (stopped) {
            return;
          }

          if (!ok) {
            setPresenceSync({
              acknowledgedStatus: null,
              phase: "failed",
              seatId,
            });
            void sendPresence(seatId, "OFFLINE");
            return;
          }

          scheduleHeartbeat();
        });
      }, PRESENCE_HEARTBEAT_MS);
    };

    scheduleHeartbeat();

    return () => {
      stopped = true;
      if (heartbeat) {
        clearTimeout(heartbeat);
      }
    };
  }, [
    currentSoftphoneReadiness.ready,
    desiredStatus,
    presenceSync.acknowledgedStatus,
    presenceSync.phase,
    presenceSync.seatId,
    selectedSeat?.id,
    sendPresence,
  ]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const query =
      eventLocationId === undefined
        ? ""
        : `?locationId=${encodeURIComponent(eventLocationId ?? "__NULL__")}`;
    const source = new EventSource(`/api/portal/call-center/events${query}`);
    const refresh = () => router.refresh();

    source.addEventListener("refresh", refresh);

    return () => {
      source.removeEventListener("refresh", refresh);
      source.close();
    };
  }, [enabled, eventLocationId, router]);

  const handleCallback = useCallback((number: string) => {
    setSeed({ token: Date.now(), value: number });
  }, []);
  const handleRingingCallerKeysChange = useCallback((callerKeys: readonly string[]) => {
    setRingingCallerKeys(new Set(callerKeys));
  }, []);
  const startTakingQueueItem = useCallback((queueItemId: string) => {
    if (takingQueueIdsRef.current.has(queueItemId)) {
      return false;
    }

    takingQueueIdsRef.current.add(queueItemId);
    setTakingQueueIds((current) => new Set(current).add(queueItemId));
    return true;
  }, []);
  const finishTakingQueueItem = useCallback((queueItemId: string) => {
    takingQueueIdsRef.current.delete(queueItemId);
    setTakingQueueIds((current) => {
      const next = new Set(current);
      next.delete(queueItemId);
      return next;
    });
  }, []);
  const handleTakeQueuedCall = useCallback(
    async (queueItemId: string) => {
      const selectedSeatId = selectedSeat?.id;

      if (!selectedSeatId || !startTakingQueueItem(queueItemId)) {
        return;
      }

      // Arm the softphone to auto-answer when the SIP INVITE arrives. The
      // Telnyx Call Control `client_state` we attach on the backend dial does
      // NOT propagate to the WebRTC SDK's call.options.clientState, so the
      // softphone's only stable identifier for this call is the caller's
      // E.164 number (resolved from the INVITE's remoteCallerNumber).
      const item = queue.find((entry) => entry.id === queueItemId);
      const callerKey = normalizeQueueCallerKey(item?.fromPhone);
      const hasLocalCall = callerKey
        ? (softphoneRef.current?.markAnswerPending(callerKey) ?? false)
        : false;

      if (hasLocalCall) {
        finishTakingQueueItem(queueItemId);
        router.refresh();
        return;
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
      } catch {
        if (callerKey) {
          softphoneRef.current?.clearAnswerPending(callerKey);
        }

        console.error("[call-center] failed to take queued call");
      } finally {
        finishTakingQueueItem(queueItemId);
        router.refresh();
      }
    },
    [
      browserSessionId,
      finishTakingQueueItem,
      queue,
      router,
      selectedSeat,
      startTakingQueueItem,
    ],
  );
  const handleTakeTransfer = useCallback(
    async (queueItemId: string) => {
      const selectedSeatId = selectedSeat?.id;

      if (!selectedSeatId || !startTakingQueueItem(queueItemId)) {
        return;
      }

      const item = queue.find((entry) => entry.id === queueItemId);
      const callerKey = normalizeQueueCallerKey(item?.fromPhone);
      const hasLocalCall = callerKey
        ? (softphoneRef.current?.markAnswerPending(callerKey) ?? false)
        : false;

      if (hasLocalCall) {
        finishTakingQueueItem(queueItemId);
        router.refresh();
        return;
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
      } catch {
        if (callerKey) {
          softphoneRef.current?.clearAnswerPending(callerKey);
        }

        console.error("[call-center] failed to take transfer");
      } finally {
        finishTakingQueueItem(queueItemId);
        router.refresh();
      }
    },
    [
      browserSessionId,
      finishTakingQueueItem,
      queue,
      router,
      selectedSeat,
      startTakingQueueItem,
    ],
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
    <div className="space-y-4">
      {shadowQueueId ? (
        <CanonicalShadowBridge
          audioReady={currentSoftphoneReadiness.soundReady}
          connectionState={
            currentSoftphoneReadiness.providerReady ? "READY" : "CONNECTING"
          }
          endpointId={selectedSeat?.id ?? null}
          microphoneReady={currentSoftphoneReadiness.microphoneReady}
          presence={effectivePresenceStatus}
          queueId={shadowQueueId}
        />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {inboundEnabled ? (
            <QueuePanel
              canTake={Boolean(selectedSeat) && currentSoftphoneReadiness.ready}
              isAvailable={effectivePresenceStatus === "AVAILABLE"}
              onTake={handleTakeQueuedCall}
              onTakeTransfer={handleTakeTransfer}
              queue={queue}
              ringingCallerKeys={ringingCallerKeys}
              selectedSeatId={selectedSeat?.id ?? null}
              takingQueueIds={takingQueueIds}
            />
          ) : null}
          <ActivityRail
            followUpHref={followUpHref}
            needsAction={needsAction}
            office={office}
            onCallback={handleCallback}
            stationLabel={selectedSeat ? formatSeatLabel(selectedSeat) : null}
            stationSeatId={selectedSeat?.id ?? null}
            totals={totals}
          />
          <HistoryPanel
            calls={recentCalls}
            historyHref={historyHref}
            office={office}
            total={totals.historyCalls}
          />
        </div>
        <div className="scroll-mt-4" id="softphone">
          {enabled && configured ? (
            <div className="space-y-3">
              {seats.length ? (
                <section className="rounded-xl border border-[var(--portal-border)] bg-white p-4 shadow-sm">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-[var(--portal-ink)]">
                      Station console
                    </h3>
                  </div>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-[var(--portal-ink)]">
                    Station
                    <select
                      className="h-10 rounded-lg border border-[var(--portal-border)] bg-white px-3 text-sm text-[var(--portal-ink)] outline-none transition focus:border-[var(--portal-accent)] disabled:cursor-not-allowed disabled:bg-[var(--portal-panel)] disabled:text-[var(--portal-muted-soft)]"
                      disabled={softphoneEngaged}
                      onChange={(event) => setSelectedSeatId(event.target.value)}
                      value={selectedSeat?.id ?? ""}
                    >
                      <option value="">Choose a station</option>
                      {seats.map((seat) => (
                        <option key={seat.id} value={seat.id}>
                          {formatSeatLabel(seat)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    {presenceOptions.map((option) => {
                      const Icon = option.icon;
                      const selected = effectivePresenceStatus === option.value;
                      const disabled =
                        !selectedSeat ||
                        !currentSoftphoneReadiness.ready ||
                        (softphoneBusy && option.value !== "BUSY");

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
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p
                      className={
                        presenceFailed
                          ? "text-xs text-[var(--portal-danger)]"
                          : "text-xs text-[var(--portal-muted)]"
                      }
                      role={presenceFailed ? "alert" : "status"}
                    >
                      {stationStatusMessage}
                    </p>
                    {presenceFailed ? (
                      <Button
                        className="shrink-0"
                        onClick={() => setPresenceRetryToken((token) => token + 1)}
                        size="sm"
                        variant="secondary"
                      >
                        Retry
                      </Button>
                    ) : null}
                  </div>
                </section>
              ) : null}
              {outboundCallerNumbers.length > 1 ? (
                <section className="rounded-xl border border-[var(--portal-border)] bg-white p-4 shadow-sm">
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-[var(--portal-ink)]">
                    Outbound number
                    <select
                      className="h-10 rounded-lg border border-[var(--portal-border)] bg-white px-3 text-sm text-[var(--portal-ink)] outline-none transition focus:border-[var(--portal-accent)]"
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
                enabled={softphoneEnabled}
                inboundEnabled={inboundEnabled}
                office={office}
                onActivityChange={setSoftphoneEngaged}
                onBusyChange={setSoftphoneBusy}
                onReadinessChange={setSoftphoneReadiness}
                onRingingCallerKeysChange={handleRingingCallerKeysChange}
                ref={softphoneRef}
                seedNumber={seed}
                stationLabel={selectedSeat ? formatSeatLabel(selectedSeat) : null}
                stationRequired={seats.length > 0}
                stationSeatId={selectedSeat?.id ?? null}
                transferTargets={seats}
                voicemailTimeoutSec={voicemailTimeoutSec}
              />
            </div>
          ) : (
            <section className="rounded-xl border border-[var(--portal-border)] bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-[var(--portal-ink)]">
                Softphone standby
              </h3>
              <p className="mt-2 text-sm text-[var(--portal-muted)]">
                {enabled
                  ? configurationMessage
                  : "Enable the call center to start placing and receiving calls in the browser."}
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function getInitialBrowserSessionId() {
  return typeof window === "undefined" ? "" : getBrowserSessionId();
}

function getStoredSelectedSeatId(seats: PortalCallCenterSeat[]) {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const stored = window.localStorage.getItem("acuity-call-center-selected-seat-id");
    return stored && seats.some((seat) => seat.id === stored) ? stored : "";
  } catch {
    return "";
  }
}

function rememberSelectedSeatId(seatId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (seatId) {
      window.localStorage.setItem("acuity-call-center-selected-seat-id", seatId);
    } else {
      window.localStorage.removeItem("acuity-call-center-selected-seat-id");
    }
  } catch {
    // Local storage can be unavailable in private or locked-down browsers.
  }
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

  return phone || "Unknown number";
}

function callerHistoryHref(phone: string | null, office?: string | null) {
  if (!phone) {
    return null;
  }

  const params = new URLSearchParams();

  if (office) {
    params.set("office", office);
  }

  const query = params.toString();
  return `/portal/app/call-center/callers/${encodeURIComponent(phone)}${
    query ? `?${query}` : ""
  }`;
}

function formatSeatLabel(seat: PortalCallCenterSeat) {
  return seat.extension ? `${seat.extension} - ${seat.label}` : seat.label;
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

function formatCallDuration(seconds: number | null) {
  if (seconds == null || seconds < 0) {
    return null;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return minutes > 0
    ? `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`
    : `${remainingSeconds}s`;
}

function recentCallStatusLabel(call: PortalRecentCallItem) {
  return call.direction === "OUTBOUND" ? "Outbound" : "Inbound";
}

function hasLiveRingAttempt(item: PortalCallQueueItem) {
  return item.ringAttempts.some((attempt) =>
    ["DIALING", "RINGING", "ANSWERED"].includes(attempt.status),
  );
}

function HistoryPanel({
  calls,
  historyHref,
  office,
  total,
}: {
  calls: PortalRecentCallItem[];
  historyHref: string;
  office?: string | null;
  total: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ToggleIcon = isOpen ? ChevronDown : ChevronRight;

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--portal-border)] bg-white shadow-sm">
      <header className="border-b border-[var(--portal-border)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <button
            aria-expanded={isOpen}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => setIsOpen((current) => !current)}
            type="button"
          >
            <ToggleIcon
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-[var(--portal-muted)]"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--portal-ink)]">
                  Connections
                </span>
                {total ? (
                  <PortalBadge className="px-2 py-0.5 tabular-nums">{total}</PortalBadge>
                ) : null}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--portal-muted)]">
                Connected inbound and outbound calls.
              </span>
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              className="text-xs font-semibold text-[var(--portal-accent)] transition hover:text-[var(--portal-accent-hover)]"
              href={historyHref}
            >
              View all
            </Link>
          </div>
        </div>
      </header>

      {!isOpen ? null : calls.length ? (
        <ul className="divide-y divide-[var(--portal-border)]">
          {calls.map((call) => {
            const isOutbound = call.direction === "OUTBOUND";
            const patientPhone = isOutbound ? call.toPhone : call.fromPhone;
            const historyHref = callerHistoryHref(patientPhone, office);
            const DirectionIcon = isOutbound ? PhoneOutgoing : PhoneIncoming;
            const duration = formatCallDuration(call.durationSec);

            return (
              <li
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                key={call.id}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <DirectionIcon
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-[var(--portal-accent)]"
                    />
                    {historyHref ? (
                      <Link
                        className="block truncate text-sm font-semibold text-[var(--portal-accent)] underline-offset-2 hover:underline"
                        href={historyHref}
                      >
                        {formatQueuePhone(patientPhone)}
                      </Link>
                    ) : (
                      <p className="truncate text-sm font-semibold text-[var(--portal-ink)]">
                        {formatQueuePhone(patientPhone)}
                      </p>
                    )}
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--portal-muted)]">
                    <span>{recentCallStatusLabel(call)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatRecentCallTime(call.occurredAt)}</span>
                    {duration ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{duration}</span>
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
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-5 py-8 text-center text-sm text-[var(--portal-muted)]">
          No connected calls yet.
        </div>
      )}
    </section>
  );
}

function QueuePanel({
  canTake,
  isAvailable,
  onTake,
  onTakeTransfer,
  queue,
  ringingCallerKeys,
  selectedSeatId,
  takingQueueIds,
}: {
  canTake: boolean;
  isAvailable: boolean;
  onTake: (queueItemId: string) => void;
  onTakeTransfer: (queueItemId: string) => void;
  queue: PortalCallQueueItem[];
  ringingCallerKeys: Set<string>;
  selectedSeatId: string | null;
  takingQueueIds: Set<string>;
}) {
  const visibleQueue = queue.filter((item) => {
    if (item.transferRequest) {
      return item.transferRequest.targetSeatId === selectedSeatId;
    }

    return ["WAITING", "RINGING", "ASSIGNED"].includes(item.status);
  });

  return (
    <section className="rounded-xl border border-[var(--portal-border)] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--portal-ink)]">Live queue</h3>
          <p className="mt-1 text-sm text-[var(--portal-muted)]">
            Live callers that need an answer.
          </p>
        </div>
        <PortalBadge>{visibleQueue.length}</PortalBadge>
      </div>

      {visibleQueue.length ? (
        <ul className="mt-4 divide-y divide-[var(--portal-border)] rounded-lg border border-[var(--portal-border)]">
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
                const callerKey = normalizeQueueCallerKey(item.fromPhone);
                const locallyRinging = ringingCallerKeys.has(callerKey);
                const isRinging =
                  locallyRinging || liveRingAttempt || item.status === "RINGING";
                const showTake = isTakeableStatus && !isTransferRequest;
                const showTakeTransfer = isTransferRequest;
                const isTaking = takingQueueIds.has(item.id);
                const takeDisabled =
                  !canTake || (!isAvailable && !locallyRinging) || isTaking;

                return (
                  <>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--portal-ink)]">
                        {formatQueuePhone(item.fromPhone)}
                      </p>
                      <p className="mt-1 text-xs text-[var(--portal-muted)]">
                        {isTransferRequest
                          ? "Transfer request"
                          : queueStatusLabel(item.status)}
                        {isTransferRequest && item.transferRequest?.fromSeatLabel
                          ? ` from ${item.transferRequest.fromSeatLabel}`
                          : ""}
                        {item.locationName ? ` · ${item.locationName}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {isRinging ? (
                        <Button className="w-fit" disabled size="sm" variant="secondary">
                          Ringing
                        </Button>
                      ) : null}
                      {showTake ? (
                        <Button
                          className="w-fit"
                          disabled={takeDisabled}
                          onClick={() => onTake(item.id)}
                          size="sm"
                          variant="primary"
                        >
                          {isTaking ? "Taking" : "Take"}
                        </Button>
                      ) : null}
                      {showTakeTransfer ? (
                        <Button
                          className="w-fit"
                          disabled={takeDisabled}
                          onClick={() => onTakeTransfer(item.id)}
                          size="sm"
                          variant="primary"
                        >
                          {isTaking ? "Taking" : "Take transfer"}
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
        <div className="mt-4 rounded-lg border border-dashed border-[var(--portal-border-strong)] px-3 py-4 text-center text-sm text-[var(--portal-muted)]">
          No callers waiting.
        </div>
      )}
    </section>
  );
}
