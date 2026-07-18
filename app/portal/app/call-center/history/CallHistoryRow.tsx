import Link from "next/link";
import { ChevronRight, PhoneIncoming, PhoneOutgoing } from "lucide-react";

import { PortalBadge } from "@/app/portal/app/PortalBadge";
import { Button } from "@/components/ui/button";
import type { PortalRecentCallItem } from "@/lib/call-center/portal-model";
import { cn } from "@/lib/utils";

export function CallHistoryRow({ call }: { call: PortalRecentCallItem }) {
  const isOutbound = call.direction === "OUTBOUND";
  const contactPhone = isOutbound ? call.toPhone : call.fromPhone;
  const DirectionIcon = isOutbound ? PhoneOutgoing : PhoneIncoming;
  const duration = formatCallDuration(call.durationSec);
  const numberHref = contactPhone
    ? `/portal/app/call-center/callers/${encodeURIComponent(contactPhone)}`
    : null;
  const direction = isOutbound ? "Outbound" : "Inbound";

  return (
    <li className="group flex flex-col gap-3 px-4 py-4 transition hover:bg-[var(--portal-panel-soft)] sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            isOutbound
              ? "bg-blue-50 text-blue-700"
              : "bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]",
          )}
        >
          <DirectionIcon aria-hidden="true" className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-[var(--portal-ink)]">
              {formatPhone(contactPhone)}
            </p>
            <span className="text-xs font-medium text-[var(--portal-muted)]">
              {direction}
            </span>
            <PortalBadge className={historyStatusClassName(call.status)}>
              {historyStatusLabel(call)}
            </PortalBadge>
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--portal-muted)]">
            <span>{formatHistoryTime(call.occurredAt)}</span>
            {duration ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{duration}</span>
              </>
            ) : null}
            {call.locationName ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{call.locationName}</span>
              </>
            ) : null}
            {call.answeredBy ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Answered by {call.answeredBy}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>
      {numberHref ? (
        <Button asChild className="w-fit" size="sm" variant="ghost">
          <Link href={numberHref}>
            View history
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      ) : null}
    </li>
  );
}

function formatPhone(phone: string | null) {
  const digits = (phone || "").replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return phone || "Unknown number";
}

function formatHistoryTime(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
  }).format(new Date(date));
}

function historyStatusLabel(call: PortalRecentCallItem) {
  if (call.status === "ACTIVE") return "Connected";
  if (call.status === "MISSED") return "Missed";
  return call.status.charAt(0) + call.status.slice(1).toLowerCase();
}

function historyStatusClassName(status: PortalRecentCallItem["status"]) {
  switch (status) {
    case "ACTIVE":
    case "COMPLETED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "VOICEMAIL":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "FAILED":
    case "MISSED":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-[var(--portal-border)] bg-[var(--portal-panel-soft)] text-[var(--portal-muted)]";
  }
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
