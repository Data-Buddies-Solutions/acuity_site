"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  MessageSquareText,
  Phone,
  PhoneMissed,
  Play,
  RefreshCw,
  Voicemail as VoicemailIcon,
} from "lucide-react";

import { PortalBadge } from "@/app/portal/app/PortalBadge";
import { Button } from "@/components/ui/button";
import { CallCenterRequestError } from "@/lib/call-center/operator-error";
import type { PortalNeedsActionPreviewItem } from "@/lib/call-center/portal-model";
import { formatPhone } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

import { callCenterResponse } from "./call-center-errors";

const PREVIEW_LIMIT = 15;
const PREVIEW_REFRESH_INTERVAL_MS = 60_000;
const PREVIEW_ACCESS_ERROR_CODES = new Set([
  "ACCESS_DENIED",
  "AUTH_REQUIRED",
  "QUEUE_UNAVAILABLE",
]);

type PreviewItem = Omit<PortalNeedsActionPreviewItem, "createdAt"> & {
  createdAt: string;
};

type PreviewResponse = {
  items: PreviewItem[];
  limit: number;
};

type ResolveResponse = {
  ok: true;
  resolvedCount: number;
};

type PreviewState = {
  error: Error | null;
  items: PreviewItem[];
  loading: boolean;
  scopeKey: string;
};

const initialState: PreviewState = {
  error: null,
  items: [],
  loading: true,
  scopeKey: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPreviewItem(value: unknown): value is PreviewItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    ["missed", "note", "voicemail"].includes(String(value.kind))
  );
}

function isPreviewResponse(value: unknown): value is PreviewResponse {
  return (
    isRecord(value) &&
    value.limit === PREVIEW_LIMIT &&
    Array.isArray(value.items) &&
    value.items.length <= PREVIEW_LIMIT &&
    value.items.every(isPreviewItem)
  );
}

function isResolveResponse(value: unknown): value is ResolveResponse {
  return isRecord(value) && value.ok === true && typeof value.resolvedCount === "number";
}

function isPreviewAccessError(error: unknown) {
  return (
    error instanceof CallCenterRequestError &&
    PREVIEW_ACCESS_ERROR_CODES.has(error.operatorError.code)
  );
}

