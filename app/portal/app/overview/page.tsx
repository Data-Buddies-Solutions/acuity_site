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
  { label: "24 Hours", value: "24h" },
  { label: "7 Days", value: "7d" },
  { label: "30 Days", value: "30d" },
  { label: "All Time", value: "all" },
] as const satisfies ReadonlyArray<{
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

function parseOffice(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

function overviewHref({
  office,
  range,
}: {
  office?: string | null;
  range: PortalOverviewRange;
}) {
  const params = new URLSearchParams();

  params.set("range", range);

  if (office) {
    params.set("office", office);
  }

  return `/portal/app/overview?${params.toString()}`;
}

function OfficeFilterNav({
  offices,
  range,
  selectedOfficeId,
}: {
  offices: Array<{ id: string; label: string }>;
  range: PortalOverviewRange;
  selectedOfficeId: string | null;
}) {
  if (offices.length <= 1) {
    return null;
  }

  const items = [{ id: null, label: "All Offices" }, ...offices];
  const selectedOfficeLabel =
    items.find((item) => item.id === selectedOfficeId)?.label ?? "All Offices";

  return (
    <section className="flex max-w-full flex-col gap-1.5 lg:items-end">
      <p className="text-xs font-semibold uppercase tracking-normal text-[var(--portal-muted-soft)]">
        Office: <span className="text-[#536a91]">{selectedOfficeLabel}</span>
      </p>
      <nav
        aria-label="Overview office"
        className="flex max-w-full gap-2 overflow-x-auto pb-1"
      >
        {items.map((item) => {
          const isActive = item.id === selectedOfficeId;

          return (
            <Link
              key={item.id ?? "all"}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex h-10 min-w-fit items-center rounded-xl border px-4 text-sm font-medium transition",
                isActive
                  ? "!border-[#536a91] !bg-[#536a91] !text-white shadow-sm hover:!text-white"
                  : "border-[var(--portal-border)] bg-white text-[var(--portal-muted)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]",
              )}
              href={overviewHref({ office: item.id, range })}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </section>
  );
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatHoursMinutes(seconds: number) {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
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

function rangeNarrative(range: PortalOverviewRange) {
  if (range === "24h") return "in the last 24 hours";
  if (range === "7d") return "in the last 7 days";
  if (range === "30d") return "in the last 30 days";
  return "since launch";
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

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  return value === 1 ? singular : plural;
}

function OverviewBrief({
  bookedAppointments,
  callsHandled,
  frontDeskTimeCovered,
  range,
  selectedOfficeLabel,
  transferredCalls,
}: {
  bookedAppointments: number;
  callsHandled: number;
  frontDeskTimeCovered: number;
  range: PortalOverviewRange;
  selectedOfficeLabel: string | null;
  transferredCalls: number;
}) {
  const scope = selectedOfficeLabel ? ` for ${selectedOfficeLabel}` : "";

  return (
    <section className="rounded-xl border border-[#cfd5e2] bg-white px-5 py-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_rgba(16,24,40,0.04)] transition duration-150 hover:border-[#b9c4dd] hover:shadow-[0_2px_4px_rgba(16,24,40,0.06),0_16px_34px_rgba(16,24,40,0.08)] md:px-6">
      <p className="text-sm font-medium tracking-normal text-[#8a94a6]">
        Operating Brief
      </p>
      <p className="mt-2 max-w-4xl text-2xl font-semibold leading-snug tracking-normal text-[#151a24] md:text-3xl">
        Acuity handled {formatInteger(callsHandled)} patient{" "}
        {pluralize(callsHandled, "call")}
        {scope} {rangeNarrative(range)}.
      </p>
      <p className="mt-2 max-w-3xl text-base leading-7 text-[#667085]">
        {formatInteger(bookedAppointments)} {pluralize(bookedAppointments, "appointment")}{" "}
        booked, {formatInteger(transferredCalls)} {pluralize(transferredCalls, "call")}{" "}
        sent to staff, and {formatHoursMinutes(frontDeskTimeCovered)} of front desk time
        covered.
      </p>
    </section>
  );
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
  const office = parseOffice(params.office);
  const metrics = await getPortalOverviewMetrics(range, office);

  if (!metrics) {
    redirect("/portal");
  }

  const callsDelta =
    metrics.range === "all"
      ? null
      : buildDelta(metrics.totalCalls, metrics.previousTotalCalls);
  const periodNote = previousLabel[range];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PracticePageHeader
        branding={metrics.branding}
        logoMeta={formatTodayLabel()}
        practiceName={metrics.practiceName}
        showLogo={false}
        title="Overview"
      >
        <div className="flex w-full flex-col gap-3 lg:w-auto lg:items-end">
          <OfficeFilterNav
            offices={metrics.officeFilters}
            range={metrics.range}
            selectedOfficeId={metrics.selectedOfficeId}
          />
          <section className="flex max-w-full flex-col gap-1.5 lg:items-end">
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--portal-muted-soft)]">
              Date range
            </p>
            <nav
              aria-label="Overview range"
              className="inline-flex h-10 w-full max-w-full rounded-lg border border-[var(--portal-border)] bg-white p-1 sm:w-fit"
            >
              {rangeOptions.map((option) => {
                const isActive = option.value === metrics.range;
                return (
                  <Link
                    key={option.value}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex flex-1 items-center justify-center rounded-md px-4 text-sm font-medium transition sm:min-w-24",
                      isActive
                        ? "!bg-[#536a91] !text-white shadow-sm hover:!text-white"
                        : "text-[#667085] hover:bg-[#f5f7fb] hover:text-[#1f2937]",
                    )}
                    href={overviewHref({
                      office: metrics.selectedOfficeId,
                      range: option.value,
                    })}
                  >
                    {option.label}
                  </Link>
                );
              })}
            </nav>
          </section>
        </div>
      </PracticePageHeader>

      <OverviewBrief
        bookedAppointments={metrics.appointmentActions.booked}
        callsHandled={metrics.totalCalls}
        frontDeskTimeCovered={metrics.staffTimeSaved.totalSeconds}
        range={metrics.range}
        selectedOfficeLabel={metrics.selectedOfficeLabel}
        transferredCalls={metrics.transferredCalls}
      />

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
          label="Patient Calls Handled"
          value={formatInteger(metrics.totalCalls)}
        />
        <MetricCard
          label="Appointments Booked"
          value={formatInteger(metrics.appointmentActions.booked)}
        />
        <MetricCard
          label="Sent to Staff"
          note={`${formatRate(metrics.transferRate)} of calls`}
          value={formatInteger(metrics.transferredCalls)}
        />
        <MetricCard
          label="Average Call Duration"
          note={`${formatInteger(metrics.totalCallMinutes)} total minutes handled`}
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
