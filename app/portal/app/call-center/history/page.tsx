import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  PhoneIncoming,
  PhoneOutgoing,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { PortalBadge } from "@/app/portal/app/PortalBadge";
import { LinkSegmentedControl } from "@/components/ui/link-segmented-control";
import {
  type PortalCallCenterHistoryRange,
  type PortalCallCenterHistoryView,
  type PortalRecentCallItem,
} from "@/lib/call-center";
import { readCombinedCallCenterHistory } from "@/lib/call-center/application/portal-combined-call-center-reads";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { cn } from "@/lib/utils";

import { PracticePageHeader } from "../../PracticePageHeader";

export const dynamic = "force-dynamic";

type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;
const HISTORY_PAGE_SIZE = 100;

export default async function PortalCallCenterHistoryPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  const params = searchParams ? await searchParams : {};
  const page = parseHistoryPage(
    Array.isArray(params.page) ? params.page[0] : params.page,
  );
  const range = parseHistoryRange(
    Array.isArray(params.range) ? params.range[0] : params.range,
  );
  const view = parseHistoryView(
    Array.isArray(params.view) ? params.view[0] : params.view,
  );
  const historyOptions = { page, pageSize: HISTORY_PAGE_SIZE, range, view };
  const data = await readCombinedCallCenterHistory(historyOptions);

  if (!data) {
    redirect("/portal");
  }

  const totalPages = Math.max(1, Math.ceil(data.totals.totalCalls / data.pageSize));

  if (data.totals.totalCalls > 0 && data.page > totalPages) {
    redirect(historyHref({ page: totalPages, range: data.range, view }));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PracticePageHeader
        branding={data.branding}
        practiceName={data.practiceName}
        showLogo={false}
        title="Call history"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button asChild variant="secondary">
            <Link href="/portal/app/call-center">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Command center
            </Link>
          </Button>
        </div>
      </PracticePageHeader>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryMetric
          label={view === "all" ? "Total calls" : "Total connections"}
          value={data.totals.totalCalls}
        />
        <SummaryMetric label="Inbound connected" value={data.totals.inboundCalls} />
        <SummaryMetric label="Outbound connected" value={data.totals.outboundCalls} />
        <SummaryMetric
          label="Outbound attempts"
          value={data.totals.outboundDialedCalls}
        />
      </section>

      <section className="rounded-xl border border-[var(--portal-border)] bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[var(--portal-border)] pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--portal-ink)]">Call type</h2>
            <p className="mt-0.5 text-xs text-[var(--portal-muted)]">
              {view === "all" ? "Every call outcome." : "Answered calls only."}
            </p>
          </div>
          <HistoryViewTabs range={data.range} selectedView={view} />
        </div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--portal-ink)]">Time range</h2>
            <p className="mt-0.5 text-xs text-[var(--portal-muted)]">
              {historyRangeLabel(data.range)}
            </p>
          </div>
          <HistoryRangeTabs selectedRange={data.range} view={view} />
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[var(--portal-border)] bg-white shadow-sm">
        <header className="flex flex-col gap-3 border-b border-[var(--portal-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--portal-ink)]">
              {view === "all" ? "Inbound and outbound calls" : "Connections"}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--portal-muted)]">
              {view === "all"
                ? "Completed, missed, voicemail, failed, and active calls."
                : "Answered call-center calls for the selected range."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PortalBadge>
              {data.totals.totalCalls} {view === "all" ? "calls" : "connections"}
            </PortalBadge>
            <PaginationControls
              page={data.page}
              range={data.range}
              totalPages={totalPages}
              view={view}
            />
          </div>
        </header>

        {data.calls.length ? (
          <ul className="divide-y divide-[var(--portal-border)]">
            {data.calls.map((call) => (
              <HistoryRow call={call} key={call.id} />
            ))}
          </ul>
        ) : (
          <div className="px-5 py-12 text-center text-sm text-[var(--portal-muted)]">
            {view === "all" ? "No calls yet." : "No connected calls yet."}
          </div>
        )}
      </section>
    </div>
  );
}

function HistoryViewTabs({
  range,
  selectedView,
}: {
  range: PortalCallCenterHistoryRange;
  selectedView: PortalCallCenterHistoryView;
}) {
  const options: Array<{ label: string; value: PortalCallCenterHistoryView }> = [
    { label: "All calls", value: "all" },
    { label: "Connections", value: "connections" },
  ];

  return (
    <LinkSegmentedControl
      activeClassName="bg-white text-[var(--portal-ink)]"
      ariaLabel="Call history type"
      className="border border-[var(--portal-border)] bg-[var(--portal-panel-soft)]"
      inactiveClassName="text-[var(--portal-muted)] hover:text-[var(--portal-ink)]"
      itemClassName="px-3 py-1.5 text-xs font-semibold"
      items={options.map((option) => ({
        href: historyHref({ page: 1, range, view: option.value }),
        label: option.label,
        value: option.value,
      }))}
      value={selectedView}
    />
  );
}

