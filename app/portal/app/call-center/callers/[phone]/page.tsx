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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/app/components/ui/card";
import { PortalBadge } from "@/app/portal/app/PortalBadge";
import { type PortalCallerTimelineItem } from "@/lib/call-center/portal-model";
import { readCanonicalCallerTimeline } from "@/lib/call-center/application/portal-canonical-history";
import { readPortalCallCenterShell } from "@/lib/call-center/application/portal-canonical-workspace";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { cn } from "@/lib/utils";

import {
  resolveNeedsActionGroupAction,
  saveCallCenterNoteFormAction,
} from "../../actions";

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
  const office = firstQueryValue(query.office);
  const resolvedLocationData = await readPortalCallCenterShell(office);
  const locationData =
    office && resolvedLocationData?.selectedLocation?.id !== office
      ? null
      : resolvedLocationData;
  const selectedCanonicalLocationIds = locationData?.selectedLocation?.locationIds?.length
    ? locationData.selectedLocation.locationIds
    : locationData?.selectedLocation?.locationId
      ? [locationData.selectedLocation.locationId]
      : [];
  const timeline = locationData
    ? await readCanonicalCallerTimeline(phone, {
        locationIds: selectedCanonicalLocationIds,
        page,
        pageSize: CALLER_TIMELINE_PAGE_SIZE,
        range: selectedRange,
      })
    : null;

  if (!timeline) {
    redirect("/portal");
  }

  const totalPages = timeline.totalPages;

  if (timeline.page > totalPages) {
    redirect(historyRangeHref(timeline.phone, selectedRange, totalPages, office));
  }

  if (page !== timeline.page) {
    redirect(historyRangeHref(timeline.phone, selectedRange, timeline.page, office));
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
  const title = timeline.callerName || formatPhone(timeline.phone);
  const subtitle = timeline.callerName ? formatPhone(timeline.phone) : null;
  const rangeLabel = historyRangeLabel(selectedRange);
  const callHref = commandCenterHref({ call: timeline.phone, office });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            asChild
            className="mt-1 h-9 w-9 shrink-0 p-0 text-[var(--portal-muted)] hover:text-[var(--portal-accent)]"
            size="sm"
            variant="ghost"
          >
            <Link href={commandCenterHref({ office })}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Back to call center</span>
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="break-words text-3xl font-semibold leading-tight tracking-normal text-[var(--portal-ink)] md:text-4xl">
                {title}
              </h1>
              {subtitle ? (
                <span className="text-lg font-medium text-[var(--portal-muted)]">
                  {subtitle}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:pt-1">
          <Button asChild className="w-fit" size="sm" variant="primary">
            <Link href={callHref}>
              <Phone className="h-4 w-4" aria-hidden="true" />
              Call
            </Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-3">
        <SummaryMetric label="Inbound" value={inboundCount} />
        <SummaryMetric
          detail={`${outboundDialedCount} dialed`}
          label="Outbound connected"
          value={outboundConnectedCount}
        />
        <SummaryMetric
          label="Last activity"
          value={latestItem ? formatTimelineTime(latestItem.occurredAt) : "None"}
        />
      </section>

      {latestNeedsActionItem ? (
        <Card className="overflow-hidden border-[var(--portal-border)] bg-white p-0 shadow-sm">
          <CardHeader className="mb-0 flex flex-row items-center justify-between border-b border-[var(--portal-border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--portal-ink)]">Follow-up</h2>
            <Badge
              className="border-[var(--portal-border)] bg-white px-2.5 py-1 text-[11px] text-[var(--portal-muted)]"
              variant="outline"
            >
              Needs action
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 border-l-2 border-[var(--portal-warning)] pl-3">
                <TimelineRowContent compact hideStatus item={latestNeedsActionItem} />
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  asChild
                  className="h-8 w-8 p-0 text-[var(--portal-muted)] hover:text-[var(--portal-accent)]"
                  size="sm"
                  title="Call back"
                  variant="ghost"
                >
                  <Link
                    aria-label={`Call back ${formatPhone(timeline.phone)}`}
                    href={callHref}
                  >
                    <Phone className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <ResolveActionForm iconOnly office={office} phone={timeline.phone} />
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <OutcomePanel office={office} phone={timeline.phone} />

      <section className="overflow-hidden rounded-xl border border-[var(--portal-border)] bg-white shadow-sm">
        <header
          className="flex flex-col gap-3 border-b border-[var(--portal-border)] px-4 py-3"
          id="activity"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--portal-ink)]">
                All activity
              </h2>
              <p className="mt-0.5 text-xs text-[var(--portal-muted)]">
                {rangeLabel}
                {locations.length ? ` · ${locations.join(", ")}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <PortalBadge>
                {timeline.totals.totalItems}{" "}
                {timeline.totals.totalItems === 1 ? "item" : "items"}
              </PortalBadge>
              <PaginationControls
                office={office}
                page={timeline.page}
                phone={timeline.phone}
                range={selectedRange}
                totalPages={totalPages}
              />
            </div>
          </div>
          <div>
            <HistoryRangeTabs
              office={office}
              phone={timeline.phone}
              selectedRange={selectedRange}
            />
          </div>
        </header>

        {filteredItems.length ? (
          <ul className="divide-y divide-[var(--portal-border)]">
            {filteredItems.map((item: PortalCallerTimelineItem) => {
              const Icon = iconForTimelineKind(item.kind);

              return (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] text-[var(--portal-accent)]">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <TimelineRowContent item={item} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-5 py-12 text-center text-sm text-[var(--portal-muted)]">
            No activity found for this range.
          </div>
        )}
      </section>
    </div>
  );
}

function HistoryRangeTabs({
  office,
  phone,
  selectedRange,
}: {
  office?: string;
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
      className="inline-flex w-fit rounded-lg border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] p-1"
    >
      {options.map((option) => {
        const selected = option.value === selectedRange;

        return (
          <Link
            aria-current={selected ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-semibold transition",
              selected
                ? "bg-white text-[var(--portal-ink)] shadow-sm"
                : "text-[var(--portal-muted)] hover:text-[var(--portal-ink)]",
            )}
            href={historyRangeHref(phone, option.value, 1, office)}
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
  office,
  page,
  phone,
  range,
  totalPages,
}: {
  office?: string;
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
            href={historyRangeHref(phone, range, page - 1, office)}
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
            href={historyRangeHref(phone, range, page + 1, office)}
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

function SummaryMetric({
  detail,
  label,
  tone = "default",
  value,
}: {
  detail?: string;
  label: string;
  tone?: "default" | "warning";
  value: number | string;
}) {
  return (
    <div className="rounded-xl border border-[var(--portal-border)] bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-[var(--portal-muted)]">{label}</p>
      <p
        className={cn(
          "mt-1 truncate text-sm font-semibold",
          tone === "warning"
            ? "text-[var(--portal-warning)]"
            : "text-[var(--portal-ink)]",
        )}
      >
        {value}
      </p>
      {detail ? (
        <p className="mt-1 text-xs font-medium text-[var(--portal-muted)]">{detail}</p>
      ) : null}
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
        <p className="text-sm font-semibold text-[var(--portal-ink)]">{item.title}</p>
        {visibleStatus ? (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase",
              isNeedsActionItem(item)
                ? "border-[var(--portal-warning)] bg-[var(--portal-warning-soft)] text-[var(--portal-warning)]"
                : "border-[var(--portal-border)] text-[var(--portal-muted)]",
            )}
          >
            {formatStatus(visibleStatus)}
          </span>
        ) : null}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--portal-muted)]">
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
        {item.agentLabel ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{item.agentLabel}</span>
          </>
        ) : null}
      </p>
      {item.body ? (
        <p
          className={cn(
            "mt-2 rounded-lg border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] px-3 py-2 text-sm text-[var(--portal-ink)]",
            compact ? "max-w-2xl" : "",
          )}
        >
          {item.body}
        </p>
      ) : note ? (
        <p className="mt-1 text-sm text-[var(--portal-muted)]">{note}</p>
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
  office,
  phone,
}: {
  iconOnly?: boolean;
  office?: string;
  phone: string;
}) {
  return (
    <form action={resolveNeedsActionGroupAction}>
      {office ? <input type="hidden" name="office" value={office} /> : null}
      <input type="hidden" name="phone" value={phone} />
      <Button
        aria-label={iconOnly ? "Mark resolved" : undefined}
        className={
          iconOnly
            ? "h-8 w-8 p-0 text-[var(--portal-muted)] hover:text-[var(--portal-accent)]"
            : "w-fit"
        }
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

function OutcomePanel({ office, phone }: { office?: string; phone: string }) {
  return (
    <Card className="border-[var(--portal-border)] bg-white p-4 shadow-sm">
      <CardContent className="p-0">
        <form
          action={saveCallCenterNoteFormAction}
          className="grid w-full gap-2 sm:grid-cols-[minmax(180px,220px)_1fr_auto]"
        >
          {office ? <input type="hidden" name="office" value={office} /> : null}
          <input type="hidden" name="phone" value={phone} />
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--portal-muted)]">
            Status
            <select
              className="h-10 rounded-lg border border-[var(--portal-border)] bg-white px-3 text-sm font-medium text-[var(--portal-ink)] outline-none transition focus:border-[var(--portal-accent)]"
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
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--portal-muted)]">
            Note
            <textarea
              className="min-h-10 rounded-lg border border-[var(--portal-border)] bg-white px-3 py-2 text-sm text-[var(--portal-ink)] outline-none transition placeholder:text-[var(--portal-muted-soft)] focus:border-[var(--portal-accent)]"
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

function historyRangeHref(phone: string, range: HistoryRange, page = 1, office?: string) {
  const path = `/portal/app/call-center/callers/${encodeURIComponent(phone)}`;
  const params = new URLSearchParams();

  if (office) {
    params.set("office", office);
  }

  if (range !== "all") {
    params.set("range", range);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function commandCenterHref({ call, office }: { call?: string | null; office?: string }) {
  const params = new URLSearchParams();

  if (office) {
    params.set("office", office);
  }

  if (call) {
    params.set("call", call);
  }

  const query = params.toString();
  return `/portal/app/call-center${query ? `?${query}` : ""}${call ? "#softphone" : ""}`;
}

function firstQueryValue(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed || undefined;
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
