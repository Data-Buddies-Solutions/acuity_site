import Link from "next/link";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";

import { PortalBadge } from "@/app/portal/app/PortalBadge";
import { LinkSegmentedControl } from "@/components/ui/link-segmented-control";
import {
  getPortalBookings,
  type PortalBookingCategorySummary,
  type PortalBookedAppointment,
  type PortalOverviewRange,
} from "@/lib/portal-overview";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { cn } from "@/lib/utils";
import { formatEasternAppointmentDateTime } from "@/lib/format";

const rangeOptions = [
  { label: "24 Hours", value: "24h" },
  { label: "7 Days", value: "7d" },
  { label: "30 Days", value: "30d" },
  { label: "All Time", value: "all" },
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

  if (office) {
    params.set("office", office);
  }

  if (query) {
    params.set("q", query);
  }

  return `/portal/app/bookings?${params.toString()}`;
}

function OfficeFilterNav({
  offices,
  query,
  range,
  selectedOfficeId,
}: {
  offices: Array<{ id: string; label: string }>;
  query: string | null;
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
    <section className="flex max-w-full flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-normal text-[var(--portal-muted-soft)]">
        Office: <span className="text-[#536a91]">{selectedOfficeLabel}</span>
      </p>
      <nav
        aria-label="Bookings office"
        className="flex max-w-full gap-2 overflow-x-auto pb-1"
      >
        {items.map((item) => {
          const isActive = item.id === selectedOfficeId;

          return (
            <Link
              key={item.id ?? "all"}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "min-w-fit rounded-lg border px-3 py-2 text-sm font-medium transition",
                isActive
                  ? "!border-[#536a91] !bg-[#536a91] !text-white shadow-sm hover:!text-white"
                  : "border-[var(--portal-border)] bg-white text-[var(--portal-muted)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]",
              )}
              href={bookingsHref({ office: item.id, query, range })}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </section>
  );
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone || "—";
}

const callDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "America/New_York",
  year: "numeric",
});

function formatAppointment(value: string | null) {
  return formatEasternAppointmentDateTime(value, "—");
}

function formatCallDate(date: Date) {
  return callDateFormatter.format(date);
}

function formatCareLane(careLane: PortalBookedAppointment["careLane"]) {
  if (careLane === "medical") return "Medical";
  if (careLane === "routine_vision") return "Routine vision";
  return "Unclassified";
}

function formatVisitType(visitType: PortalBookedAppointment["visitType"]) {
  if (visitType === "new") return "New";
  if (visitType === "follow_up_or_existing") return "Follow-up / existing";
  return "Unknown visit";
}

function BookingTypeBadges({ booking }: { booking: PortalBookedAppointment }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <PortalBadge className="rounded-md px-2 text-[11px] text-[var(--portal-ink-soft)]">
        {formatCareLane(booking.careLane)}
      </PortalBadge>
      <PortalBadge className="rounded-md px-2 text-[11px]" tone="accent">
        {formatVisitType(booking.visitType)}
      </PortalBadge>
    </div>
  );
}

function BookingTypeText({ booking }: { booking: PortalBookedAppointment }) {
  return (
    <div className="space-y-1.5">
      <BookingTypeBadges booking={booking} />
      <p className="max-w-52 truncate text-xs text-[var(--portal-muted)]">
        {booking.appointmentTypeName ?? "No appointment type"}
      </p>
    </div>
  );
}

function BookingRow({ booking }: { booking: PortalBookedAppointment }) {
  return (
    <tr className="border-b border-black/5 last:border-0">
      <td className="px-5 py-4 text-sm font-medium text-[var(--portal-ink)]">
        {formatPhone(booking.callerPhone)}
      </td>
      <td className="px-5 py-4 text-sm text-[var(--portal-ink)]">
        {booking.patientName ?? "—"}
      </td>
      <td className="px-5 py-4 text-sm text-[var(--portal-ink)]">
        {formatAppointment(booking.appointmentStart)}
      </td>
      <td className="px-5 py-4 text-sm text-[var(--portal-ink)]">
        <BookingTypeText booking={booking} />
      </td>
      <td className="px-5 py-4 text-sm text-[var(--portal-ink)]">
        {booking.providerName ?? "—"}
      </td>
      <td className="px-5 py-4 text-sm text-[var(--portal-muted)]">
        {formatCallDate(booking.callStartedAt)}
      </td>
      <td className="px-5 py-4 text-right">
        <Link
          className="inline-flex items-center rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-[var(--portal-ink)] transition hover:bg-[var(--portal-panel)]"
          href={`/portal/app/calls/${booking.callId}`}
        >
          Transcript
        </Link>
      </td>
    </tr>
  );
}

