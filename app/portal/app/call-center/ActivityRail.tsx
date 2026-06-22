"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MessageSquareText,
  Phone,
  PhoneMissed,
  Play,
  Voicemail as VoicemailIcon,
} from "lucide-react";

import { Button } from "@/app/components/ui/button";
import type { PortalCallCenterTotals, PortalNeedsActionGroup } from "@/lib/call-center";
import { cn } from "@/lib/utils";

import { resolveNeedsActionGroupAction } from "./actions";

const FOLLOW_UP_PREVIEW_LIMIT = 25;

function formatPhone(phone: string | null) {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone || "No number";
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

function formatDuration(seconds: number | null) {
  if (seconds == null || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return minutes > 0
    ? `${minutes}m ${remaining.toString().padStart(2, "0")}s`
    : `${remaining}s`;
}

function formatRelative(date: Date) {
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "America/New_York",
  }).format(new Date(date));
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatGroupSummary(group: PortalNeedsActionGroup) {
  const parts: string[] = [];

  if (group.voicemailCount) {
    parts.push(pluralize(group.voicemailCount, "voicemail"));
  }

  if (group.missedCount) {
    parts.push(pluralize(group.missedCount, "missed call"));
  }

  if (group.callbackNeededCount) {
    parts.push(
      pluralize(group.callbackNeededCount, "callback needed", "callbacks needed"),
    );
  }

  if (group.followUpRequiredCount) {
    parts.push(
      pluralize(group.followUpRequiredCount, "follow-up required", "follow-ups required"),
    );
  }

  return parts.join(" · ");
}

export default function ActivityRail({
  followUpHref,
  needsAction,
  office,
  onCallback,
  stationLabel,
  stationSeatId,
  totals,
}: {
  followUpHref: string;
  needsAction: PortalNeedsActionGroup[];
  office?: string | null;
  onCallback: (number: string) => void;
  stationLabel?: string | null;
  stationSeatId?: string | null;
  totals: PortalCallCenterTotals;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedAudioId, setExpandedAudioId] = useState<string | null>(null);

  const visibleItems = needsAction.slice(0, FOLLOW_UP_PREVIEW_LIMIT);
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
            <ToggleIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--portal-muted)]" />
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--portal-ink)]">
                  Needs action
                </span>
                {totals.needsActionCallers ? (
                  <span className="rounded-full border border-[var(--portal-border)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--portal-muted)]">
                    {totals.needsActionCallers}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--portal-muted)]">
                Missed calls, voicemails, and notes that still need a response.
              </span>
            </span>
          </button>
          {totals.needsActionCallers ? (
            <Link
              className="shrink-0 text-xs font-semibold text-[var(--portal-accent)] transition hover:text-[var(--portal-accent-hover)]"
              href={followUpHref}
            >
              View all
            </Link>
          ) : null}
        </div>
      </header>

      {!isOpen ? null : needsAction.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-[var(--portal-muted)]">
          No items need action.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--portal-border)]">
          {visibleItems.map((group) => {
            const hasVoicemail = group.voicemailCount > 0;
            const hasNote = group.noteCount > 0;
            const Icon = hasVoicemail
              ? VoicemailIcon
              : hasNote
                ? MessageSquareText
                : PhoneMissed;
            const iconClassName = hasVoicemail
              ? "text-[var(--portal-warning)]"
              : hasNote
                ? "text-[var(--portal-accent)]"
                : "text-[var(--portal-danger)]";
            const callbackTarget = group.fromPhone || "";
            const duration = formatDuration(group.latestVoicemailDurationSec);
            const isSelected = selectedId === group.id;
            const isAudioOpen = expandedAudioId === group.id;
            const title = group.callerName || formatPhone(group.fromPhone);
            const phoneLabel = group.callerName ? formatPhone(group.fromPhone) : null;
            const historyHref = callerHistoryHref(group.fromPhone, office);
            const summary = formatGroupSummary(group) || "Needs action";

            return (
              <li key={group.id}>
                <article
                  className={cn(
                    "group px-4 py-3 transition",
                    isSelected ? "bg-[var(--portal-accent-soft)]" : "hover:bg-[var(--portal-panel-soft)]",
                  )}
                >
                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-2.5">
                      <Icon
                        aria-hidden="true"
                        className={cn("mt-0.5 h-4 w-4 shrink-0", iconClassName)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          {historyHref ? (
                            <Link
                              className="truncate text-sm font-semibold text-[var(--portal-ink)] hover:text-[var(--portal-accent)]"
                              href={historyHref}
                            >
                              {title}
                            </Link>
                          ) : (
                            <div className="truncate text-sm font-medium text-[var(--portal-ink)]">
                              {title}
                            </div>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--portal-muted)]">
                          {phoneLabel ? <span>{phoneLabel}</span> : null}
                          {phoneLabel ? <span aria-hidden="true">·</span> : null}
                          <span className="font-medium text-[var(--portal-ink-soft)]">{summary}</span>
                          {duration ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{duration}</span>
                            </>
                          ) : null}
                          <span aria-hidden="true">·</span>
                          <span>{formatRelative(group.lastActivityAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                      <Button
                        aria-label={`Call back ${title}`}
                        className="h-8 w-8 p-0 text-[var(--portal-muted)] hover:text-[var(--portal-accent)]"
                        disabled={!callbackTarget}
                        onClick={() => {
                          setSelectedId(group.id);
                          if (callbackTarget) {
                            onCallback(callbackTarget);
                          }
                        }}
                        size="sm"
                        title="Call back"
                        type="button"
                        variant="ghost"
                      >
                        <Phone className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      {group.latestVoicemailRecordingId ? (
                        <Button
                          aria-label="Play voicemail"
                          aria-pressed={isAudioOpen}
                          className="h-8 w-8 p-0"
                          onClick={() =>
                            setExpandedAudioId(isAudioOpen ? null : group.id)
                          }
                          size="sm"
                          title="Play voicemail"
                          type="button"
                          variant="ghost"
                        >
                          <Play className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      ) : null}
                      <form action={resolveNeedsActionGroupAction}>
                        {office ? (
                          <input type="hidden" name="office" value={office} />
                        ) : null}
                        {stationLabel ? (
                          <input type="hidden" name="stationLabel" value={stationLabel} />
                        ) : null}
                        {stationSeatId ? (
                          <input
                            type="hidden"
                            name="stationSeatId"
                            value={stationSeatId}
                          />
                        ) : null}
                        <input type="hidden" name="phone" value={group.fromPhone ?? ""} />
                        <Button
                          aria-label="Mark resolved"
                          className="h-8 w-8 p-0 text-[var(--portal-muted)] hover:text-[var(--portal-accent)]"
                          disabled={!group.fromPhone}
                          size="sm"
                          title="Mark resolved"
                          type="submit"
                          variant="ghost"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </form>
                    </div>
                  </div>
                  {group.latestVoicemailRecordingId && isAudioOpen ? (
                    <audio
                      autoPlay
                      className="mt-2 h-8 w-full max-w-xl"
                      controls
                      preload="none"
                      src={`/api/portal/call-center/voicemails/${group.latestVoicemailRecordingId}`}
                    />
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
