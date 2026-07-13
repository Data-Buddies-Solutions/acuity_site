"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatEasternAppointmentDateTime } from "@/lib/format";
import type { PortalBookedAppointment } from "@/lib/portal-overview";
import { cn } from "@/lib/utils";

import { loadBookingCallDetails, type BookingCallDetails } from "./actions";
import { BookingCallConversation } from "./BookingCallConversation";

type SortKey = "appointment" | "booked" | "patient" | "provider";
type SortState = { direction: "asc" | "desc"; key: SortKey };

const DESKTOP_PAGE_SIZE = 15;
const MOBILE_PAGE_SIZE = 7;
const callDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "America/New_York",
  year: "numeric",
});
const callDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "America/New_York",
  year: "numeric",
});

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

function visitLabel(booking: PortalBookedAppointment) {
  if (booking.appointmentTypeName?.trim()) return booking.appointmentTypeName.trim();
  if (booking.careLane === "medical") return "Medical";
  if (booking.careLane === "routine_vision") return "Routine vision";
  return "Unclassified";
}

function sortValue(booking: PortalBookedAppointment, key: SortKey) {
  if (key === "appointment") {
    const timestamp = new Date(booking.appointmentStart ?? "").getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }
  if (key === "booked") return new Date(booking.callStartedAt).getTime();
  if (key === "provider") return booking.providerName?.toLocaleLowerCase() ?? null;
  return (booking.patientName ?? booking.callerPhone).toLocaleLowerCase();
}

function compareBookings(
  left: PortalBookedAppointment,
  right: PortalBookedAppointment,
  sort: SortState,
) {
  const leftValue = sortValue(left, sort.key);
  const rightValue = sortValue(right, sort.key);

  if (leftValue === null) return rightValue === null ? 0 : 1;
  if (rightValue === null) return -1;

  const result =
    typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue));
  return sort.direction === "asc" ? result : -result;
}

function formatDuration(seconds: number | null) {
  if (!seconds || seconds < 1) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

function SortButton({
  children,
  onSort,
  sortKey,
  sortState,
}: {
  children: string;
  onSort: (key: SortKey) => void;
  sortKey: SortKey;
  sortState: SortState;
}) {
  const active = sortState.key === sortKey;
  const Icon = !active
    ? ArrowUpDown
    : sortState.direction === "asc"
      ? ArrowUp
      : ArrowDown;
  const nextDirection =
    active && sortState.direction === "asc" ? "descending" : "ascending";

  return (
    <button
      aria-label={`Sort by ${children} ${nextDirection}`}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-md text-xs font-semibold transition hover:text-[var(--portal-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--portal-accent)]/25",
        active ? "text-[var(--portal-ink)]" : "text-[var(--portal-muted)]",
      )}
      onClick={() => onSort(sortKey)}
      type="button"
    >
      {children}
      <Icon className={cn("size-3", active ? "opacity-100" : "opacity-45")} />
    </button>
  );
}

