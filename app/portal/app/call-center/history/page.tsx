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

import { Button } from "@/app/components/ui/button";
import {
  getPortalCallCenterHistoryData,
  type PortalCallCenterHistoryRange,
  type PortalRecentCallItem,
} from "@/lib/call-center";
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
  const page = parseHistoryPage(Array.isArray(params.page) ? params.page[0] : params.page);
  const range = parseHistoryRange(
    Array.isArray(params.range) ? params.range[0] : params.range,
  );
  const data = await getPortalCallCenterHistoryData({
    page,
    pageSize: HISTORY_PAGE_SIZE,
    range,
  });

  if (!data) {
    redirect("/portal");
  }

  const totalPages = Math.max(1, Math.ceil(data.totals.totalCalls / data.pageSize));

  if (data.totals.totalCalls > 0 && data.page > totalPages) {
    redirect(historyHref({ page: totalPages, range: data.range }));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PracticePageHeader
        branding={data.branding}
        practiceName={data.practiceName}
        title="Call Center History"
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
        <SummaryMetric label="Total calls" value={data.totals.totalCalls} />
        <SummaryMetric label="Inbound" value={data.totals.inboundCalls} />
        <SummaryMetric label="Outbound" value={data.totals.outboundCalls} />
        <SummaryMetric label="Outbound dialed" value={data.totals.outboundDialedCalls} />
      </section>

      <section className="rounded-xl border border-black/6 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#10272c]">Time range</h2>
            <p className="mt-0.5 text-xs text-[#617477]">
              {historyRangeLabel(data.range)}
            </p>
          </div>
          <HistoryRangeTabs selectedRange={data.range} />
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-black/6 bg-white shadow-sm">
        <header className="flex flex-col gap-3 border-b border-black/6 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#10272c]">Call history</h2>
            <p className="mt-0.5 text-xs text-[#617477]">
              Inbound and outbound activity for the selected range.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-black/8 px-2.5 py-1 text-xs font-semibold text-[#617477]">
              {data.totals.totalCalls} calls
            </span>
            <PaginationControls
              page={data.page}
              range={data.range}
              totalPages={totalPages}
            />
          </div>
        </header>

        {data.calls.length ? (
          <ul className="divide-y divide-black/5">
            {data.calls.map((call) => (
              <HistoryRow call={call} key={call.id} />
            ))}
          </ul>
        ) : (
          <div className="px-5 py-12 text-center text-sm text-[#617477]">
            No call history yet.
          </div>
        )}
      </section>
    </div>
  );
}

function HistoryRangeTabs({
  selectedRange,
}: {
  selectedRange: PortalCallCenterHistoryRange;
}) {
  const options: Array<{ label: string; value: PortalCallCenterHistoryRange }> = [
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
            href={historyHref({ page: 1, range: option.value })}
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
  range,
  totalPages,
}: {
  page: number;
  range: PortalCallCenterHistoryRange;
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
          <Link aria-label="Previous page" href={historyHref({ page: page - 1, range })}>
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
          <Link aria-label="Next page" href={historyHref({ page: page + 1, range })}>
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
            className="h-4 w-4 shrink-0 text-[#0d7377]"
          />
          {numberHref ? (
            <Link
              className="block truncate text-sm font-semibold text-[#0d7377] underline-offset-2 hover:underline"
              href={numberHref}
            >
              {formatPhone(patientPhone)}
            </Link>
          ) : (
            <p className="truncate text-sm font-semibold text-[#10272c]">
              {formatPhone(patientPhone)}
            </p>
          )}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-[#617477]">
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
    <div className="rounded-xl border border-black/6 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-[#617477]">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-[#10272c]">{value}</p>
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

function historyHref({
  page,
  range,
}: {
  page: number;
  range: PortalCallCenterHistoryRange;
}) {
  const params = new URLSearchParams();

  if (range !== "24h") {
    params.set("range", range);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();
  return query ? `/portal/app/call-center/history?${query}` : "/portal/app/call-center/history";
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
  if (call.status === "MISSED") {
    return "Missed call";
  }

  if (call.status === "VOICEMAIL") {
    return "Voicemail";
  }

  return call.direction === "OUTBOUND" ? "Outbound" : "Inbound";
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
