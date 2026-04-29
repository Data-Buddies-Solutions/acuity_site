"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  PhoneCall,
  PhoneMissed,
  Voicemail as VoicemailIcon,
} from "lucide-react";

import { Button } from "@/app/components/ui/button";
import type { PortalCallActivityItem, PortalCallActivityKind } from "@/lib/call-center";
import { cn } from "@/lib/utils";

import { resolveMissedCallAction, resolveVoicemailAction } from "./actions";

type Filter = "all" | PortalCallActivityKind;

const filters: ReadonlyArray<{ label: string; value: Filter }> = [
  { label: "All", value: "all" },
  { label: "Missed", value: "missed" },
  { label: "Voicemail", value: "voicemail" },
];

function formatPhone(phone: string | null) {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone || "Unknown";
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

function kindIcon(kind: PortalCallActivityKind) {
  switch (kind) {
    case "voicemail":
      return { Icon: VoicemailIcon, className: "text-amber-500" };
    case "missed":
    default:
      return { Icon: PhoneMissed, className: "text-red-500" };
  }
}

function kindLabel(kind: PortalCallActivityKind) {
  switch (kind) {
    case "voicemail":
      return "Voicemail";
    case "missed":
    default:
      return "Missed";
  }
}

export default function ActivityRail({
  activity,
  onCallback,
}: {
  activity: PortalCallActivityItem[];
  onCallback: (number: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === "all") return activity;
    return activity.filter((item) => item.kind === filter);
  }, [activity, filter]);

  return (
    <section className="overflow-hidden rounded-xl border border-black/6 bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b border-black/6 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold tracking-[-0.02em] text-[#10272c]">
            Activity
          </h3>
          <p className="mt-0.5 text-xs text-[#617477]">
            {filtered.length} {filtered.length === 1 ? "event" : "events"}
          </p>
        </div>
        <nav
          aria-label="Activity filter"
          className="inline-flex rounded-lg border border-black/8 bg-[#fafbfb] p-1"
        >
          {filters.map((option) => {
            const isActive = filter === option.value;
            return (
              <button
                key={option.value}
                aria-pressed={isActive}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition",
                  isActive
                    ? "bg-white text-[#10272c] shadow-sm"
                    : "text-[#617477] hover:text-[#10272c]",
                )}
                onClick={() => setFilter(option.value)}
                type="button"
              >
                {option.label}
              </button>
            );
          })}
        </nav>
      </header>

      {filtered.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-[#617477]">
          No activity in this view yet.
        </div>
      ) : (
        <ul className="divide-y divide-black/5">
          {filtered.map((item) => {
            const { Icon, className } = kindIcon(item.kind);
            const phone = item.fromPhone;
            const callbackTarget = item.fromPhone || "";
            const duration = formatDuration(item.durationSec);
            const isSelected = selectedId === item.id;
            const resolveAction =
              item.kind === "missed" ? resolveMissedCallAction : resolveVoicemailAction;
            return (
              <li key={item.id}>
                <article
                  className={cn(
                    "px-5 py-3.5 transition",
                    isSelected ? "bg-[#f1f5f5]" : "hover:bg-[#fafbfb]",
                  )}
                >
                  <div className="flex items-start gap-4">
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f1f5f5]",
                        className,
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-[#10272c]">
                          {item.callerName || formatPhone(phone)}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8a999b]">
                          {kindLabel(item.kind)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[#617477]">
                        <span>{formatPhone(phone)}</span>
                        {item.locationName ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{item.locationName}</span>
                          </>
                        ) : null}
                        {duration ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{duration}</span>
                          </>
                        ) : null}
                        <span aria-hidden="true">·</span>
                        <span>{formatRelative(item.createdAt)}</span>
                      </div>
                      {item.kind === "voicemail" && item.recordingId ? (
                        <audio
                          className="mt-3 w-full max-w-xl"
                          controls
                          preload="none"
                          src={`/api/portal/call-center/voicemails/${item.recordingId}`}
                        />
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                      <Button
                        disabled={!callbackTarget}
                        onClick={() => {
                          setSelectedId(item.id);
                          if (callbackTarget) {
                            onCallback(callbackTarget);
                          }
                        }}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        <PhoneCall className="h-4 w-4" aria-hidden="true" />
                        Call
                      </Button>
                      <form action={resolveAction}>
                        <input type="hidden" name="id" value={item.recordId} />
                        <Button size="sm" type="submit" variant="secondary">
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          Done
                        </Button>
                      </form>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
