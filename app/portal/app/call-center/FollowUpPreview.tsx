"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
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
import type {
  PortalCallActivityItem,
  PortalNeedsActionPreviewItem,
} from "@/lib/call-center/portal-model";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

import { callCenterResponse } from "./call-center-errors";

const PREVIEW_LIMIT = 15;
const PREVIEW_REFRESH_INTERVAL_MS = 60_000;
const PREVIEW_ACCESS_ERROR_CODES = new Set([
  "ACCESS_DENIED",
  "AUTH_REQUIRED",
  "QUEUE_UNAVAILABLE",
]);

type PreviewActivity = Omit<PortalCallActivityItem, "createdAt"> & {
  createdAt: string;
};
type PreviewItem = Omit<PortalNeedsActionPreviewItem, "activities" | "lastActivityAt"> & {
  activities: PreviewActivity[];
  lastActivityAt: string;
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

function isPreviewActivity(value: unknown): value is PreviewActivity {
  return (
    isRecord(value) &&
    typeof value.taskId === "string" &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    ["missed", "note", "voicemail"].includes(String(value.kind))
  );
}

function isPreviewItem(value: unknown): value is PreviewItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.eventCount === "number" &&
    typeof value.lastActivityAt === "string" &&
    Number.isFinite(Date.parse(value.lastActivityAt)) &&
    Array.isArray(value.taskIds) &&
    value.taskIds.length > 0 &&
    value.taskIds.every((taskId) => typeof taskId === "string") &&
    Array.isArray(value.activities) &&
    value.activities.length === value.eventCount &&
    value.activities.every(isPreviewActivity)
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
  const [expandedAudioTaskId, setExpandedAudioTaskId] = useState<string | null>(null);
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvingThreadId, setResolvingThreadId] = useState<string | null>(null);
  const mutationVersionRef = useRef(0);
  const readNowRef = useRef<() => void>(() => {});
  const retry = useCallback(() => readNowRef.current(), []);

  const resolvePhone = useCallback(
    async (item: PreviewItem) => {
      if (!item.fromPhone) return;
      setResolveError(null);
      setResolvingThreadId(item.id);
      try {
        const response = await fetch("/api/portal/call-center/follow-up-preview", {
          body: JSON.stringify({
            idempotencyKey: `resolve-preview:${item.taskIds[0]}`,
            ...(item.locationId ? { locationId: item.locationId } : {}),
            phone: item.fromPhone,
            queueId: item.queueId ?? queueId,
            taskIds: item.taskIds,
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
                items: current.items.filter((currentItem) => currentItem.id !== item.id),
              }
            : current,
        );
        setExpandedAudioTaskId(null);
        setExpandedThreadId(null);
        mutationVersionRef.current += 1;
        readNowRef.current();
      } catch (error) {
        const staleThread =
          error instanceof CallCenterRequestError &&
          error.operatorError.code === "SESSION_STALE";
        if (isPreviewAccessError(error)) {
          setModel((current) =>
            current.scopeKey === scopeKey ? { ...current, items: [] } : current,
          );
        }
        setResolveError(
          staleThread
            ? "New activity arrived for this caller. Review the refreshed thread before resolving."
            : "Couldn't mark this caller resolved. Try again.",
        );
        if (staleThread) readNowRef.current();
      } finally {
        setResolvingThreadId((current) => (current === item.id ? null : current));
      }
    },
    [queueId, scopeKey],
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
            The 15 most recent caller threads that need attention.
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
          {resolveError}
        </div>
      ) : null}

      {state.loading ? (
        <div className="px-5 py-8 text-center text-sm text-[var(--portal-muted)]">
          Loading follow-up items…
        </div>
      ) : state.items.length ? (
        <ul className="max-h-[17.25rem] divide-y divide-[var(--portal-border)] overflow-y-auto">
          {state.items.map((item) => {
            const presentation = threadPresentation(item);
            const title =
              item.callerName ||
              (item.fromPhone ? formatPhone(item.fromPhone) : "Unknown caller");
            const phoneLabel = item.callerName ? formatPhone(item.fromPhone || "") : null;
            const expanded = expandedThreadId === item.id;
            const resolving = resolvingThreadId === item.id;
            const summary = formatThreadSummary(item);

            return (
              <li className="px-4 py-2" key={item.id}>
                <div className="flex items-start gap-2">
                  <presentation.Icon
                    aria-hidden="true"
                    className={cn("mt-0.5 h-4 w-4 shrink-0", presentation.iconClassName)}
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      aria-label={`${expanded ? "Hide" : "Show"} details for ${title}`}
                      aria-expanded={expanded}
                      className="block w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--portal-accent)]"
                      onClick={() => {
                        setExpandedAudioTaskId(null);
                        setExpandedThreadId(expanded ? null : item.id);
                      }}
                      type="button"
                    >
                      <span className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--portal-ink)]">
                          {title}
                        </span>
                        {expanded ? (
                          <ChevronUp
                            aria-hidden="true"
                            className="h-3.5 w-3.5 text-[var(--portal-muted)]"
                          />
                        ) : (
                          <ChevronDown
                            aria-hidden="true"
                            className="h-3.5 w-3.5 text-[var(--portal-muted)]"
                          />
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--portal-muted)]">
                        {phoneLabel ? `${phoneLabel} · ` : ""}
                        <span className="font-medium text-[var(--portal-ink-soft)]">
                          {summary}
                        </span>
                        {` · ${formatRelative(item.lastActivityAt)}`}
                      </span>
                    </button>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
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
                      disabled={!item.fromPhone || resolvingThreadId !== null}
                      onClick={() => {
                        void resolvePhone(item);
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
                {expanded ? (
                  <ul className="ml-6 mt-2 space-y-1.5 border-l border-[var(--portal-border)] pl-3">
                    {item.activities.map((activity) => {
                      const activityPresentation = previewPresentation(activity);
                      return (
                        <li
                          className="text-xs text-[var(--portal-muted)]"
                          key={activity.taskId}
                        >
                          <span className="font-medium text-[var(--portal-ink-soft)]">
                            {activityPresentation.label}
                          </span>
                          {activity.durationSec
                            ? ` · ${formatDuration(activity.durationSec)}`
                            : ""}
                          {` · ${formatRelative(activity.createdAt)}`}
                          {activity.recordingId ? (
                            <Button
                              aria-label={`Play voicemail from ${title}`}
                              aria-pressed={expandedAudioTaskId === activity.taskId}
                              className="ml-1 h-6 w-6 p-0"
                              onClick={() =>
                                setExpandedAudioTaskId((current) =>
                                  current === activity.taskId ? null : activity.taskId,
                                )
                              }
                              size="sm"
                              title="Play voicemail"
                              variant="ghost"
                            >
                              <Play className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          ) : null}
                          {activity.recordingId &&
                          expandedAudioTaskId === activity.taskId ? (
                            <audio
                              autoPlay
                              className="mt-1 h-8 w-full"
                              controls
                              preload="none"
                              src={`/api/portal/call-center/voicemails/${activity.recordingId}`}
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
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

function threadPresentation(item: PreviewItem) {
  if (item.voicemailCount > 0) {
    return {
      Icon: VoicemailIcon,
      iconClassName: "text-[var(--portal-warning)]",
    };
  }
  if (item.noteCount > 0) {
    return {
      Icon: MessageSquareText,
      iconClassName: "text-[var(--portal-accent)]",
    };
  }
  return {
    Icon: PhoneMissed,
    iconClassName: "text-[var(--portal-danger)]",
  };
}

function previewPresentation(item: PreviewActivity) {
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

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatThreadSummary(item: PreviewItem) {
  const parts: string[] = [];
  if (item.voicemailCount) {
    parts.push(pluralize(item.voicemailCount, "voicemail"));
  }
  if (item.missedCount) {
    parts.push(pluralize(item.missedCount, "missed call"));
  }
  if (item.callbackNeededCount) {
    parts.push(
      pluralize(item.callbackNeededCount, "callback needed", "callbacks needed"),
    );
  }
  if (item.followUpRequiredCount) {
    parts.push(
      pluralize(item.followUpRequiredCount, "follow-up required", "follow-ups required"),
    );
  }
  return parts.join(" · ") || "Needs action";
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
