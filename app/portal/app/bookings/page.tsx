import Link from "next/link";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";

import {
  getPortalBookings,
  type PortalBookedAppointment,
  type PortalOverviewRange,
} from "@/lib/portal-overview";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { cn } from "@/lib/utils";

import { PracticePageHeader } from "../PracticePageHeader";

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

  return (
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
                ? "border-[#0d7377] bg-[#e8f4f4] text-[#0d7377]"
                : "border-black/8 bg-white text-[#617477] hover:text-[#10272c]",
            )}
            href={bookingsHref({ office: item.id, query, range })}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
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

const appointmentDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  weekday: "short",
});

const zonedAppointmentDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "America/New_York",
  weekday: "short",
});

const callDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "America/New_York",
  year: "numeric",
});

function formatAppointment(value: string | null) {
  if (!value) return "—";
  const localMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (localMatch) {
    const [, year, month, day, hour, minute] = localMatch;
    return appointmentDateTimeFormatter.format(
      new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
      ),
    );
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return zonedAppointmentDateTimeFormatter.format(parsed);
  }
  return value;
}

function formatCallDate(date: Date) {
  return callDateFormatter.format(date);
}

function BookingRow({ booking }: { booking: PortalBookedAppointment }) {
  return (
    <tr className="border-b border-black/5 last:border-0">
      <td className="px-5 py-4 text-sm font-medium text-[#10272c]">
        {formatPhone(booking.callerPhone)}
      </td>
      <td className="px-5 py-4 text-sm text-[#10272c]">{booking.patientName ?? "—"}</td>
      <td className="px-5 py-4 text-sm text-[#10272c]">
        {formatAppointment(booking.appointmentStart)}
      </td>
      <td className="px-5 py-4 text-sm text-[#10272c]">{booking.providerName ?? "—"}</td>
      <td className="px-5 py-4 text-sm text-[#617477]">
        {formatCallDate(booking.callStartedAt)}
      </td>
      <td className="px-5 py-4 text-right">
        <Link
          className="inline-flex items-center rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-[#10272c] transition hover:bg-[#f1f5f5]"
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
          <p className="font-medium text-[#10272c]">
            {booking.patientName ?? "Unknown patient"}
          </p>
          <p className="mt-0.5 text-sm text-[#617477]">
            {formatPhone(booking.callerPhone)}
          </p>
        </div>
        <Link
          className="inline-flex shrink-0 items-center rounded-md border border-black/10 bg-white px-3 py-2 text-xs font-medium text-[#10272c] transition hover:bg-[#f1f5f5]"
          href={`/portal/app/calls/${booking.callId}`}
        >
          Transcript
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-black/6 bg-[#fafbfb] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-[#6f8083]">
            Appointment
          </p>
          <p className="mt-1 text-sm font-medium text-[#10272c]">
            {formatAppointment(booking.appointmentStart)}
          </p>
        </div>
        <div className="rounded-lg border border-black/6 bg-[#fafbfb] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-[#6f8083]">Doctor</p>
          <p className="mt-1 truncate text-sm font-medium text-[#10272c]">
            {booking.providerName ?? "—"}
          </p>
        </div>
        <div className="rounded-lg border border-black/6 bg-[#fafbfb] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-[#6f8083]">Booked</p>
          <p className="mt-1 text-sm font-medium text-[#10272c]">
            {formatCallDate(booking.callStartedAt)}
          </p>
        </div>
        <div className="rounded-lg border border-black/6 bg-[#fafbfb] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-[#6f8083]">Phone</p>
          <p className="mt-1 truncate text-sm font-medium text-[#10272c]">
            {formatPhone(booking.callerPhone)}
          </p>
        </div>
      </div>
    </article>
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
      <PracticePageHeader
        branding={result.branding}
        logoMeta={`${result.bookings.length} appointment${
          result.bookings.length === 1 ? "" : "s"
        }`}
        practiceName={result.practiceName}
        title="Bookings"
      >
        <div className="flex w-full flex-col gap-3 lg:w-auto lg:items-end">
          <OfficeFilterNav
            offices={result.officeFilters}
            query={result.searchQuery}
            range={result.range}
            selectedOfficeId={result.selectedOfficeId}
          />
          <nav
            aria-label="Bookings range"
            className="inline-flex w-full rounded-lg border border-black/8 bg-white p-1 sm:w-fit"
          >
            {rangeOptions.map((option) => {
              const isActive = option.value === result.range;
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
                  href={bookingsHref({
                    office: result.selectedOfficeId,
                    query: result.searchQuery,
                    range: option.value,
                  })}
                >
                  {option.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </PracticePageHeader>

      <form
        action="/portal/app/bookings"
        className="flex flex-col gap-3 rounded-xl border border-black/6 bg-white p-3 shadow-sm sm:flex-row sm:items-center"
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
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a999b]"
          />
          <input
            className="h-11 w-full rounded-lg border border-black/8 bg-white pl-9 pr-3 text-sm text-[#10272c] outline-none transition placeholder:text-[#8a999b] focus:border-[#0d7377] focus:ring-2 focus:ring-[#0d7377]/15"
            defaultValue={result.searchQuery ?? ""}
            id="bookings-search"
            name="q"
            placeholder="Search patient name or phone"
            type="search"
          />
        </div>
        <div className="flex gap-2">
          <button
            className="inline-flex h-11 items-center justify-center rounded-lg bg-[#10272c] px-4 text-sm font-medium text-white transition hover:bg-[#1a3a40]"
            type="submit"
          >
            Search
          </button>
          {result.searchQuery ? (
            <Link
              className="inline-flex h-11 items-center justify-center rounded-lg border border-black/10 bg-white px-4 text-sm font-medium text-[#10272c] transition hover:bg-[#f1f5f5]"
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
          <div className="px-5 py-10 text-center text-sm text-[#617477]">
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
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#6f8083]">
                      Phone
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#6f8083]">
                      Name
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#6f8083]">
                      Appointment
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#6f8083]">
                      Doctor
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#6f8083]">
                      Booked
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-[0.14em] text-[#6f8083]">
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