function BookingCard({ booking }: { booking: PortalBookedAppointment }) {
  return (
    <article className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-[var(--portal-ink)]">
            {booking.patientName ?? "Unknown patient"}
          </p>
          <p className="mt-0.5 text-sm text-[var(--portal-muted)]">
            {formatPhone(booking.callerPhone)}
          </p>
        </div>
        <Link
          className="inline-flex shrink-0 items-center rounded-md border border-black/10 bg-white px-3 py-2 text-xs font-medium text-[var(--portal-ink)] transition hover:bg-[var(--portal-panel)]"
          href={`/portal/app/calls/${booking.callId}`}
        >
          Transcript
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 rounded-lg border border-black/6 bg-[#fafbfb] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-[var(--portal-muted-soft)]">
            Appointment
          </p>
          <p className="mt-1 text-sm font-medium text-[var(--portal-ink)]">
            {formatAppointment(booking.appointmentStart)}
          </p>
        </div>
        <div className="rounded-lg border border-black/6 bg-[#fafbfb] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-[var(--portal-muted-soft)]">
            Type
          </p>
          <div className="mt-1">
            <BookingTypeText booking={booking} />
          </div>
        </div>
        <div className="rounded-lg border border-black/6 bg-[#fafbfb] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-[var(--portal-muted-soft)]">
            Doctor
          </p>
          <p className="mt-1 truncate text-sm font-medium text-[var(--portal-ink)]">
            {booking.providerName ?? "—"}
          </p>
        </div>
        <div className="rounded-lg border border-black/6 bg-[#fafbfb] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-[var(--portal-muted-soft)]">
            Booked
          </p>
          <p className="mt-1 text-sm font-medium text-[var(--portal-ink)]">
            {formatCallDate(booking.callStartedAt)}
          </p>
        </div>
        <div className="rounded-lg border border-black/6 bg-[#fafbfb] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-[var(--portal-muted-soft)]">
            Phone
          </p>
          <p className="mt-1 truncate text-sm font-medium text-[var(--portal-ink)]">
            {formatPhone(booking.callerPhone)}
          </p>
        </div>
      </div>
    </article>
  );
}

function BookingSummarySplit({ summary }: { summary: PortalBookingCategorySummary }) {
  if (summary.total === 0) {
    return null;
  }

  const rows = [
    {
      followLabel: "Follow-up",
      label: "Medical",
      value: summary.medical,
    },
    {
      followLabel: "Follow-up",
      label: "Routine vision",
      value: summary.routineVision,
    },
  ].filter((row) => row.value.total > 0);

  return (
    <div className="rounded-xl border border-[var(--portal-border)] bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-normal text-[var(--portal-muted-soft)]">
        Booking mix
      </p>
      <div className="mt-3 grid gap-3 sm:min-w-80 sm:grid-cols-2">
        {rows.map((row) => {
          const percent = summary.total > 0 ? row.value.total / summary.total : 0;

          return (
            <div key={row.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-[var(--portal-ink)]">{row.label}</span>
                <span className="font-semibold tabular-nums text-[#536a91]">
                  {row.value.total}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#edf0f5]">
                <div
                  className="h-full rounded-full bg-[#536a91]"
                  style={{ width: `${Math.max(4, Math.round(percent * 100))}%` }}
                />
              </div>
              <p className="text-xs text-[var(--portal-muted)]">
                New {row.value.newPatient} / {row.followLabel}{" "}
                {row.value.followUpOrExisting}
                {row.value.unknownVisitType > 0
                  ? ` / Unknown ${row.value.unknownVisitType}`
                  : ""}
              </p>
            </div>
          );
        })}
      </div>
      {summary.unknown.total > 0 ? (
        <p className="mt-3 border-t border-black/6 pt-2 text-xs text-[var(--portal-muted)]">
          Unclassified: {summary.unknown.total}
        </p>
      ) : null}
    </div>
  );
}

function BookingsSummary({
  count,
  summary,
}: {
  count: number;
  summary: PortalBookingCategorySummary;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-stretch">
      <div className="inline-flex items-end gap-3 rounded-xl border border-[var(--portal-border)] bg-white px-4 py-3 shadow-sm">
        <span className="font-mono text-3xl font-semibold leading-none tabular-nums text-[#536a91]">
          {count}
        </span>
        <span className="pb-0.5 text-sm font-semibold uppercase tracking-normal text-[var(--portal-muted)]">
          Total {count === 1 ? "appointment" : "appointments"}
        </span>
      </div>
      <BookingSummarySplit summary={summary} />
    </div>
  );
}

export default async function PortalBookingsPage({
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
  const query = parseQuery(params.q);
  const result = await getPortalBookings(range, null, office, query);

  if (!result) {
    redirect("/portal");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-4xl font-semibold leading-tight tracking-normal text-[#151a24] md:text-5xl">
            Bookings
          </h1>
          <BookingsSummary
            count={result.bookings.length}
            summary={result.bookingCategories}
          />
        </div>
        <div className="flex w-full flex-col gap-3 lg:w-auto lg:items-end">
          <OfficeFilterNav
            offices={result.officeFilters}
            query={result.searchQuery}
            range={result.range}
            selectedOfficeId={result.selectedOfficeId}
          />
          <LinkSegmentedControl
            activeClassName="bg-[var(--portal-accent)] text-white hover:text-white"
            ariaLabel="Bookings range"
            className="w-full border border-black/8 bg-white sm:w-fit"
            inactiveClassName="text-[var(--portal-muted)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]"
            itemClassName="flex-1 px-4 py-1.5 text-center text-sm sm:min-w-24"
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
      </section>

      <form
        action="/portal/app/bookings"
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
      >
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
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--portal-muted-soft)]"
          />
          <input
            className="h-12 w-full rounded-xl border border-[var(--portal-border-strong)] bg-white pl-10 pr-16 text-sm text-[var(--portal-ink)] shadow-sm outline-none transition placeholder:text-[var(--portal-muted-soft)] focus:border-[#536a91] focus:ring-2 focus:ring-[#536a91]/15"
            defaultValue={result.searchQuery ?? ""}
            id="bookings-search"
            name="q"
            placeholder="Search patient name or phone"
            type="search"
          />
          <button className="sr-only" type="submit">
            Search
          </button>
          {result.searchQuery ? (
            <Link
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#536a91] transition hover:text-[#435879]"
              href={bookingsHref({
                office: result.selectedOfficeId,
                range: result.range,
              })}
            >
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <section className="overflow-hidden rounded-xl border border-black/6 bg-white shadow-sm">
        {result.bookings.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[var(--portal-muted)]">
            {result.searchQuery
              ? "No bookings matched that search."
              : "No bookings in this range yet."}
          </div>
        ) : (
          <>
            <div className="divide-y divide-black/6 md:hidden">
              {result.bookings.map((booking) => (
                <BookingCard key={booking.callId} booking={booking} />
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-black/6 bg-[#fafbfb]">
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--portal-muted-soft)]">
                      Phone
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--portal-muted-soft)]">
                      Name
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--portal-muted-soft)]">
                      Appointment
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--portal-muted-soft)]">
                      Type
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--portal-muted-soft)]">
                      Doctor
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--portal-muted-soft)]">
                      Booked
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-[0.14em] text-[var(--portal-muted-soft)]">
                      <span className="sr-only">Transcript</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.bookings.map((booking) => (
                    <BookingRow key={booking.callId} booking={booking} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
