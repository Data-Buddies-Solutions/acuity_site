import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  MessageSquareText,
  Phone,
  PhoneCall,
  PhoneMissed,
  Voicemail,
} from "lucide-react";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardHeader } from "@/app/components/ui/card";
import {
  getPortalCallCenterCallerTimeline,
  type PortalCallerTimelineItem,
} from "@/lib/call-center";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { cn } from "@/lib/utils";

import { resolveNeedsActionGroupAction, saveCallCenterNoteAction } from "../../actions";

export const dynamic = "force-dynamic";

type ParamsInput = Promise<{ phone: string }>;
type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;
type HistoryRange = "24h" | "7d" | "all";
const CALLER_TIMELINE_PAGE_SIZE = 100;

export default async function PortalCallCenterCallerPage({
  params,
  searchParams,
}: {
  params: ParamsInput;
  searchParams?: SearchParamsInput;
}) {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  const { phone: phoneParam } = await params;
  const query = searchParams ? await searchParams : {};
  const phone = decodeURIComponent(phoneParam);
  const selectedRange = parseHistoryRange(
    Array.isArray(query.range) ? query.range[0] : query.range,
  );
  const page = parseHistoryPage(Array.isArray(query.page) ? query.page[0] : query.page);
  const timeline = await getPortalCallCenterCallerTimeline(phone, {
    page,
    pageSize: CALLER_TIMELINE_PAGE_SIZE,
    range: selectedRange,
  });

  if (!timeline) {
    redirect("/portal");
  }

  const totalPages = timeline.totalPages;

  if (timeline.page > totalPages) {
    redirect(historyRangeHref(timeline.phone, selectedRange, totalPages));
  }

  if (page !== timeline.page) {
    redirect(historyRangeHref(timeline.phone, selectedRange, timeline.page));
  }

  const latestNeedsActionItem = timeline.latestNeedsActionItem;
  const filteredItems = timeline.items;
  const latestItem = timeline.latestItem;
  const locations = Array.from(
    new Set(filteredItems.map((item) => item.locationName).filter(Boolean)),
  );
  const inboundCount = timeline.totals.inboundItems;
  const outboundDialedCount = timeline.totals.outboundDialedCalls;
  const outboundConnectedCount = timeline.totals.outboundConnectedCalls;
  const statusLabel = latestNeedsActionItem ? "Needs action" : "No action needed";
  const title = timeline.callerName || formatPhone(timeline.phone);
  const subtitle = timeline.callerName ? formatPhone(timeline.phone) : null;
  const rangeLabel = historyRangeLabel(selectedRange);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Button asChild className="mb-3 w-fit" size="sm" variant="secondary">
            <Link href="/portal/app/call-center">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Command center
            </Link>
          </Button>
          <p className="text-xs font-semibold uppercase text-[#617477]">Number profile</p>
          <h1 className="mt-1 truncate text-2xl font-semibold text-[#10272c]">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-[#617477]">{subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "w-fit rounded-full border px-2.5 py-1 text-xs font-semibold",
              latestNeedsActionItem
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700",
            )}
          >
            {statusLabel}
          </span>
          <Button asChild className="w-fit" size="sm" variant="primary">
            <Link
              href={`/portal/app/call-center?call=${encodeURIComponent(
                timeline.phone,
              )}#softphone`}
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              Call
            </Link>
          </Button>
        </div>
      </div>

      <section className="rounded-xl border border-black/6 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#10272c]">History range</h2>
            <p className="mt-0.5 text-xs text-[#617477]">
              Totals and activity for this number.
            </p>
          </div>
          <HistoryRangeTabs phone={timeline.phone} selectedRange={selectedRange} />
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryMetric label="Inbound" value={inboundCount} />
        <SummaryMetric label="Outbound" value={outboundConnectedCount} />
        <SummaryMetric label="Outbound dialed" value={outboundDialedCount} />
        <SummaryMetric
          label="Last activity"
          value={latestItem ? formatTimelineTime(latestItem.occurredAt) : "None"}
        />
      </section>

      {latestNeedsActionItem ? (
        <Card className="overflow-hidden border-black/8 bg-white p-0 shadow-sm">
          <CardHeader className="mb-0 flex flex-row items-center justify-between border-b border-black/6 px-4 py-3">
            <h2 className="text-sm font-semibold text-[#10272c]">Follow-up</h2>
            <Badge
              className="border-black/8 bg-white px-2.5 py-1 text-[11px] text-[#617477]"
              variant="outline"
            >
              Needs response
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 border-l-2 border-amber-300 pl-3">
                <TimelineRowContent compact hideStatus item={latestNeedsActionItem} />
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  asChild
                  className="h-8 w-8 p-0 text-[#617477] hover:text-[#0d7377]"
                  size="sm"
                  title="Call back"
                  variant="ghost"
                >
                  <Link
                    aria-label={`Call back ${formatPhone(timeline.phone)}`}
                    href={`/portal/app/call-center?call=${encodeURIComponent(
                      timeline.phone,
                    )}#softphone`}
                  >
                    <Phone className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <ResolveActionForm iconOnly phone={timeline.phone} />
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <OutcomePanel phone={timeline.phone} />

      <section className="overflow-hidden rounded-xl border border-black/6 bg-white shadow-sm">
        <header
          className="flex items-center justify-between border-b border-black/6 px-4 py-3"
          id="activity"
        >
          <div>
            <h2 className="text-sm font-semibold text-[#10272c]">All activity</h2>
            <p className="mt-0.5 text-xs text-[#617477]">
              {rangeLabel}
              {locations.length ? ` · ${locations.join(", ")}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-black/8 px-2.5 py-1 text-xs font-semibold text-[#617477]">
              {timeline.totals.totalItems}{" "}
              {timeline.totals.totalItems === 1 ? "item" : "items"}
            </span>
            <PaginationControls
              page={timeline.page}
              phone={timeline.phone}
              range={selectedRange}
              totalPages={totalPages}
            />
          </div>
        </header>

        {filteredItems.length ? (
          <ul className="divide-y divide-black/5">
            {filteredItems.map((item: PortalCallerTimelineItem) => {
              const Icon = iconForTimelineKind(item.kind);

              return (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-black/8 bg-[#f7fbfa] text-[#0d7377]">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <TimelineRowContent item={item} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-5 py-12 text-center text-sm text-[#617477]">
            No activity found for this range.
          </div>
        )}
      </section>
    </div>
  );
}

function HistoryRangeTabs({
  phone,
  selectedRange,
}: {
  phone: string;
  selectedRange: HistoryRange;
}) {
  const options: Array<{ label: string; value: HistoryRange }> = [
    { label: "24h", value: "24h" },
    { label: "7d", value: "7d" },
    { label: "All", value: "all" },
  ];

  return (
    <nav
      aria-label="History range"
      className="inline-flex w-fit rounded-lg border border-black/8 bg-[#fafbfb] p-1"
    >
      {options.map((option) => {
        const selected = option.value === selectedRange;

        return (
          <Link
            aria-current={selected ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-semibold transition",
              selected
                ? "bg-white text-[#10272c] shadow-sm"
                : "text-[#617477] hover:text-[#10272c]",
            )}
            href={historyRangeHref(phone, option.value, 1)}
            key={option.value}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}

function PaginationControls({
  page,
  phone,
  range,
  totalPages,
}: {
  page: number;
  phone: string;
  range: HistoryRange;
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
            href={historyRangeHref(phone, range, page - 1)}
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
      <span className="rounded-full border border-black/8 px-2.5 py-1 text-xs font-semibold text-[#617477]">
        {page} / {totalPages}
      </span>
      {hasNext ? (
        <Button
          asChild
          className="h-8 w-8 p-0"
          size="sm"
          title="Next page"
          variant="secondary"
        >
          <Link aria-label="Next page" href={historyRangeHref(phone, range, page + 1)}>
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

function SummaryMetric({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "warning";
  value: number | string;
}) {
  return (
    <div className="rounded-xl border border-black/6 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-[#617477]">{label}</p>
      <p
        className={cn(
          "mt-1 truncate text-sm font-semibold",
          tone === "warning" ? "text-amber-700" : "text-[#10272c]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function TimelineRowContent({
  compact = false,
  hideStatus = false,
  item,
}: {
  compact?: boolean;
  hideStatus?: boolean;
  item: PortalCallerTimelineItem;
}) {
  const duration = formatCallDuration(item.durationSec);
  const note = timelineNoteFor(item);
  const visibleStatus =
    !hideStatus && item.status && !(item.kind === "call" && item.status === "COMPLETED")
      ? item.status
      : null;

  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-sm font-semibold text-[#10272c]">{item.title}</p>
        {visibleStatus ? (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase",
              isNeedsActionItem(item)
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-black/8 text-[#617477]",
            )}
          >
            {formatStatus(visibleStatus)}
          </span>
        ) : null}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-[#617477]">
        <span>{formatTimelineTime(item.occurredAt)}</span>
        {duration ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{duration}</span>
          </>
        ) : null}
        {item.locationName ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{item.locationName}</span>
          </>
        ) : null}
        {item.stationLabel ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{item.stationLabel}</span>
          </>
        ) : null}
      </p>
      {item.body ? (
        <p
          className={cn(
            "mt-2 rounded-lg border border-black/6 bg-[#fafbfb] px-3 py-2 text-sm text-[#10272c]",
            compact ? "max-w-2xl" : "",
          )}
        >
          {item.body}
        </p>
      ) : note ? (
        <p className="mt-1 text-sm text-[#617477]">{note}</p>
      ) : null}
      {item.kind === "voicemail" && item.recordingId ? (
        <audio
          className="mt-2 h-8 w-full max-w-xl"
          controls
          preload="none"
          src={`/api/portal/call-center/voicemails/${item.recordingId}`}
        />
      ) : null}
    </div>
  );
}

function ResolveActionForm({
  iconOnly = false,
  phone,
}: {
  iconOnly?: boolean;
  phone: string;
}) {
  return (
    <form action={resolveNeedsActionGroupAction}>
      <input type="hidden" name="phone" value={phone} />
      <Button
        aria-label={iconOnly ? "Mark resolved" : undefined}
        className={iconOnly ? "h-8 w-8 p-0 text-[#617477] hover:text-[#0d7377]" : "w-fit"}
        size="sm"
        title={iconOnly ? "Mark resolved" : undefined}
        type="submit"
        variant={iconOnly ? "ghost" : "secondary"}
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        {iconOnly ? null : "Mark resolved"}
      </Button>
    </form>
  );
}

function OutcomePanel({ phone }: { phone: string }) {
  return (
    <Card className="border-black/6 bg-white p-4 shadow-sm">
      <CardContent className="p-0">
        <form
          action={saveCallCenterNoteAction}
          className="grid w-full gap-2 sm:grid-cols-[minmax(180px,220px)_1fr_auto]"
        >
          <input type="hidden" name="phone" value={phone} />
          <label className="flex flex-col gap-1 text-xs font-semibold text-[#617477]">
            Status
            <select
              className="h-10 rounded-lg border border-black/8 bg-white px-3 text-sm font-medium text-[#10272c] outline-none transition focus:border-[#0d7377]"
              defaultValue="RESOLVED"
              name="disposition"
            >
              <option value="RESOLVED">Resolved</option>
              <option value="CALLBACK_NEEDED">Callback needed</option>
              <option value="FOLLOW_UP_REQUIRED">Follow-up required</option>
              <option value="WRONG_NUMBER">Wrong number</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[#617477]">
            Note
            <textarea
              className="min-h-10 rounded-lg border border-black/8 bg-white px-3 py-2 text-sm text-[#10272c] outline-none transition placeholder:text-[#8a999b] focus:border-[#0d7377]"
              name="note"
              placeholder="What happened?"
              rows={1}
            />
          </label>
          <Button className="mt-5 w-fit self-start" size="sm" type="submit">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function iconForTimelineKind(kind: string) {
  switch (kind) {
    case "missed":
      return PhoneMissed;
    case "note":
      return MessageSquareText;
    case "text":
      return MessageSquareText;
    case "voicemail":
      return Voicemail;
    case "call":
    default:
      return PhoneCall;
  }
}

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

function formatStatus(status: string) {
  switch (status) {
    case "CALLBACK_NEEDED":
      return "Callback needed";
    case "CLEARED_BY_LATER_CALL":
      return "Connected later";
    case "FOLLOW_UP_REQUIRED":
      return "Follow-up required";
    case "NEEDS_ACTION":
      return "Needs action";
    case "WRONG_NUMBER":
      return "Wrong number";
    default:
      return status.toLowerCase().replaceAll("_", " ");
  }
}

function timelineNoteFor(item: PortalCallerTimelineItem) {
  if (item.status === "CLEARED_BY_LATER_CALL" && item.connectedLaterAt) {
    return `A later call connected with staff at ${formatTimelineTime(
      item.connectedLaterAt,
    )}.`;
  }

  return item.note;
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

function isNeedsActionItem(item: PortalCallerTimelineItem) {
  return (
    item.status === "CALLBACK_NEEDED" ||
    item.status === "FOLLOW_UP_REQUIRED" ||
    item.status === "NEEDS_ACTION"
  );
}

function parseHistoryRange(value: string | undefined): HistoryRange {
  return value === "24h" || value === "7d" ? value : "all";
}

function parseHistoryPage(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function historyRangeHref(phone: string, range: HistoryRange, page = 1) {
  const path = `/portal/app/call-center/callers/${encodeURIComponent(phone)}`;
  const params = new URLSearchParams();

  if (range !== "all") {
    params.set("range", range);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function historyRangeLabel(range: HistoryRange) {
  if (range === "24h") return "Last 24 hours";
  if (range === "7d") return "Last 7 days";
  return "All time";
}

function formatTimelineTime(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
  }).format(new Date(date));
}
