"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  MessageSquareText,
  Phone,
  PhoneMissed,
  Voicemail as VoicemailIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { PortalBadge } from "@/app/portal/app/PortalBadge";
import type { PortalNeedsActionGroup } from "@/lib/call-center/portal-model";
import { cn } from "@/lib/utils";

import { resolveNeedsActionGroupAction } from "../actions";

type FollowUpCommandCenterProps = {
  office?: string;
  page: number;
  queue?: string;
  threads: PortalNeedsActionGroup[];
  totalPages: number;
  totalThreads: number;
};

export default function FollowUpCommandCenter({
  office,
  page,
  queue,
  threads,
  totalPages,
  totalThreads,
}: FollowUpCommandCenterProps) {
  const [selectedId, setSelectedId] = useState(threads[0]?.id ?? "");
  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedId) ?? threads[0] ?? null,
    [selectedId, threads],
  );

  return (
    <section className="grid overflow-hidden rounded-xl border border-[var(--portal-border)] bg-white shadow-sm lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 border-b border-[var(--portal-border)] lg:border-b-0 lg:border-r">
        <header className="flex flex-col gap-3 border-b border-[var(--portal-border)] bg-[var(--portal-panel-soft)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--portal-ink)]">
              Needs action
            </h2>
            <p className="mt-0.5 text-xs text-[var(--portal-muted)]">
              Missed calls, voicemails, and notes that still need a response.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PortalBadge>
              {totalThreads} {totalThreads === 1 ? "thread" : "threads"}
            </PortalBadge>
            <PaginationControls
              office={office}
              page={page}
              queue={queue}
              totalPages={totalPages}
            />
          </div>
        </header>

        {threads.length ? (
          <ul className="divide-y divide-[var(--portal-border)]">
            {threads.map((group) => (
              <FollowUpQueueRow
                group={group}
                isSelected={selectedThread?.id === group.id}
                key={group.id}
                office={office}
                onSelect={() => setSelectedId(group.id)}
                queue={queue}
              />
            ))}
          </ul>
        ) : (
          <div className="px-5 py-12 text-center text-sm text-[var(--portal-muted)]">
            No items need action.
          </div>
        )}
      </div>

      <FollowUpWorkPanel office={office} queue={queue} thread={selectedThread} />
    </section>
  );
}

function FollowUpQueueRow({
  group,
  isSelected,
  office,
  onSelect,
  queue,
}: {
  group: PortalNeedsActionGroup;
  isSelected: boolean;
  office?: string;
  onSelect: () => void;
  queue?: string;
}) {
  const { Icon, iconClassName } = followUpIcon(group);
  const title = group.callerName || formatPhone(group.fromPhone);
  const phoneLabel = group.callerName ? formatPhone(group.fromPhone) : null;
  const summary = formatGroupSummary(group) || "Needs action";
  const duration = formatDuration(group.latestVoicemailDurationSec);
  const numberHref = callerHistoryHref(group.fromPhone, office);
  const callHref = group.fromPhone
    ? commandCenterCallHref(group.fromPhone, office, queue)
    : null;

  return (
    <li
      className={cn(
        "group px-4 py-3 transition hover:bg-[var(--portal-panel-soft)]",
        isSelected ? "bg-[var(--portal-accent-soft)]" : "",
      )}
    >
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <button
            aria-current={isSelected ? "true" : undefined}
            className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md border-0 bg-transparent p-0 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--portal-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            onClick={onSelect}
            type="button"
          >
            <Icon
              aria-hidden="true"
              className={cn("mt-0.5 h-4 w-4 shrink-0", iconClassName)}
            />
            <span className="min-w-0 flex-1">
              <span className="truncate text-sm font-semibold text-[var(--portal-ink)]">
                {title}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--portal-muted)]">
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
              </span>
            </span>
          </button>
          {numberHref ? (
            <Link
              className="shrink-0 rounded-sm text-xs font-semibold text-[var(--portal-accent)] transition hover:text-[var(--portal-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--portal-accent)]"
              href={numberHref}
            >
              History
            </Link>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:justify-end">
          {callHref ? (
            <Button
              asChild
              className="h-8 w-8 p-0 text-[var(--portal-muted)] hover:text-[var(--portal-accent)]"
              size="sm"
              title="Call back"
              variant="ghost"
            >
              <Link aria-label={`Call back ${title}`} href={callHref}>
                <Phone className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button
              aria-label="Call back"
              className="h-8 w-8 p-0 text-[var(--portal-muted)]"
              disabled
              size="sm"
              title="Call back"
              variant="ghost"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
          <ResolveIconButton office={office} phone={group.fromPhone} queue={queue} />
        </div>
      </div>
    </li>
  );
}

function FollowUpWorkPanel({
  office,
  queue,
  thread,
}: {
  office?: string;
  queue?: string;
  thread: PortalNeedsActionGroup | null;
}) {
  if (!thread) {
    return (
      <aside className="bg-[var(--portal-panel-soft)] px-5 py-8 text-center text-sm text-[var(--portal-muted)]">
        Select an outstanding item to start follow-up.
      </aside>
    );
  }

  const { Icon, iconClassName } = followUpIcon(thread);
  const title = thread.callerName || formatPhone(thread.fromPhone);
  const phoneLabel = thread.callerName ? formatPhone(thread.fromPhone) : null;
  const summary = formatGroupSummary(thread) || "Needs action";
  const callHref = thread.fromPhone
    ? commandCenterCallHref(thread.fromPhone, office, queue)
    : null;
  const numberHref = callerHistoryHref(thread.fromPhone, office);

  return (
    <aside className="bg-[var(--portal-panel-soft)]">
      <div className="sticky top-4 space-y-4 p-4">
        <section className="rounded-xl border border-[var(--portal-border)] bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <Icon
              aria-hidden="true"
              className={cn("mt-1 h-4 w-4 shrink-0", iconClassName)}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-[var(--portal-ink)]">
                {title}
              </p>
              {phoneLabel ? (
                <p className="mt-0.5 text-sm text-[var(--portal-muted)]">{phoneLabel}</p>
              ) : null}
              <p className="mt-2 text-sm font-medium text-[var(--portal-ink-soft)]">
                {summary}
              </p>
              <p className="mt-1 text-xs text-[var(--portal-muted)]">
                Last activity {formatRelative(thread.lastActivityAt)}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {callHref ? (
              <Button asChild className="w-fit" size="sm" variant="primary">
                <Link href={callHref}>
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  Call
                </Link>
              </Button>
            ) : null}
            <ResolveTextButton office={office} phone={thread.fromPhone} queue={queue} />
            {numberHref ? (
              <Link
                className="text-xs font-semibold text-[var(--portal-accent)] transition hover:text-[var(--portal-accent-hover)]"
                href={numberHref}
              >
                Full history
              </Link>
            ) : null}
          </div>

          {thread.latestVoicemailRecordingId ? (
            <audio
              className="mt-4 h-8 w-full"
              controls
              preload="none"
              src={`/api/portal/call-center/voicemails/${thread.latestVoicemailRecordingId}`}
            />
          ) : null}
        </section>

        <section className="rounded-xl border border-[var(--portal-border)] bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-[var(--portal-ink)]">
            Thread context
          </h3>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            <ThreadMetric label="Missed" value={thread.missedCount} />
            <ThreadMetric label="Voicemail" value={thread.voicemailCount} />
            <ThreadMetric label="Callback" value={thread.callbackNeededCount} />
            <ThreadMetric label="Follow-up" value={thread.followUpRequiredCount} />
          </dl>
        </section>
      </div>
    </aside>
  );
}

function ThreadMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--portal-muted-soft)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold text-[var(--portal-ink)]">{value}</dd>
    </div>
  );
}

