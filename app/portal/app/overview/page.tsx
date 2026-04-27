import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getPortalOverviewMetrics,
  type PortalBookedAppointment,
  type PortalOverviewRange,
} from "@/lib/portal-overview";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { cn } from "@/lib/utils";

const rangeOptions = [
  { href: "/portal/app/overview?range=24h", label: "24H", value: "24h" },
  { href: "/portal/app/overview?range=7d", label: "7 Day", value: "7d" },
  { href: "/portal/app/overview?range=30d", label: "30 Day", value: "30d" },
  { href: "/portal/app/overview?range=all", label: "All Time", value: "all" },
] as const satisfies ReadonlyArray<{
  href: string;
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

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMinutes(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;

  if (minutes <= 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
}

function formatRate(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(value);
}

const callTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
});

const appointmentTimeFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const zonedAppointmentTimeFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
});

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return phone || "Unknown caller";
}

function formatCallTime(date: Date) {
  return callTimeFormatter.format(date);
}

function formatAppointmentTime(value: string | null) {
  if (!value) {
    return "Appointment time missing";
  }

  const localDateTime = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/,
  );

  if (localDateTime) {
    const [, year, month, day, hour, minute] = localDateTime;
    return appointmentTimeFormatter.format(
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
    return zonedAppointmentTimeFormatter.format(parsed);
  }

  return value;
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function MetricBlock({
  label,
  note,
  value,
}: {
  label: string;
  note: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-black/6 bg-white px-5 py-5 shadow-[0_14px_40px_rgba(16,39,44,0.05)]">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6f8083]">
        {label}
      </p>
      <p className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[#10272c] md:text-5xl">
        {value}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-[#617477]">{note}</p>
    </div>
  );
}

function BookedAppointmentRow({
  appointment,
}: {
  appointment: PortalBookedAppointment;
}) {
  const providerLocation = [appointment.providerName, appointment.locationName]
    .filter(Boolean)
    .join(" at ");

  return (
    <article className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1.35fr)_minmax(160px,0.7fr)_minmax(160px,0.7fr)] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-[#10272c]">
            {formatPhone(appointment.callerPhone)}
          </p>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
            {formatStatus(appointment.appointmentStatus)}
          </span>
        </div>
        <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[#10272c]">
          {formatAppointmentTime(appointment.appointmentStart)}
        </p>
        <p className="mt-1 text-sm text-[#617477]">
          {providerLocation || "Provider and location not captured"}
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8a999b]">
          Call
        </p>
        <p className="mt-1 text-sm font-medium text-[#10272c]">
          {formatCallTime(appointment.callStartedAt)}
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8a999b]">
          Booking
        </p>
        <p className="mt-1 text-sm font-medium text-[#10272c]">
          {appointment.appointmentId ? `#${appointment.appointmentId}` : "ID pending"}
        </p>
      </div>

      {appointment.summary ? (
        <p className="border-t border-black/6 pt-3 text-sm leading-relaxed text-[#617477] md:col-span-3">
          {appointment.summary}
        </p>
      ) : null}
    </article>
  );
}

function BookedAppointmentsPanel({
  appointments,
}: {
  appointments: PortalBookedAppointment[];
}) {
  return (
    <section className="space-y-3 pt-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6f8083]">
            Booked appointments
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-[#10272c]">
            Staff review queue
          </h3>
        </div>
        <p className="text-sm text-[#617477]">
          {appointments.length > 0
            ? `${formatInteger(appointments.length)} latest`
            : "No bookings"}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-black/8 bg-white shadow-[0_14px_40px_rgba(16,39,44,0.04)]">
        {appointments.length > 0 ? (
          <div className="divide-y divide-black/6">
            {appointments.map((appointment) => (
              <BookedAppointmentRow
                key={appointment.callId}
                appointment={appointment}
              />
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-sm text-[#617477]">
            No booked appointments in this range.
          </div>
        )}
      </div>
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
  const metrics = await getPortalOverviewMetrics(range);

  if (!metrics) {
    redirect("/portal");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="flex flex-col gap-4 border-b border-black/8 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6f8083]">
            Overview
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[#10272c] md:text-4xl">
            {metrics.practiceName}
          </h2>
        </div>
        <nav
          aria-label="Overview range"
          className="inline-flex w-full rounded-lg border border-black/8 bg-white p-1 shadow-[0_10px_30px_rgba(16,39,44,0.04)] sm:w-fit"
        >
          {rangeOptions.map((option) => {
            const isActive = option.value === metrics.range;

            return (
              <Link
                key={option.value}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-center text-xs font-semibold text-[#617477] transition sm:min-w-20",
                  isActive
                    ? "bg-[#10272c] text-white shadow-sm hover:text-white"
                    : "hover:bg-[#eef5f3] hover:text-[#10272c]",
                )}
                href={option.href}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricBlock
          label="Total calls"
          note="Calls handled by the agent."
          value={formatInteger(metrics.totalCalls)}
        />
        <MetricBlock
          label="Total call minutes"
          note="Patient time covered by the system."
          value={formatMinutes(metrics.totalCallMinutes)}
        />
        <MetricBlock
          label="Avg time / call"
          note="Mean call duration."
          value={formatDuration(metrics.averageCallDurationSec)}
        />
        <MetricBlock
          label="Transfer rate"
          note={`${formatInteger(metrics.transferredCalls)} transferred calls.`}
          value={formatRate(metrics.transferRate)}
        />
      </section>

      <BookedAppointmentsPanel appointments={metrics.bookedAppointments} />
    </div>
  );
}
