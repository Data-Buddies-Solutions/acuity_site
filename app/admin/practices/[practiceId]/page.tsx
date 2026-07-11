import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AnalyticsTabs } from "@/app/components/analytics-tabs";
import { CostsTab } from "@/app/components/analytics/costs-tab";
import { OverviewTab } from "@/app/components/analytics/overview-tab";
import { PerformanceTab } from "@/app/components/analytics/performance-tab";
import { TokensTab } from "@/app/components/analytics/tokens-tab";
import { ToolsTab } from "@/app/components/analytics/tools-tab";
import { CallsTable } from "@/app/components/calls-table";
import { HealthKPIs } from "@/app/components/health-kpis";
import { OfficeFilterTabs } from "@/app/components/office-filter-tabs";
import { TimeRangeTabs } from "@/app/components/time-range-tabs";
import { LinkSegmentedControl } from "@/components/ui/link-segmented-control";
import {
  getAdminPracticeDetail,
  type AdminPracticeCallSet,
  type AdminPracticeRange,
} from "@/lib/admin-analytics";
import { parseCallTableState } from "@/lib/admin-call-table-state";
import { CallCenterMigrationReport } from "./CallCenterMigrationReport";

export const dynamic = "force-dynamic";

type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;
type AdminPracticeTab = "overview" | "performance" | "costs" | "tokens" | "tools";
type PracticeView = "analytics" | "bad" | "call-center" | "command" | "golden";

function parseRange(value: string | string[] | undefined): AdminPracticeRange {
  if (value === "24h" || value === "7d" || value === "30d" || value === "all") {
    return value;
  }

  return "24h";
}

function parseTab(value: string | string[] | undefined): AdminPracticeTab {
  if (
    value === "performance" ||
    value === "costs" ||
    value === "tokens" ||
    value === "tools"
  ) {
    return value;
  }

  return "overview";
}

function parseView(value: string | string[] | undefined): PracticeView {
  if (
    value === "analytics" ||
    value === "bad" ||
    value === "call-center" ||
    value === "golden"
  ) {
    return value;
  }

  return "command";
}

function parseOfficeFilter(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

function callSetForView(view: PracticeView): AdminPracticeCallSet {
  if (view === "bad") return "bad";
  if (view === "golden") return "golden";
  return "all";
}

function hrefWithParams(
  practiceId: string,
  params: {
    office?: string | null;
    range: AdminPracticeRange;
    tab?: AdminPracticeTab;
    view: PracticeView;
  },
) {
  const searchParams = new URLSearchParams();

  if (params.range !== "24h") {
    searchParams.set("range", params.range);
  }

  if (params.view !== "command") {
    searchParams.set("view", params.view);
  }

  if (params.view === "analytics" && params.tab && params.tab !== "overview") {
    searchParams.set("tab", params.tab);
  }

  if (params.office) {
    searchParams.set("office", params.office);
  }

  const query = searchParams.toString();
  return `/admin/practices/${practiceId}${query ? `?${query}` : ""}`;
}

function PracticeViewTabs({
  practiceId,
  range,
  office,
  view,
}: {
  office: string | null;
  practiceId: string;
  range: AdminPracticeRange;
  view: PracticeView;
}) {
  const items = [
    { label: "Command", view: "command" },
    { label: "Golden", view: "golden" },
    { label: "Bad", view: "bad" },
    { label: "Analytics", view: "analytics" },
    { label: "Call center", view: "call-center" },
  ] as const;

  return (
    <LinkSegmentedControl
      ariaLabel="Practice view"
      className="grid w-full grid-cols-2 sm:inline-grid sm:w-fit sm:grid-cols-5"
      itemClassName="min-h-8 px-3 py-1.5 text-xs"
      items={items.map((item) => ({
        href: hrefWithParams(practiceId, {
          office,
          range,
          view: item.view,
        }),
        label: item.label,
        value: item.view,
      }))}
      value={view}
    />
  );
}

export default async function AdminPracticeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ practiceId: string }>;
  searchParams: SearchParamsInput;
}) {
  const [{ practiceId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const range = parseRange(resolvedSearchParams.range);
  const tab = parseTab(resolvedSearchParams.tab);
  const view = parseView(resolvedSearchParams.view);
  const office = parseOfficeFilter(resolvedSearchParams.office);
  const tableState = parseCallTableState(resolvedSearchParams);
  const detail = await getAdminPracticeDetail(practiceId, range, office, {
    callSet: callSetForView(view),
    includeAnalytics: view === "analytics",
    includeDashboard: view === "command",
    includeTable: view !== "analytics",
    tableState,
  });

  if (!detail) {
    notFound();
  }

  const data = detail.analyticsData;
  const selectedOffice =
    detail.officeFilters.find((office) => office.id === detail.selectedOfficeId) ?? null;
  const callSetTitle =
    view === "golden"
      ? "Golden Calls"
      : view === "bad"
        ? "Bad Calls"
        : selectedOffice
          ? `${selectedOffice.label} Calls`
          : "All Calls";

  return (
    <div className="mx-auto max-w-6xl space-y-4 md:space-y-6">
      <Link
        href="/admin/practices"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Practices
      </Link>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Practice
            </p>
            <h1 className="mt-1 break-words text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
              {detail.practice.name}
            </h1>
          </div>
          <div className="grid w-full gap-2 lg:w-auto lg:min-w-[360px] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <Suspense>
              <OfficeFilterTabs
                offices={detail.officeFilters}
                selectedOfficeId={detail.selectedOfficeId}
              />
            </Suspense>
            <Suspense>
              <TimeRangeTabs />
            </Suspense>
          </div>
        </div>

        <PracticeViewTabs
          office={detail.selectedOfficeId}
          practiceId={practiceId}
          range={range}
          view={view}
        />
      </div>

      {view === "call-center" ? (
        <Suspense>
          <CallCenterMigrationReport practiceId={practiceId} />
        </Suspense>
      ) : view === "command" ? (
        <>
          {detail.dashboardData ? <HealthKPIs data={detail.dashboardData} /> : null}

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">{callSetTitle}</h2>
            <Suspense>
              {detail.callTable ? (
                <CallsTable callTable={detail.callTable} practiceId={practiceId} />
              ) : null}
            </Suspense>
          </section>
        </>
      ) : view === "golden" || view === "bad" ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{callSetTitle}</h2>
          <Suspense>
            {detail.callTable ? (
              <CallsTable callTable={detail.callTable} practiceId={practiceId} />
            ) : null}
          </Suspense>
        </section>
      ) : (
        <>
          <Suspense>
            <AnalyticsTabs />
          </Suspense>

          {data && tab === "overview" && <OverviewTab data={data} />}
          {data && tab === "performance" && <PerformanceTab data={data} />}
          {data && tab === "costs" && <CostsTab data={data} />}
          {data && tab === "tokens" && <TokensTab data={data} />}
          {data && tab === "tools" && <ToolsTab data={data} />}
        </>
      )}
    </div>
  );
}
