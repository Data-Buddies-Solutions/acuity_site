import { redirect } from "next/navigation";

import { PortalQuerySelect } from "@/app/portal/app/PortalQuerySelect";
import { LinkSegmentedControl } from "@/components/ui/link-segmented-control";
import {
  getPortalOverviewMetrics,
  type PortalBookingCategorySummary,
  type PortalOverviewRange,
} from "@/lib/portal-overview";
import { getPortalWorkspaceState } from "@/lib/portal-state";

import { PracticePageHeader } from "../PracticePageHeader";
import CallVolumeChart from "./CallVolumeChart";
import StaffTimeSavedCard from "./StaffTimeSavedCard";

const rangeOptions = [
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "All", value: "all" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: PortalOverviewRange;
}>;

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
  if (office) params.set("office", office);
  return `/portal/app/overview?${params.toString()}`;
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPercentage(value: number) {
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

function Metric({
  children,
  label,
  value,
}: {
  children?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 flex-col px-5 py-4 lg:px-6">
      <p className="text-sm font-medium text-[var(--portal-muted)]">{label}</p>
      <p className="mt-1.5 font-mono text-[1.75rem] font-semibold leading-none tabular-nums text-[var(--portal-ink)]">
        {value}
      </p>
      {children}
    </div>
  );
}

function BookingMixBar({ summary }: { summary: PortalBookingCategorySummary }) {
  if (summary.total === 0) {
    return (
      <p className="mt-2 text-xs text-[var(--portal-muted-soft)]">No bookings yet</p>
    );
  }

  const medicalWidth = (summary.medical.total / summary.total) * 100;
  const routineWidth = (summary.routineVision.total / summary.total) * 100;
  const unknownWidth = (summary.unknown.total / summary.total) * 100;

  return (
    <div className="mt-3">
      <div
        aria-label={`${summary.medical.total} medical and ${summary.routineVision.total} routine vision appointments`}
        className="flex h-2 overflow-hidden rounded-full bg-[var(--portal-panel)]"
        role="img"
      >
        {medicalWidth > 0 ? (
          <span
            className="bg-[var(--portal-accent)]"
            style={{ width: `${medicalWidth}%` }}
          />
        ) : null}
        {routineWidth > 0 ? (
          <span className="bg-[#9aa9c3]" style={{ width: `${routineWidth}%` }} />
        ) : null}
        {unknownWidth > 0 ? (
          <span className="bg-[#d8dde8]" style={{ width: `${unknownWidth}%` }} />
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--portal-muted)]">
        <span>
          <span className="mr-1.5 inline-block size-2 rounded-full bg-[var(--portal-accent)]" />
          Medical {formatInteger(summary.medical.total)}
        </span>
        <span>
          <span className="mr-1.5 inline-block size-2 rounded-full bg-[#9aa9c3]" />
          Vision {formatInteger(summary.routineVision.total)}
        </span>
      </div>
    </div>
  );
}

export default async function PortalOverviewPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) redirect("/portal/app/onboarding");

  const params = searchParams ? await searchParams : {};
  const range = parseRange(params.range);
  const office = parseOffice(params.office);
  const metrics = await getPortalOverviewMetrics(range, office);

  if (!metrics) redirect("/portal");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 lg:h-[calc(100dvh-8rem)]">
      <PracticePageHeader
        branding={metrics.branding}
        eyebrow={formatTodayLabel()}
        practiceName={metrics.practiceName}
        showLogo={false}
        size="compact"
        title="Overview"
      >
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          {metrics.officeFilters.length > 1 ? (
            <PortalQuerySelect
              ariaLabel="Office"
              options={[
                { label: "All offices", value: "" },
                ...metrics.officeFilters.map((item) => ({
                  label: item.label,
                  value: item.id,
                })),
              ]}
              param="office"
              value={metrics.selectedOfficeId ?? ""}
            />
          ) : null}
          <LinkSegmentedControl
            activeClassName="bg-[var(--portal-accent)] text-white hover:text-white"
            ariaLabel="Overview range"
            className="h-10 w-full border border-[var(--portal-border)] bg-white sm:w-fit"
            inactiveClassName="text-[var(--portal-muted)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]"
            itemClassName="flex-1 px-3 sm:min-w-14"
            items={rangeOptions.map((option) => ({
              href: overviewHref({
                office: metrics.selectedOfficeId,
                range: option.value,
              }),
              label: option.label,
              value: option.value,
            }))}
            value={metrics.range}
          />
        </div>
      </PracticePageHeader>

      <section
        aria-label="Key performance metrics"
        className="grid overflow-hidden rounded-xl border border-[var(--portal-border)] bg-white shadow-sm sm:grid-cols-3 sm:divide-x sm:divide-[var(--portal-border)]"
      >
        <Metric label="Calls handled" value={formatInteger(metrics.totalCalls)} />
        <Metric
          label="Appointments booked"
          value={formatInteger(metrics.appointmentActions.booked)}
        >
          <BookingMixBar summary={metrics.bookingCategories} />
        </Metric>
        <Metric label="Sent to staff" value={formatPercentage(metrics.transferRate)} />
      </section>

      <section className="grid min-h-[310px] flex-1 overflow-hidden rounded-xl border border-[var(--portal-border)] bg-white shadow-sm lg:min-h-0 lg:grid-cols-3">
        <div className="min-h-0 lg:col-span-2">
          <CallVolumeChart
            points={metrics.callVolume}
            totalMinutes={formatInteger(metrics.totalCallMinutes)}
          />
        </div>
        <div className="border-t border-[var(--portal-border)] lg:border-l lg:border-t-0">
          <StaffTimeSavedCard buckets={metrics.staffTimeSaved.buckets} />
        </div>
      </section>
    </div>
  );
}
