import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AnalyticsTabs } from "@/app/components/analytics-tabs";
import { CostsTab } from "@/app/components/analytics/costs-tab";
import { OverviewTab } from "@/app/components/analytics/overview-tab";
import { PerformanceTab } from "@/app/components/analytics/performance-tab";
import { QualityTab } from "@/app/components/analytics/quality-tab";
import { TokensTab } from "@/app/components/analytics/tokens-tab";
import { ToolsTab } from "@/app/components/analytics/tools-tab";
import { CallsTable } from "@/app/components/calls-table";
import { HealthKPIs } from "@/app/components/health-kpis";
import { TimeRangeTabs } from "@/app/components/time-range-tabs";
import { getAdminPracticeDetail, type AdminPracticeRange } from "@/lib/admin-analytics";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;
type AdminPracticeTab =
  | "overview"
  | "quality"
  | "performance"
  | "costs"
  | "tokens"
  | "tools";
type PracticeView = "command" | "analytics";

function parseRange(value: string | string[] | undefined): AdminPracticeRange {
  if (value === "24h" || value === "7d" || value === "30d" || value === "all") {
    return value;
  }

  return "24h";
}

function parseTab(value: string | string[] | undefined): AdminPracticeTab {
  if (
    value === "quality" ||
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
  return value === "analytics" ? "analytics" : "command";
}

function hrefWithParams(
  practiceId: string,
  params: { range: AdminPracticeRange; tab?: AdminPracticeTab; view: PracticeView },
) {
  const searchParams = new URLSearchParams();

  if (params.range !== "24h") {
    searchParams.set("range", params.range);
  }

  if (params.view === "analytics") {
    searchParams.set("view", "analytics");
  }

  if (params.view === "analytics" && params.tab && params.tab !== "overview") {
    searchParams.set("tab", params.tab);
  }

  const query = searchParams.toString();
  return `/admin/practices/${practiceId}${query ? `?${query}` : ""}`;
}

function PracticeViewTabs({
  practiceId,
  range,
  view,
}: {
  practiceId: string;
  range: AdminPracticeRange;
  view: PracticeView;
}) {
  const items = [
    { label: "Command Center", view: "command" },
    { label: "Analytics", view: "analytics" },
  ] as const;

  return (
    <nav className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Link
          key={item.view}
          href={hrefWithParams(practiceId, {
            range,
            view: item.view,
          })}
          className={cn(
            "flex items-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            view === item.view
              ? "bg-gray-900 text-white"
              : "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
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
  const detail = await getAdminPracticeDetail(practiceId, range);

  if (!detail) {
    notFound();
  }

  const data = detail.analyticsData;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <Link
        href="/admin/practices"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Practices
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {detail.practice.name}
        </h1>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Suspense>
            <TimeRangeTabs />
          </Suspense>
        </div>
      </div>

      <PracticeViewTabs practiceId={practiceId} range={range} view={view} />

      {view === "command" ? (
        <>
          <HealthKPIs data={detail.dashboardData} />

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">All Calls</h2>
            <CallsTable calls={detail.callRows} practiceId={practiceId} />
          </section>
        </>
      ) : (
        <>
          <Suspense>
            <AnalyticsTabs />
          </Suspense>

          {tab === "overview" && <OverviewTab data={data} />}
          {tab === "quality" && <QualityTab data={data} />}
          {tab === "performance" && <PerformanceTab data={data} />}
          {tab === "costs" && <CostsTab data={data} />}
          {tab === "tokens" && <TokensTab data={data} />}
          {tab === "tools" && <ToolsTab data={data} />}
        </>
      )}
    </main>
  );
}
