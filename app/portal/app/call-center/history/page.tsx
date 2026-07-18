import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PortalBadge } from "@/app/portal/app/PortalBadge";
import { LinkSegmentedControl } from "@/components/ui/link-segmented-control";
import {
  type PortalCallCenterHistoryRange,
  type PortalCallCenterHistoryView,
} from "@/lib/call-center/portal-model";
import { readCanonicalCallCenterHistory } from "@/lib/call-center/application/portal-canonical-history";
import { getPortalWorkspaceState } from "@/lib/portal-state";

import { PracticePageHeader } from "../../PracticePageHeader";
import { CallHistoryRow } from "./CallHistoryRow";

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
  const data = await readCanonicalCallCenterHistory(historyOptions);

  if (!data) {
    redirect("/portal");
  }

  const totalPages = Math.max(1, Math.ceil(data.totals.totalCalls / data.pageSize));

  if (data.totals.totalCalls > 0 && data.page > totalPages) {
    redirect(historyHref({ page: totalPages, range: data.range, view }));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
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
              Call Center
            </Link>
          </Button>
        </div>
      </PracticePageHeader>

      <section
        aria-label="Call totals"
        className="grid gap-px overflow-hidden rounded-2xl border border-[var(--portal-border)] bg-[var(--portal-border)] shadow-sm sm:grid-cols-2 lg:grid-cols-4"
      >
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

      <section className="overflow-hidden rounded-2xl border border-[var(--portal-border)] bg-white shadow-sm">
        <header className="space-y-4 border-b border-[var(--portal-border)] bg-[var(--portal-panel-soft)] px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-[var(--portal-ink)]">
                {view === "all" ? "All calls" : "Connected calls"}
              </h2>
              <p className="mt-1 text-sm text-[var(--portal-muted)]">
                {view === "all"
                  ? `Every call outcome · ${historyRangeLabel(data.range)}`
                  : `Answered calls · ${historyRangeLabel(data.range)}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <PortalBadge tone="soft">
                {data.totals.totalCalls} {view === "all" ? "calls" : "connections"}
              </PortalBadge>
              <PaginationControls
                page={data.page}
                range={data.range}
                totalPages={totalPages}
                view={view}
              />
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <HistoryViewTabs range={data.range} selectedView={view} />
            <HistoryRangeTabs selectedRange={data.range} view={view} />
          </div>
        </header>

        <div className="flex items-center justify-between border-b border-[var(--portal-border)] px-4 py-2.5 text-xs text-[var(--portal-muted)] sm:px-5">
          <span>
            {view === "all"
              ? "Completed, missed, voicemail, failed, and active calls"
              : "Answered call-center calls"}
          </span>
          <span className="hidden font-medium sm:inline">Most recent first</span>
        </div>

        {data.calls.length ? (
          <ul className="divide-y divide-[var(--portal-border)]">
            {data.calls.map((call) => (
              <CallHistoryRow call={call} key={call.id} />
            ))}
          </ul>
        ) : (
          <div className="px-5 py-14 text-center">
            <p className="text-sm font-medium text-[var(--portal-ink)]">
              {view === "all" ? "No calls found." : "No connected calls found."}
            </p>
            <p className="mt-1 text-xs text-[var(--portal-muted)]">
              {view === "all"
                ? "No calls were found for this time range."
                : "No connected calls were found for this time range."}
            </p>
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
      activeClassName="bg-white text-[var(--portal-ink)] shadow-sm"
      ariaLabel="Call history type"
      className="w-full border border-[var(--portal-border)] bg-white/60 sm:w-fit"
      inactiveClassName="text-[var(--portal-muted)] hover:text-[var(--portal-ink)]"
      itemClassName="flex-1 px-3 py-1.5 text-xs font-semibold sm:flex-none"
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
    { label: "24 hours", value: "24h" },
    { label: "7 days", value: "7d" },
    { label: "All time", value: "all" },
  ];

  return (
    <LinkSegmentedControl
      activeClassName="bg-white text-[var(--portal-ink)] shadow-sm"
      ariaLabel="History range"
      className="w-full border border-[var(--portal-border)] bg-white/60 sm:w-fit"
      inactiveClassName="text-[var(--portal-muted)] hover:text-[var(--portal-ink)]"
      itemClassName="flex-1 px-3 py-1.5 text-xs font-semibold sm:flex-none"
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
      <span className="rounded-full border border-[var(--portal-border)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--portal-muted)]">
        {page} of {totalPages}
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

function SummaryMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white px-5 py-4">
      <p className="truncate text-2xl font-semibold tabular-nums text-[var(--portal-ink)]">
        {value}
      </p>
      <p className="mt-1 text-xs font-medium text-[var(--portal-muted)]">{label}</p>
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
