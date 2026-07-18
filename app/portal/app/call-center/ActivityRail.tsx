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

import { Button } from "@/components/ui/button";
import { PortalBadge } from "@/app/portal/app/PortalBadge";
import type { PortalNeedsActionGroup } from "@/lib/call-center/portal-model";
import { cn } from "@/lib/utils";

import { resolveNeedsActionGroupAction } from "./actions";

const FOLLOW_UP_PREVIEW_LIMIT = 3;

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

export function ActivityRail({
  followUpHref,
  needsAction,
  needsActionCount,
  office,
  onCallback,
  queueId,
}: {
  followUpHref: string;
  needsAction: PortalNeedsActionGroup[];
  needsActionCount: number;
  office?: string | null;
  onCallback: (number: string) => void;
  queueId?: string;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [expandedAudioId, setExpandedAudioId] = useState<string | null>(null);

  const visibleItems = needsAction.slice(0, FOLLOW_UP_PREVIEW_LIMIT);
  const ToggleIcon = isOpen ? ChevronDown : ChevronRight;

  return (
    <section
      aria-labelledby="needs-action-heading"
      className="overflow-hidden rounded-2xl border border-[var(--portal-border)] bg-white shadow-sm"
    >
      <header className="border-b border-[var(--portal-border)] bg-[var(--portal-panel-soft)] px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <button
            aria-expanded={isOpen}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--portal-accent)]/30"
            onClick={() => setIsOpen((current) => !current)}
            type="button"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-[var(--portal-muted)] shadow-sm ring-1 ring-[var(--portal-border)]">
              <ToggleIcon aria-hidden="true" className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span
                  className="text-sm font-semibold text-[var(--portal-ink)]"
                  id="needs-action-heading"
                >
                  Needs action
                </span>
                <PortalBadge
                  className="px-2 py-0.5 tabular-nums"
                  tone={needsActionCount ? "accent" : "soft"}
                >
                  {needsActionCount} open
                </PortalBadge>
              </span>
              <span className="mt-0.5 block text-xs text-[var(--portal-muted)]">
                Missed calls, voicemail, and follow-up.
              </span>
            </span>
          </button>
          {needsActionCount ? (
            <Button asChild className="shrink-0" size="compact" variant="ghost">
              <Link href={followUpHref}>
                View all
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      {!isOpen ? null : needsAction.length === 0 ? (
        <div className="px-5 py-9 text-center">
          <CheckCircle2 aria-hidden="true" className="mx-auto h-5 w-5 text-emerald-600" />
          <p className="mt-2 text-sm font-medium text-[var(--portal-ink)]">
            You’re all caught up.
          </p>
          <p className="mt-1 text-xs text-[var(--portal-muted)]">
            New follow-up items will appear here.
          </p>
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
              ? "bg-amber-50 text-amber-700"
              : hasNote
                ? "bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]"
                : "bg-red-50 text-red-700";
            const callbackTarget = group.fromPhone || "";
            const duration = formatDuration(group.latestVoicemailDurationSec);
            const isAudioOpen = expandedAudioId === group.id;
            const title = group.callerName || formatPhone(group.fromPhone);
            const phoneLabel = group.callerName ? formatPhone(group.fromPhone) : null;
            const historyHref = callerHistoryHref(group.fromPhone, office);
            const summary = formatGroupSummary(group) || "Needs action";

            return (
              <li key={group.id}>
                <article className="group px-4 py-4 transition hover:bg-[var(--portal-panel-soft)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-xl",
                          iconClassName,
                        )}
                      >
                        <Icon aria-hidden="true" className="h-4 w-4" />
                      </span>
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
                          <span className="font-medium text-[var(--portal-ink-soft)]">
                            {summary}
                          </span>
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
                    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                      <Button
                        aria-label={`Call ${title}`}
                        disabled={!callbackTarget}
                        onClick={() => {
                          if (callbackTarget) {
                            onCallback(callbackTarget);
                          }
                        }}
                        size="compact"
                        type="button"
                        variant="secondary"
                      >
                        <Phone className="h-4 w-4" aria-hidden="true" />
                        Call
                      </Button>
                      {group.latestVoicemailRecordingId ? (
                        <Button
                          aria-label={isAudioOpen ? "Hide voicemail" : "Play voicemail"}
                          aria-pressed={isAudioOpen}
                          onClick={() =>
                            setExpandedAudioId(isAudioOpen ? null : group.id)
                          }
                          size="compact"
                          type="button"
                          variant="ghost"
                        >
                          <Play className="h-4 w-4" aria-hidden="true" />
                          {isAudioOpen ? "Hide" : "Play"}
                        </Button>
                      ) : null}
                      <form action={resolveNeedsActionGroupAction}>
                        {office ? (
                          <input type="hidden" name="office" value={office} />
                        ) : null}
                        <input type="hidden" name="phone" value={group.fromPhone ?? ""} />
                        {queueId ? (
                          <input type="hidden" name="queue" value={queueId} />
                        ) : null}
                        <Button
                          aria-label={`Resolve ${title}`}
                          disabled={!group.fromPhone}
                          size="compact"
                          type="submit"
                          variant="ghost"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          Resolve
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
