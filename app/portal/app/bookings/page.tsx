import Link from "next/link";
import { redirect } from "next/navigation";
import { Search, X } from "lucide-react";

import { PortalQuerySelect } from "@/app/portal/app/PortalQuerySelect";
import { PracticePageHeader } from "@/app/portal/app/PracticePageHeader";
import { Input } from "@/components/ui/input";
import { LinkSegmentedControl } from "@/components/ui/link-segmented-control";
import {
  getPortalBookings,
  type PortalBookingCategorySummary,
  type PortalOverviewRange,
} from "@/lib/portal-overview";
import { getPortalWorkspaceState } from "@/lib/portal-state";

import { BookingsTable } from "./BookingsTable";

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

function parseQuery(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const query = raw?.replace(/\s+/g, " ").trim() ?? "";
  return query || null;
}

function bookingsHref({
  office,
  query,
  range,
}: {
  office?: string | null;
  query?: string | null;
  range: PortalOverviewRange;
}) {
  const params = new URLSearchParams();
  params.set("range", range);
  if (office) params.set("office", office);
  if (query) params.set("q", query);
  return `/portal/app/bookings?${params.toString()}`;
}

function rangeLabel(range: PortalOverviewRange) {
  if (range === "24h") return "in the last 24 hours";
  if (range === "7d") return "in the last 7 days";
  if (range === "30d") return "in the last 30 days";
  return "since launch";
}

function BookingMix({ summary }: { summary: PortalBookingCategorySummary }) {
  if (summary.total === 0) return null;

  const medicalWidth = (summary.medical.total / summary.total) * 100;
  const routineWidth = (summary.routineVision.total / summary.total) * 100;
  const unknownWidth = (summary.unknown.total / summary.total) * 100;

  return (
    <section
      aria-label="Booking mix"
      className="grid gap-2 border-y border-[var(--portal-border)] py-3 sm:grid-cols-[auto_minmax(240px,1fr)] sm:items-center sm:gap-6"
    >
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span className="font-medium text-[var(--portal-ink)]">
          Medical{" "}
          <span className="font-mono tabular-nums text-[var(--portal-accent)]">
            {summary.medical.total}
          </span>
        </span>
        <span className="font-medium text-[var(--portal-ink)]">
          Routine vision{" "}
          <span className="font-mono tabular-nums text-[var(--portal-accent)]">
            {summary.routineVision.total}
          </span>
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-[var(--portal-panel)]">
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
    </section>
  );
}

export default async function PortalBookingsPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const portalState = await getPortalWorkspaceState();
  if (!portalState.launched) redirect("/portal/app/onboarding");

  const params = searchParams ? await searchParams : {};
  const range = parseRange(params.range);
  const office = parseOffice(params.office);
  const query = parseQuery(params.q);
  const result = await getPortalBookings(range, null, office, query);

  if (!result) redirect("/portal");

  const count = result.bookings.length;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PracticePageHeader
        branding={result.branding}
        logoMeta={`${count} ${count === 1 ? "appointment" : "appointments"} booked ${rangeLabel(result.range)}`}
        practiceName={result.practiceName}
        showLogo={false}
        size="compact"
        title="Bookings"
      >
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          {result.officeFilters.length > 1 ? (
            <PortalQuerySelect
              ariaLabel="Office"
              options={[
                { label: "All offices", value: "" },
                ...result.officeFilters.map((item) => ({
                  label: item.label,
                  value: item.id,
                })),
              ]}
              param="office"
              value={result.selectedOfficeId ?? ""}
            />
          ) : null}
          <LinkSegmentedControl
            activeClassName="bg-[var(--portal-accent)] text-white hover:text-white"
            ariaLabel="Booked date range"
            className="h-10 w-full border border-[var(--portal-border)] bg-white sm:w-fit"
            inactiveClassName="text-[var(--portal-muted)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]"
            itemClassName="flex-1 px-3 sm:min-w-14"
            items={rangeOptions.map((option) => ({
              href: bookingsHref({
                office: result.selectedOfficeId,
                query: result.searchQuery,
                range: option.value,
              }),
              label: option.label,
              value: option.value,
            }))}
            value={result.range}
          />
        </div>
      </PracticePageHeader>

      <BookingMix summary={result.bookingCategories} />

      <form action="/portal/app/bookings" className="flex items-center gap-3">
        <input name="range" type="hidden" value={result.range} />
        {result.selectedOfficeId ? (
          <input name="office" type="hidden" value={result.selectedOfficeId} />
        ) : null}
        <label className="sr-only" htmlFor="bookings-search">
          Search bookings
        </label>
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--portal-muted-soft)]"
          />
          <Input
            className="h-10 rounded-lg border-[var(--portal-border)] pl-9"
            defaultValue={result.searchQuery ?? ""}
            id="bookings-search"
            name="q"
            placeholder="Search patient name or phone"
            type="search"
          />
        </div>
        <button className="sr-only" type="submit">
          Search
        </button>
      </form>

      {result.selectedOfficeId || result.searchQuery ? (
        <div
          aria-label="Active booking filters"
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-xs font-medium text-[var(--portal-muted)]">Filters</span>
          {result.selectedOfficeId ? (
            <Link
              className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--portal-accent-soft)] px-3 text-xs font-medium text-[var(--portal-accent)] hover:text-[var(--portal-accent-hover)]"
              href={bookingsHref({
                query: result.searchQuery,
                range: result.range,
              })}
            >
              {result.selectedOfficeLabel}
              <X className="size-3" aria-hidden="true" />
              <span className="sr-only">Remove office filter</span>
            </Link>
          ) : null}
          {result.searchQuery ? (
            <Link
              className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-[var(--portal-panel)] px-3 text-xs font-medium text-[var(--portal-ink-soft)] hover:text-[var(--portal-ink)]"
              href={bookingsHref({
                office: result.selectedOfficeId,
                range: result.range,
              })}
            >
              <span className="truncate">Search: {result.searchQuery}</span>
              <X className="size-3 shrink-0" aria-hidden="true" />
              <span className="sr-only">Remove search filter</span>
            </Link>
          ) : null}
        </div>
      ) : null}

      {count === 0 ? (
        <section className="rounded-xl border border-dashed border-[var(--portal-border)] bg-white px-5 py-12 text-center">
          <p className="text-sm font-medium text-[var(--portal-ink)]">
            {result.searchQuery
              ? "No bookings matched that search"
              : "No bookings in this range"}
          </p>
          <p className="mt-1 text-sm text-[var(--portal-muted)]">
            {result.searchQuery
              ? "Try a patient name or phone number."
              : "New appointments booked by Acuity will appear here."}
          </p>
        </section>
      ) : (
        <BookingsTable
          bookings={result.bookings}
          showLocation={!result.selectedOfficeId}
        />
      )}
    </div>
  );
}