function BookingCard({
  booking,
  showLocation,
}: {
  booking: PortalBookedAppointment;
  showLocation: boolean;
}) {
  return (
    <article className="space-y-4 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--portal-ink)]">
            {booking.patientName ?? "Unknown patient"}
          </p>
          <p className="mt-0.5 whitespace-nowrap font-mono text-xs tabular-nums text-[var(--portal-muted)]">
            {formatPhone(booking.callerPhone)}
          </p>
        </div>
        <BookingDetailsSheet booking={booking} showLocation={showLocation} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--portal-border)] pt-3 text-sm">
        <div className="col-span-2">
          <dt className="text-xs text-[var(--portal-muted)]">Appointment</dt>
          <dd className="mt-0.5 font-medium text-[var(--portal-ink)]">
            {formatEasternAppointmentDateTime(booking.appointmentStart, "—")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--portal-muted)]">Visit</dt>
          <dd className="mt-0.5 truncate font-medium text-[var(--portal-ink)]">
            {visitLabel(booking)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--portal-muted)]">Doctor</dt>
          <dd className="mt-0.5 truncate font-medium text-[var(--portal-ink)]">
            {booking.providerName ?? "—"}
          </dd>
        </div>
        {showLocation ? (
          <div>
            <dt className="text-xs text-[var(--portal-muted)]">Office</dt>
            <dd className="mt-0.5 truncate font-medium text-[var(--portal-ink)]">
              {booking.locationName ?? "—"}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-[var(--portal-muted)]">Booked</dt>
          <dd className="mt-0.5 font-medium text-[var(--portal-ink)]">
            {callDateFormatter.format(new Date(booking.callStartedAt))}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function BookingDetailsSheet({
  booking,
  showLocation,
  triggerVariant = "outline",
}: {
  booking: PortalBookedAppointment;
  showLocation: boolean;
  triggerVariant?: "ghost" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [callDetails, setCallDetails] = useState<BookingCallDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const details = [
    {
      label: "Appointment",
      value: formatEasternAppointmentDateTime(booking.appointmentStart, "—"),
    },
    { label: "Visit", value: visitLabel(booking) },
    { label: "Doctor", value: booking.providerName ?? "—" },
    ...(showLocation ? [{ label: "Office", value: booking.locationName ?? "—" }] : []),
    {
      label: "Booked",
      value: callDateTimeFormatter.format(new Date(booking.callStartedAt)),
    },
    {
      label: "Call length",
      value:
        isLoading || (!callDetails && !loadError) ? (
          <Skeleton className="h-5 w-16" />
        ) : callDetails ? (
          formatDuration(callDetails.durationSec)
        ) : (
          "Unavailable"
        ),
    },
  ];

  async function loadDetails() {
    if (isLoading) return;

    setIsLoading(true);
    setLoadError(null);

    try {
      const result = await loadBookingCallDetails(booking.callId);
      if (!result) {
        setLoadError("Call details are unavailable.");
        return;
      }
      setCallDetails(result);
    } catch {
      setLoadError("We couldn’t load this conversation.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen && !callDetails && !isLoading) void loadDetails();
  }

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetTrigger asChild>
        <Button size="compact" variant={triggerVariant}>
          Details
        </Button>
      </SheetTrigger>
      <SheetContent className="portal-platform sm:w-[min(92vw,34rem)]">
        <SheetHeader className="pr-12">
          <SheetTitle>{booking.patientName ?? "Unknown patient"}</SheetTitle>
          <SheetDescription className="font-mono tabular-nums">
            {formatPhone(booking.callerPhone)}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5">
          <dl className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-5 border-y border-[var(--portal-border)] py-5">
            {details.map((detail) => (
              <div
                className={cn(detail.label === "Appointment" && "col-span-2")}
                key={detail.label}
              >
                <dt className="text-xs text-[var(--portal-muted)]">{detail.label}</dt>
                <dd className="mt-1 text-sm font-medium text-[var(--portal-ink)]">
                  {detail.value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex min-h-0 flex-1 flex-col pt-5">
            <h3 className="mb-2.5 shrink-0 text-sm font-semibold text-[var(--portal-ink)]">
              Conversation
            </h3>
            <BookingCallConversation
              details={callDetails}
              error={loadError}
              isLoading={isLoading}
              onRetry={() => void loadDetails()}
            />
          </div>
        </div>
        <SheetFooter>
          <Button asChild className="w-full" variant="primary">
            <Link href={`/portal/app/calls/${booking.callId}`}>Open transcript</Link>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function TablePagination({
  className,
  itemCount,
  onPageChange,
  page,
  pageSize,
}: {
  className?: string;
  itemCount: number;
  onPageChange: (page: number) => void;
  page: number;
  pageSize: number;
}) {
  const pageCount = Math.max(1, Math.ceil(itemCount / pageSize));
  const safePage = Math.min(page, pageCount);
  const firstRow = itemCount ? (safePage - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(safePage * pageSize, itemCount);

  return (
    <footer
      className={cn(
        "items-center justify-between gap-3 border-t border-[var(--portal-border)] px-4 py-3 sm:px-5",
        className,
      )}
    >
      <p className="text-xs text-[var(--portal-muted)]">
        Showing {firstRow}–{lastRow} of {itemCount}
      </p>
      <div className="flex items-center gap-1">
        <Button
          aria-label="Previous page"
          disabled={safePage === 1}
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          size="compact"
          variant="ghost"
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-16 text-center text-xs font-medium text-[var(--portal-muted)]">
          {safePage} of {pageCount}
        </span>
        <Button
          aria-label="Next page"
          disabled={safePage === pageCount}
          onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
          size="compact"
          variant="ghost"
        >
          <ChevronRight />
        </Button>
      </div>
    </footer>
  );
}

export function BookingsTable({
  bookings,
  showLocation,
}: {
  bookings: PortalBookedAppointment[];
  showLocation: boolean;
}) {
  const [sortState, setSortState] = useState<SortState>({
    direction: "desc",
    key: "booked",
  });
  const [desktopPage, setDesktopPage] = useState(1);
  const [mobilePage, setMobilePage] = useState(1);
  const sortedBookings = useMemo(
    () => [...bookings].sort((left, right) => compareBookings(left, right, sortState)),
    [bookings, sortState],
  );
  const desktopPageCount = Math.max(
    1,
    Math.ceil(sortedBookings.length / DESKTOP_PAGE_SIZE),
  );
  const safeDesktopPage = Math.min(desktopPage, desktopPageCount);
  const desktopRows = sortedBookings.slice(
    (safeDesktopPage - 1) * DESKTOP_PAGE_SIZE,
    safeDesktopPage * DESKTOP_PAGE_SIZE,
  );
  const mobilePageCount = Math.max(
    1,
    Math.ceil(sortedBookings.length / MOBILE_PAGE_SIZE),
  );
  const safeMobilePage = Math.min(mobilePage, mobilePageCount);
  const mobileRows = sortedBookings.slice(
    (safeMobilePage - 1) * MOBILE_PAGE_SIZE,
    safeMobilePage * MOBILE_PAGE_SIZE,
  );

  function handleSort(key: SortKey) {
    setSortState((current) => ({
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
      key,
    }));
    setDesktopPage(1);
    setMobilePage(1);
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--portal-border)] bg-white shadow-sm">
      <div className="divide-y divide-[var(--portal-border)] md:hidden">
        {mobileRows.map((booking) => (
          <BookingCard
            booking={booking}
            key={booking.callId}
            showLocation={showLocation}
          />
        ))}
      </div>

      <div className="hidden md:block">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-[var(--portal-panel-soft)]">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-11 px-5">
                <SortButton onSort={handleSort} sortKey="patient" sortState={sortState}>
                  Patient
                </SortButton>
              </TableHead>
              <TableHead className="h-11 px-4">
                <SortButton
                  onSort={handleSort}
                  sortKey="appointment"
                  sortState={sortState}
                >
                  Appointment
                </SortButton>
              </TableHead>
              <TableHead className="h-11 px-4 text-xs font-semibold text-[var(--portal-muted)]">
                Visit
              </TableHead>
              <TableHead className="h-11 px-4">
                <SortButton onSort={handleSort} sortKey="provider" sortState={sortState}>
                  Doctor
                </SortButton>
              </TableHead>
              {showLocation ? (
                <TableHead className="h-11 px-4 text-xs font-semibold text-[var(--portal-muted)]">
                  Office
                </TableHead>
              ) : null}
              <TableHead className="h-11 px-4">
                <SortButton onSort={handleSort} sortKey="booked" sortState={sortState}>
                  Booked
                </SortButton>
              </TableHead>
              <TableHead className="h-11 w-24 px-5">
                <span className="sr-only">Transcript</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {desktopRows.map((booking) => (
              <TableRow key={booking.callId}>
                <TableCell className="px-5 py-3.5">
                  <p className="max-w-48 truncate font-medium text-[var(--portal-ink)]">
                    {booking.patientName ?? "Unknown patient"}
                  </p>
                  <p className="mt-0.5 whitespace-nowrap font-mono text-xs tabular-nums text-[var(--portal-muted)]">
                    {formatPhone(booking.callerPhone)}
                  </p>
                </TableCell>
                <TableCell className="px-4 py-3.5 font-medium text-[var(--portal-ink)]">
                  {formatEasternAppointmentDateTime(booking.appointmentStart, "—")}
                </TableCell>
                <TableCell className="max-w-52 px-4 py-3.5">
                  <span
                    className="block truncate text-[var(--portal-ink)]"
                    title={visitLabel(booking)}
                  >
                    {visitLabel(booking)}
                  </span>
                </TableCell>
                <TableCell className="max-w-44 px-4 py-3.5">
                  <span className="block truncate text-[var(--portal-ink)]">
                    {booking.providerName ?? "—"}
                  </span>
                </TableCell>
                {showLocation ? (
                  <TableCell className="max-w-40 px-4 py-3.5">
                    <span className="block truncate text-[var(--portal-muted)]">
                      {booking.locationName ?? "—"}
                    </span>
                  </TableCell>
                ) : null}
                <TableCell className="px-4 py-3.5 text-[var(--portal-muted)]">
                  {callDateFormatter.format(new Date(booking.callStartedAt))}
                </TableCell>
                <TableCell className="px-5 py-3.5 text-right">
                  <BookingDetailsSheet
                    booking={booking}
                    showLocation={showLocation}
                    triggerVariant="ghost"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        className="flex md:hidden"
        itemCount={sortedBookings.length}
        onPageChange={setMobilePage}
        page={safeMobilePage}
        pageSize={MOBILE_PAGE_SIZE}
      />
      <TablePagination
        className="hidden md:flex"
        itemCount={sortedBookings.length}
        onPageChange={setDesktopPage}
        page={safeDesktopPage}
        pageSize={DESKTOP_PAGE_SIZE}
      />
    </section>
  );
}
