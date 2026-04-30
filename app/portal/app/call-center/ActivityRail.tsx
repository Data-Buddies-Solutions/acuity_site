"use client";

import { useMemo, useState } from "react";
import {
  PhoneCall,
  PhoneMissed,
  Play,
  Trash2,
  Voicemail as VoicemailIcon,
} from "lucide-react";

import { Button } from "@/app/components/ui/button";
import type { PortalCallActivityItem, PortalCallActivityKind } from "@/lib/call-center";
import { cn } from "@/lib/utils";

import { resolveMissedCallAction, resolveVoicemailAction } from "./actions";

type Filter = "all" | PortalCallActivityKind;

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

export default function ActivityRail({
  activity,
  onCallback,
  totals,
}: {
  activity: PortalCallActivityItem[];
  onCallback: (number: string) => void;
  totals: { missedCalls: number; voicemails: number };
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedAudioId, setExpandedAudioId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === "all") return activity;
    return activity.filter((item) => item.kind === filter);
  }, [activity, filter]);

  const filters: ReadonlyArray<{ count: number; label: string; value: Filter }> = [
    { count: activity.length, label: "All", value: "all" },
    { count: totals.missedCalls, label: "Missed", value: "missed" },
    { count: totals.voicemails, label: "Voicemail", value: "voicemail" },
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-black/6 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-black/6 px-4 py-3">
        <h3 className="text-sm font-semibold tracking-[-0.01em] text-[#10272c]">
          Activity
        </h3>
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
                  "rounded-md px-2.5 py-1 text-xs font-medium transition",
                  isActive
                    ? "bg-white text-[#10272c] shadow-sm"
                    : "text-[#617477] hover:text-[#10272c]",
                )}
                onClick={() => setFilter(option.value)}
                type="button"
              >
                {option.label}
                <span
                  className={cn(
                    "ml-1.5 tabular-nums",
                    isActive ? "text-[#617477]" : "text-[#8a999b]",
                  )}
                >
                  {option.count}
                </span>
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
            const callbackTarget = item.fromPhone || "";
            const duration = formatDuration(item.durationSec);
            const isSelected = selectedId === item.id;
            const isAudioOpen = expandedAudioId === item.id;
            const resolveAction =
              item.kind === "missed" ? resolveMissedCallAction : resolveVoicemailAction;
            const title = item.callerName || formatPhone(item.fromPhone);
            return (
              <li key={item.id}>
                <article
                  className={cn(
                    "px-4 py-2.5 transition",
                    isSelected ? "bg-[#f1f5f5]" : "hover:bg-[#fafbfb]",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      aria-hidden="true"
                      className={cn("h-4 w-4 shrink-0", className)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-[#10272c]">
                        {title}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-[#617477]">
                        {item.locationName ? <span>{item.locationName}</span> : null}
                        {item.locationName && (duration || true) ? (
                          <span aria-hidden="true">·</span>
                        ) : null}
                        {duration ? (
                          <>
                            <span>{duration}</span>
                            <span aria-hidden="true">·</span>
                          </>
                        ) : null}
                        <span>{formatRelative(item.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.kind === "voicemail" && item.recordingId ? (
                        <Button
                          aria-label="Play voicemail"
                          aria-pressed={isAudioOpen}
                          className="h-8 w-8 p-0"
                          onClick={() =>
                            setExpandedAudioId(isAudioOpen ? null : item.id)
                          }
                          size="sm"
                          title="Play voicemail"
                          type="button"
                          variant="ghost"
                        >
                          <Play className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      ) : null}
                      <Button
                        aria-label={`Call back ${title}`}
                        className="h-8 w-8 p-0"
                        disabled={!callbackTarget}
                        onClick={() => {
                          setSelectedId(item.id);
                          if (callbackTarget) {
                            onCallback(callbackTarget);
                          }
                        }}
                        size="sm"
                        title="Call back"
                        type="button"
                        variant="ghost"
                      >
                        <PhoneCall className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <form action={resolveAction}>
                        <input type="hidden" name="id" value={item.recordId} />
                        <Button
                          aria-label="Dismiss"
                          className="h-8 w-8 p-0 text-[#617477] hover:text-red-600"
                          size="sm"
                          title="Dismiss"
                          type="submit"
                          variant="ghost"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </form>
                    </div>
                  </div>
                  {item.kind === "voicemail" && item.recordingId && isAudioOpen ? (
                    <audio
                      autoPlay
                      className="mt-2 h-8 w-full max-w-xl"
                      controls
                      preload="none"
                      src={`/api/portal/call-center/voicemails/${item.recordingId}`}
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
