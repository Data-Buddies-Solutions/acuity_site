import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getPortalBookings,
  type PortalBookedAppointment,
  type PortalOverviewRange,
} from "@/lib/portal-overview";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { cn } from "@/lib/utils";

import { PracticePageHeader } from "../PracticePageHeader";

const rangeOptions = [
  { href: "/portal/app/bookings?range=24h", label: "24 Hours", value: "24h" },
  { href: "/portal/app/bookings?range=7d", label: "7 Days", value: "7d" },
  { href: "/portal/app/bookings?range=30d", label: "30 Days", value: "30d" },
] as const satisfies ReadonlyArray<{
  href: string;
  label: string;
  value: PortalOverviewRange;
}>;

type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;

function parseRange(value: string | string[] | undefined): PortalOverviewRange {
  if (value === "24h" || value === "7d" || value === "30d") {
    return value;
  }
  return "24h";
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
    </tr>
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
  const result = await getPortalBookings(range, 100);

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
                href={option.href}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>
      </PracticePageHeader>

      <section className="overflow-hidden rounded-xl border border-black/6 bg-white shadow-sm">
        {result.bookings.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[#617477]">
            No bookings in this range yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
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
                </tr>
              </thead>
              <tbody>
                {result.bookings.map((booking) => (
                  <BookingRow key={booking.callId} booking={booking} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