function HistoryRangeTabs({
  selectedRange,
  view,
}: {
  selectedRange: PortalCallCenterHistoryRange;
  view: PortalCallCenterHistoryView;
}) {
  const options: Array<{ label: string; value: PortalCallCenterHistoryRange }> = [
    { label: "24h", value: "24h" },
    { label: "7d", value: "7d" },
    { label: "All", value: "all" },
  ];

  return (
    <LinkSegmentedControl
      activeClassName="bg-white text-[var(--portal-ink)]"
      ariaLabel="History range"
      className="border border-[var(--portal-border)] bg-[var(--portal-panel-soft)]"
      inactiveClassName="text-[var(--portal-muted)] hover:text-[var(--portal-ink)]"
      itemClassName="px-3 py-1.5 text-xs font-semibold"
      items={options.map((option) => ({
        href: historyHref({ page: 1, range: option.value, view }),
        label: option.label,
        value: option.value,
      }))}
      value={selectedRange}
    />
  );
}

function PaginationControls({
  page,
  range,
  totalPages,
  view,
}: {
  page: number;
  range: PortalCallCenterHistoryRange;
  totalPages: number;
  view: PortalCallCenterHistoryView;
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
            href={historyHref({ page: page - 1, range, view })}
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
      <span className="rounded-full border border-[var(--portal-border)] px-2.5 py-1 text-xs font-semibold text-[var(--portal-muted)]">
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
          <Link
            aria-label="Next page"
            href={historyHref({ page: page + 1, range, view })}
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

function HistoryRow({ call }: { call: PortalRecentCallItem }) {
  const isOutbound = call.direction === "OUTBOUND";
  const patientPhone = isOutbound ? call.toPhone : call.fromPhone;
  const DirectionIcon = isOutbound ? PhoneOutgoing : PhoneIncoming;
  const duration = formatCallDuration(call.durationSec);
  const numberHref = patientPhone
    ? `/portal/app/call-center/callers/${encodeURIComponent(patientPhone)}`
    : null;

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <DirectionIcon
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-[var(--portal-accent)]"
          />
          {numberHref ? (
            <Link
              className="block truncate text-sm font-semibold text-[var(--portal-accent)] underline-offset-2 hover:underline"
              href={numberHref}
            >
              {formatPhone(patientPhone)}
            </Link>
          ) : (
            <p className="truncate text-sm font-semibold text-[var(--portal-ink)]">
              {formatPhone(patientPhone)}
            </p>
          )}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--portal-muted)]">
          <span>{historyStatusLabel(call)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatHistoryTime(call.occurredAt)}</span>
          {duration ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{duration}</span>
            </>
          ) : null}
          {call.answeredBy ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{call.answeredBy}</span>
            </>
          ) : null}
        </p>
      </div>
      {numberHref ? (
        <Button asChild className="w-fit" size="sm" variant="ghost">
          <Link href={numberHref}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Number history
          </Link>
        </Button>
      ) : null}
    </li>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-[var(--portal-border)] bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-[var(--portal-muted)]">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-[var(--portal-ink)]">
        {value}
      </p>
    </div>
  );
}

function parseHistoryPage(value: string | undefined) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.max(1, Math.round(parsed));
}

function parseHistoryRange(value: string | undefined): PortalCallCenterHistoryRange {
  if (value === "7d" || value === "all") {
    return value;
  }

  return "24h";
}

function parseHistoryView(value: string | undefined): PortalCallCenterHistoryView {
  return value === "connections" ? "connections" : "all";
}

function historyHref({
  page,
  range,
  view,
}: {
  page: number;
  range: PortalCallCenterHistoryRange;
  view: PortalCallCenterHistoryView;
}) {
  const params = new URLSearchParams();

  if (view !== "all") {
    params.set("view", view);
  }

  if (range !== "24h") {
    params.set("range", range);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();
  return query
    ? `/portal/app/call-center/history?${query}`
    : "/portal/app/call-center/history";
}

function historyRangeLabel(range: PortalCallCenterHistoryRange) {
  if (range === "24h") return "Last 24 hours";
  if (range === "7d") return "Last 7 days";
  return "All time";
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
  const direction = call.direction === "OUTBOUND" ? "Outbound" : "Inbound";
  const status =
    call.status === "ACTIVE"
      ? "Connected"
      : call.status === "MISSED"
        ? "Missed"
        : call.status.charAt(0) + call.status.slice(1).toLowerCase();
  return `${direction} · ${status}`;
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
