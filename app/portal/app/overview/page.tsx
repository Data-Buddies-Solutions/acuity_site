import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getPortalOverviewMetrics,
  type PortalOverviewRange,
} from "@/lib/portal-overview";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { cn } from "@/lib/utils";

import { PracticePageHeader } from "../PracticePageHeader";
import CallVolumeChart from "./CallVolumeChart";
import MetricCard from "./MetricCard";
import StaffTimeSavedCard from "./StaffTimeSavedCard";

const rangeOptions = [
  { href: "/portal/app/overview?range=24h", label: "24 Hours", value: "24h" },
  { href: "/portal/app/overview?range=7d", label: "7 Days", value: "7d" },
  { href: "/portal/app/overview?range=30d", label: "30 Days", value: "30d" },
  { href: "/portal/app/overview?range=all", label: "All Time", value: "all" },
] as const satisfies ReadonlyArray<{
  href: string;
  label: string;
  value: PortalOverviewRange;
}>;

const previousLabel: Record<PortalOverviewRange, string> = {
  "24h": "vs prior day",
  "30d": "vs last month",
  "7d": "vs last week",
  all: "",
};

type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;

function parseRange(value: string | string[] | undefined): PortalOverviewRange {
  if (value === "24h" || value === "7d" || value === "30d" || value === "all") {
    return value;
  }
  return "24h";
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCallDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatRate(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    style: "percent",
  }).format(value);
}

function formatTodayLabel() {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
  }).format(new Date());
}

function buildDelta(current: number, previous: number) {
  if (previous <= 0) {
    return null;
  }
  const diff = current - previous;
  const ratio = diff / previous;
  return {
    direction:
      diff === 0 ? ("flat" as const) : diff > 0 ? ("up" as const) : ("down" as const),
    label: `${Math.round(Math.abs(ratio) * 100)}%`,
  };
}

export default async function PortalOverviewPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  const params = searchParams ? await searchParams : {};
  const range = parseRange(params.range);
  const metrics = await getPortalOverviewMetrics(range);

  if (!metrics) {
    redirect("/portal");
  }

  const callsDelta =
    metrics.range === "all"
      ? null
      : buildDelta(metrics.totalCalls, metrics.previousTotalCalls);
  const periodNote = previousLabel[range];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PracticePageHeader
        branding={metrics.branding}
        logoMeta={formatTodayLabel()}
        practiceName={metrics.practiceName}
        title="Overview"
      >
        <nav
          aria-label="Overview range"
          className="inline-flex w-full rounded-lg border border-black/8 bg-white p-1 sm:w-fit"
        >
          {rangeOptions.map((option) => {
            const isActive = option.value === metrics.range;
            return (
              <Link
                key={option.value}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex-1 rounded-md px-4 py-1.5 text-center text-sm font-medium transition sm:min-w-24",
                  isActive
                    ? "bg-[#10272c] text-white shadow-sm hover:text-white"
                    : "text-[#617477] hover:bg-[#f1f5f5] hover:text-[#10272c]",
                )}
                href={option.href}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>
      </PracticePageHeader>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          delta={
            callsDelta
              ? {
                  direction: callsDelta.direction,
                  label: `${callsDelta.label} ${periodNote}`,
                }
              : null
          }
          label="Call Volume"
          value={formatInteger(metrics.totalCalls)}
        />
        <MetricCard
          label="Transfer Rate"
          note={`${formatInteger(metrics.transferredCalls)} of ${formatInteger(metrics.totalCalls)} calls`}
          value={formatRate(metrics.transferRate)}
        />
        <MetricCard
          label="Bookings"
          value={formatInteger(metrics.appointmentActions.booked)}
        />
        <MetricCard
          label="Average Call Duration"
          value={formatCallDuration(metrics.averageCallDurationSec)}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CallVolumeChart points={metrics.callVolume} />
        </div>
        <StaffTimeSavedCard
          buckets={metrics.staffTimeSaved.buckets}
          totalSeconds={metrics.staffTimeSaved.totalSeconds}
        />
      </section>
    </div>
  );
}