function ResolveIconButton({
  office,
  phone,
  queue,
}: {
  office?: string;
  phone: string | null;
  queue?: string;
}) {
  return (
    <form action={resolveNeedsActionGroupAction}>
      {office ? <input type="hidden" name="office" value={office} /> : null}
      <input type="hidden" name="phone" value={phone ?? ""} />
      {queue ? <input type="hidden" name="queue" value={queue} /> : null}
      <Button
        aria-label="Mark resolved"
        className="h-8 w-8 p-0 text-[var(--portal-muted)] hover:text-[var(--portal-accent)]"
        disabled={!phone}
        size="sm"
        title="Mark resolved"
        type="submit"
        variant="ghost"
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </form>
  );
}

function ResolveTextButton({
  office,
  phone,
  queue,
}: {
  office?: string;
  phone: string | null;
  queue?: string;
}) {
  return (
    <form action={resolveNeedsActionGroupAction}>
      {office ? <input type="hidden" name="office" value={office} /> : null}
      <input type="hidden" name="phone" value={phone ?? ""} />
      {queue ? <input type="hidden" name="queue" value={queue} /> : null}
      <Button
        className="w-fit"
        disabled={!phone}
        size="sm"
        type="submit"
        variant="secondary"
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Resolve
      </Button>
    </form>
  );
}

function PaginationControls({
  office,
  page,
  queue,
  totalPages,
}: {
  office?: string;
  page: number;
  queue?: string;
  totalPages: number;
}) {
  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <div className="flex items-center gap-2">
      {hasPrevious ? (
        <Button
          asChild
          className="h-8 w-8 p-0"
          size="sm"
          title="Previous page"
          variant="secondary"
        >
          <Link
            aria-label="Previous page"
            href={followUpHref({ office, page: page - 1, queue })}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <Button
          aria-label="Previous page"
          className="h-8 w-8 p-0"
          disabled
          size="sm"
          title="Previous page"
          variant="secondary"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
      <PortalBadge>
        {page} / {totalPages}
      </PortalBadge>
      {hasNext ? (
        <Button
          asChild
          className="h-8 w-8 p-0"
          size="sm"
          title="Next page"
          variant="secondary"
        >
          <Link
            aria-label="Next page"
            href={followUpHref({ office, page: page + 1, queue })}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <Button
          aria-label="Next page"
          className="h-8 w-8 p-0"
          disabled
          size="sm"
          title="Next page"
          variant="secondary"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

function followUpIcon(group: PortalNeedsActionGroup) {
  const hasVoicemail = group.voicemailCount > 0;
  const hasNote = group.noteCount > 0;

  if (hasVoicemail) {
    return { Icon: VoicemailIcon, iconClassName: "text-[var(--portal-warning)]" };
  }

  if (hasNote) {
    return { Icon: MessageSquareText, iconClassName: "text-[var(--portal-accent)]" };
  }

  return { Icon: PhoneMissed, iconClassName: "text-[var(--portal-danger)]" };
}

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

function callerHistoryHref(phone: string | null, office?: string) {
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

function commandCenterCallHref(phone: string, office?: string, queue?: string) {
  const params = new URLSearchParams();

  if (office) {
    params.set("office", office);
  }

  if (queue) {
    params.set("queue", queue);
  }

  params.set("call", phone);

  return `/portal/app/call-center?${params.toString()}#softphone`;
}

function followUpHref({
  office,
  page,
  queue,
}: {
  office?: string;
  page: number;
  queue?: string;
}) {
  const params = new URLSearchParams();

  if (office) {
    params.set("office", office);
  }

  if (queue) {
    params.set("queue", queue);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();
  return query
    ? `/portal/app/call-center/follow-up?${query}`
    : "/portal/app/call-center/follow-up";
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