export default function FollowUpPreview({
  followUpHref,
  locationId,
  onCallback,
  queueId,
  refreshIntervalMs = PREVIEW_REFRESH_INTERVAL_MS,
}: {
  followUpHref: string;
  locationId?: string | null;
  onCallback: (number: string) => void;
  queueId: string;
  refreshIntervalMs?: number;
}) {
  const scopeKey = `${locationId ?? "all"}:${queueId}`;
  const [model, setModel] = useState(initialState);
  const [expandedAudioId, setExpandedAudioId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState(false);
  const [resolvingPhone, setResolvingPhone] = useState<string | null>(null);
  const mutationVersionRef = useRef(0);
  const readNowRef = useRef<() => void>(() => {});
  const retry = useCallback(() => readNowRef.current(), []);

  const resolvePhone = useCallback(
    async (phone: string) => {
      const phoneKey = normalizePhone(phone) || phone;
      setResolveError(false);
      setResolvingPhone(phoneKey);
      try {
        const response = await fetch("/api/portal/call-center/follow-up-preview", {
          body: JSON.stringify({
            ...(locationId ? { locationId } : {}),
            phone,
            queueId,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const data: unknown = await callCenterResponse(response);
        if (!isResolveResponse(data)) {
          throw new Error("Resolve follow-up returned an incompatible response");
        }
        setModel((current) =>
          current.scopeKey === scopeKey
            ? {
                ...current,
                items: current.items.filter(
                  (item) =>
                    (normalizePhone(item.fromPhone) || item.fromPhone) !== phoneKey,
                ),
              }
            : current,
        );
        setExpandedAudioId(null);
        mutationVersionRef.current += 1;
        readNowRef.current();
      } catch (error) {
        if (isPreviewAccessError(error)) {
          setModel((current) =>
            current.scopeKey === scopeKey ? { ...current, items: [] } : current,
          );
        }
        setResolveError(true);
      } finally {
        setResolvingPhone((current) => (current === phoneKey ? null : current));
      }
    },
    [locationId, queueId, scopeKey],
  );

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let inFlight = false;
    let readQueued = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (!active) return;
      timer = setTimeout(read, refreshIntervalMs);
    };

    const readNow = () => {
      if (!active) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (inFlight) {
        readQueued = true;
        return;
      }
      void read();
    };

    async function read() {
      if (!active || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      const requestMutationVersion = mutationVersionRef.current;
      const parameters = new URLSearchParams({ queueId });
      if (locationId) parameters.set("locationId", locationId);

      try {
        const response = await fetch(
          `/api/portal/call-center/follow-up-preview?${parameters}`,
          { signal: controller.signal },
        );
        const data: unknown = await callCenterResponse(response);
        if (!isPreviewResponse(data)) {
          throw new Error("Follow-up preview returned an incompatible response");
        }
        if (!active) return;
        if (requestMutationVersion !== mutationVersionRef.current) {
          readQueued = true;
          return;
        }
        setModel({ error: null, items: data.items, loading: false, scopeKey });
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        if (requestMutationVersion !== mutationVersionRef.current) {
          readQueued = true;
          return;
        }
        const nextError =
          error instanceof Error ? error : new Error("Failed to load follow-up preview");
        const accessDenied = isPreviewAccessError(error);
        setModel((current) => ({
          error: nextError,
          items: accessDenied || current.scopeKey !== scopeKey ? [] : current.items,
          loading: false,
          scopeKey,
        }));
      } finally {
        inFlight = false;
        controller = null;
        if (!active) return;
        if (readQueued) {
          readQueued = false;
          queueMicrotask(readNow);
        } else {
          schedule();
        }
      }
    }

    readNowRef.current = readNow;
    queueMicrotask(readNow);

    return () => {
      active = false;
      readNowRef.current = () => {};
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [locationId, queueId, refreshIntervalMs, scopeKey]);

  const state = model.scopeKey === scopeKey ? model : { ...initialState, scopeKey };

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--portal-border)] bg-white shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--portal-border)] px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--portal-ink)]">
              Needs action
            </h2>
            {!state.loading && state.items.length ? (
              <PortalBadge className="px-2 py-0.5 tabular-nums">
                {state.items.length} recent
              </PortalBadge>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-[var(--portal-muted)]">
            The 15 most recent missed calls, voicemails, and follow-ups.
          </p>
        </div>
        <Link
          className="shrink-0 text-xs font-semibold text-[var(--portal-accent)] transition hover:text-[var(--portal-accent-hover)]"
          href={followUpHref}
          prefetch={false}
        >
          View all
        </Link>
      </header>

      {state.error ? (
        <div
          className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-950"
          role="status"
        >
          <span>Follow-up preview delayed. Calling is unaffected.</span>
          <Button onClick={retry} size="sm" variant="secondary">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      ) : null}

      {resolveError ? (
        <div
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950"
          role="status"
        >
          Couldn&apos;t mark this caller resolved. Try again.
        </div>
      ) : null}

      {state.loading ? (
        <div className="px-5 py-8 text-center text-sm text-[var(--portal-muted)]">
          Loading follow-up items…
        </div>
      ) : state.items.length ? (
        <ul className="max-h-[17.25rem] divide-y divide-[var(--portal-border)] overflow-y-auto">
          {state.items.map((item) => {
            const presentation = previewPresentation(item);
            const title =
              item.callerName ||
              (item.fromPhone ? formatPhone(item.fromPhone) : "Unknown caller");
            const phoneLabel = item.callerName ? formatPhone(item.fromPhone || "") : null;
            const audioOpen = expandedAudioId === item.id;
            const phoneKey = normalizePhone(item.fromPhone) || item.fromPhone;
            const resolving = Boolean(phoneKey && resolvingPhone === phoneKey);

            return (
              <li className="px-4 py-2" key={item.id}>
                <div className="flex items-start gap-2">
                  <presentation.Icon
                    aria-hidden="true"
                    className={cn("mt-0.5 h-4 w-4 shrink-0", presentation.iconClassName)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--portal-ink)]">
                      {title}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--portal-muted)]">
                      {phoneLabel ? `${phoneLabel} · ` : ""}
                      <span className="font-medium text-[var(--portal-ink-soft)]">
                        {presentation.label}
                      </span>
                      {item.durationSec ? ` · ${formatDuration(item.durationSec)}` : ""}
                      {` · ${formatRelative(item.createdAt)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {item.recordingId ? (
                      <Button
                        aria-label={`Play voicemail from ${title}`}
                        aria-pressed={audioOpen}
                        className="h-7 w-7 p-0"
                        onClick={() => setExpandedAudioId(audioOpen ? null : item.id)}
                        size="sm"
                        title="Play voicemail"
                        variant="ghost"
                      >
                        <Play className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                    <Button
                      aria-label={`Call back ${title}`}
                      className="h-7 w-7 p-0"
                      disabled={!item.fromPhone}
                      onClick={() => {
                        if (item.fromPhone) onCallback(item.fromPhone);
                      }}
                      size="sm"
                      title="Call back"
                      variant="ghost"
                    >
                      <Phone className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label={`Mark ${title} resolved`}
                      className="h-7 w-7 p-0 text-[var(--portal-muted)] hover:text-[var(--portal-accent)]"
                      disabled={!item.fromPhone || resolvingPhone !== null}
                      onClick={() => {
                        if (item.fromPhone) void resolvePhone(item.fromPhone);
                      }}
                      size="sm"
                      title="Mark resolved"
                      variant="ghost"
                    >
                      {resolving ? (
                        <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
                {item.recordingId && audioOpen ? (
                  <audio
                    autoPlay
                    className="mt-2 h-8 w-full"
                    controls
                    preload="none"
                    src={`/api/portal/call-center/voicemails/${item.recordingId}`}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : state.error ? null : (
        <div className="px-5 py-8 text-center text-sm text-[var(--portal-muted)]">
          No missed calls, voicemails, or follow-ups need action.
        </div>
      )}
    </section>
  );
}

function previewPresentation(item: PreviewItem) {
  if (item.kind === "voicemail") {
    return {
      Icon: VoicemailIcon,
      iconClassName: "text-[var(--portal-warning)]",
      label: "Voicemail",
    };
  }
  if (item.kind === "missed") {
    return {
      Icon: PhoneMissed,
      iconClassName: "text-[var(--portal-danger)]",
      label: "Missed call",
    };
  }
  return {
    Icon: MessageSquareText,
    iconClassName: "text-[var(--portal-accent)]",
    label:
      item.disposition === "CALLBACK_NEEDED"
        ? "Callback needed"
        : item.disposition === "FOLLOW_UP_REQUIRED"
          ? "Follow-up required"
          : "Note",
  };
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes
    ? `${minutes}m ${remainder.toString().padStart(2, "0")}s`
    : `${remainder}s`;
}

function formatRelative(value: string) {
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 60_000),
  );
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
