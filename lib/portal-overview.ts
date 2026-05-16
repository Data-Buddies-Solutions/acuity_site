import { getAuthSession } from "@/lib/auth";
import type { Prisma } from "@/generated/prisma/client";
import type { CallSummaryData, ChatHistoryItem, TurnRecord } from "@/lib/call-types";
import { prisma } from "@/lib/prisma";
import { getPracticeBranding, type PracticeBranding } from "@/lib/practice-branding";
import { isSuccessfulBookAppointmentTool } from "@/lib/tool-action-status";

export type PortalBookedAppointment = {
  appointmentId: string | null;
  appointmentStart: string | null;
  appointmentStatus: string;
  appointmentTypeName: string | null;
  callId: string;
  callStartedAt: Date;
  callerPhone: string;
  duration: number | null;
  locationName: string | null;
  patientName: string | null;
  providerName: string | null;
  summary: string | null;
};

export type PortalOverviewRange = "24h" | "7d" | "30d" | "all";

export type PortalCallVolumePoint = {
  bucket: string;
  count: number;
  label: string;
};

export type PortalTimeSavedBucket = {
  key: "scheduling" | "after_hours" | "faq";
  label: string;
  seconds: number;
};

export type PortalOverviewOfficeFilterOption = {
  id: string;
  label: string;
  phones: string[];
};

export type PortalOverviewMetrics = {
  appointmentActions: {
    booked: number;
    cancelled: number;
    confirmed: number;
  };
  averageCallDurationSec: number;
  branding: PracticeBranding;
  callVolume: PortalCallVolumePoint[];
  officeFilters: PortalOverviewOfficeFilterOption[];
  practiceName: string;
  previousTotalCalls: number;
  range: PortalOverviewRange;
  selectedOfficeId: string | null;
  selectedOfficeLabel: string | null;
  staffTimeSaved: {
    buckets: PortalTimeSavedBucket[];
    totalSeconds: number;
  };
  totalCallMinutes: number;
  totalCalls: number;
  transferRate: number;
  transferredCalls: number;
};

export type PortalBookingsResult = {
  bookings: PortalBookedAppointment[];
  branding: PracticeBranding;
  practiceName: string;
  range: PortalOverviewRange;
};

type BoundedPortalOverviewRange = Exclude<PortalOverviewRange, "all">;

const rangeDays: Record<BoundedPortalOverviewRange, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
};

const PRACTICE_TIMEZONE = "America/New_York";
const AFTER_HOURS_START = 18;
const AFTER_HOURS_END = 8;

function buildStaffTimeSaved(
  totalSeconds: number,
  schedulingSeconds: number,
  afterHoursSeconds: number,
) {
  const faqSeconds = Math.max(0, totalSeconds - schedulingSeconds - afterHoursSeconds);

  return {
    buckets: [
      {
        key: "scheduling",
        label: "Scheduling",
        seconds: schedulingSeconds,
      },
      {
        key: "after_hours",
        label: "After-Hours",
        seconds: afterHoursSeconds,
      },
      {
        key: "faq",
        label: "FAQ",
        seconds: faqSeconds,
      },
    ] satisfies PortalTimeSavedBucket[],
    totalSeconds,
  };
}

function getRangeStart(range: PortalOverviewRange) {
  if (range === "all") {
    return null;
  }

  return new Date(Date.now() - rangeDays[range] * 24 * 60 * 60 * 1000);
}

function getPreviousRangeWindow(range: PortalOverviewRange) {
  if (range === "all") {
    return null;
  }

  const days = rangeDays[range];
  const now = Date.now();
  return {
    end: new Date(now - days * 24 * 60 * 60 * 1000),
    start: new Date(now - 2 * days * 24 * 60 * 60 * 1000),
  };
}

const dayBucketFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: PRACTICE_TIMEZONE,
  year: "numeric",
});

const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: PRACTICE_TIMEZONE,
});

const monthBucketFormatter = new Intl.DateTimeFormat("en-CA", {
  month: "2-digit",
  timeZone: PRACTICE_TIMEZONE,
  year: "numeric",
});

const monthLabelFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: PRACTICE_TIMEZONE,
  year: "numeric",
});

const hourBucketFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  month: "2-digit",
  timeZone: PRACTICE_TIMEZONE,
  year: "numeric",
});

const hourLabelFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  hour12: true,
  timeZone: PRACTICE_TIMEZONE,
});

function normalizePhoneKey(phone: string | null | undefined) {
  return phone?.replace(/\D/g, "") ?? "";
}

function phoneLookupVariants(phone: string | null | undefined) {
  const variants = new Set<string>();
  const trimmed = phone?.trim() ?? "";
  const digits = normalizePhoneKey(trimmed);

  if (trimmed) variants.add(trimmed);

  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
  }

  if (digits.length === 10) {
    variants.add(`+1${digits}`);
    variants.add(`1${digits}`);
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    variants.add(digits.slice(1));
  }

  return [...variants].filter(Boolean);
}

function buildPortalOverviewOfficeFilters(
  phoneNumbers: Array<{
    label: string | null;
    location: { name: string } | null;
    locationId: string | null;
    phoneNumber: string;
  }>,
): PortalOverviewOfficeFilterOption[] {
  const optionsById = new Map<string, PortalOverviewOfficeFilterOption>();

  for (const phone of phoneNumbers) {
    const key = normalizePhoneKey(phone.phoneNumber);

    if (!key) {
      continue;
    }

    const id = phone.locationId ? `location:${phone.locationId}` : `phone:${key}`;
    const existing = optionsById.get(id);

    if (existing) {
      if (!existing.phones.some((item) => normalizePhoneKey(item) === key)) {
        existing.phones.push(phone.phoneNumber);
      }
      continue;
    }

    optionsById.set(id, {
      id,
      label: phone.location?.name ?? phone.label ?? phone.phoneNumber,
      phones: [phone.phoneNumber],
    });
  }

  return [...optionsById.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function resolvePortalOverviewOfficeFilter(
  officeFilter: string | string[] | null | undefined,
  options: PortalOverviewOfficeFilterOption[],
) {
  const office = Array.isArray(officeFilter) ? officeFilter[0] : officeFilter;
  const key = normalizePhoneKey(office);

  if (!office) {
    return null;
  }

  return (
    options.find(
      (option) =>
        option.id === office ||
        (key && option.phones.some((phone) => normalizePhoneKey(phone) === key)),
    ) ?? null
  );
}

function buildPortalOverviewOfficeWhere(
  officeFilter: PortalOverviewOfficeFilterOption | null,
): Prisma.AgentCallWhereInput {
  const officeLocationId = officeFilter?.id.startsWith("location:")
    ? officeFilter.id.replace("location:", "")
    : null;
  const officePhoneVariants = [
    ...new Set((officeFilter?.phones ?? []).flatMap(phoneLookupVariants)),
  ];
  const clauses: Prisma.AgentCallWhereInput[] = [];

  if (officeLocationId) {
    clauses.push({ locationId: officeLocationId });
  }

  if (officePhoneVariants.length) {
    clauses.push({ officePhone: { in: officePhoneVariants } });
  }

  return clauses.length ? { OR: clauses } : {};
}

function bucketCallVolume(
  startedAtList: Date[],
  range: PortalOverviewRange,
): PortalCallVolumePoint[] {
  const now = new Date();
  const points: PortalCallVolumePoint[] = [];
  const counts = new Map<string, number>();

  if (range === "all") {
    if (!startedAtList.length) {
      return points;
    }

    let firstCallTime = startedAtList[0].getTime();
    for (let index = 1; index < startedAtList.length; index += 1) {
      const time = startedAtList[index].getTime();
      if (time < firstCallTime) {
        firstCallTime = time;
      }
    }
    const dayMs = 24 * 60 * 60 * 1000;
    const spanDays = Math.ceil((now.getTime() - firstCallTime) / dayMs);
    const useMonthBuckets = spanDays > 90;
    const bucketFormatter = useMonthBuckets ? monthBucketFormatter : dayBucketFormatter;
    const labelFormatter = useMonthBuckets ? monthLabelFormatter : dayLabelFormatter;

    for (const at of startedAtList) {
      const key = bucketFormatter.format(at);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    if (useMonthBuckets) {
      const slot = new Date(firstCallTime);
      slot.setDate(1);
      slot.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setDate(1);
      end.setHours(0, 0, 0, 0);

      while (slot.getTime() <= end.getTime()) {
        const key = bucketFormatter.format(slot);
        points.push({
          bucket: key,
          count: counts.get(key) ?? 0,
          label: labelFormatter.format(slot),
        });
        slot.setMonth(slot.getMonth() + 1);
      }
      return points;
    }

    for (let offset = spanDays; offset >= 0; offset--) {
      const slot = new Date(now.getTime() - offset * dayMs);
      const key = bucketFormatter.format(slot);
      points.push({
        bucket: key,
        count: counts.get(key) ?? 0,
        label: labelFormatter.format(slot),
      });
    }
    return points;
  }

  if (range === "24h") {
    for (const at of startedAtList) {
      const key = hourBucketFormatter.format(at);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    for (let offset = 23; offset >= 0; offset--) {
      const slot = new Date(now.getTime() - offset * 60 * 60 * 1000);
      const key = hourBucketFormatter.format(slot);
      points.push({
        bucket: key,
        count: counts.get(key) ?? 0,
        label: hourLabelFormatter.format(slot),
      });
    }
    return points;
  }

  for (const at of startedAtList) {
    const key = dayBucketFormatter.format(at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const days = rangeDays[range];
  for (let offset = days - 1; offset >= 0; offset--) {
    const slot = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    const key = dayBucketFormatter.format(slot);
    points.push({
      bucket: key,
      count: counts.get(key) ?? 0,
      label: dayLabelFormatter.format(slot),
    });
  }
  return points;
}

function getLocalHour(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    timeZone: PRACTICE_TIMEZONE,
  });
  return Number(formatter.format(date));
}

function isAfterHours(date: Date) {
  const hour = getLocalHour(date);
  return hour >= AFTER_HOURS_START || hour < AFTER_HOURS_END;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseToolPayload(value: unknown) {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getTurns(data: unknown) {
  if (!isRecord(data) || !Array.isArray(data.turns)) {
    return [];
  }

  return data.turns.filter(isRecord);
}

type AvailabilityMatch = {
  columnId: string | null;
  locationName: string | null;
  profileId: string | null;
  providerName: string | null;
};

function getAvailabilityMatches(result: Record<string, unknown>) {
  const providers = Array.isArray(result.providers) ? result.providers : [];
  const locationName = asString(result.location);
  const matches: AvailabilityMatch[] = [];

  for (const provider of providers) {
    if (!isRecord(provider)) {
      continue;
    }

    matches.push({
      columnId: asString(provider.columnId),
      locationName: asString(provider.facility) ?? locationName,
      profileId: asString(provider.profileId),
      providerName: asString(provider.name),
    });
  }

  return matches;
}

function sameIdentifier(left: string | null, right: string | null) {
  return Boolean(left && right && left === right);
}

function findAvailabilityMatch(
  args: Record<string, unknown> | null,
  matches: AvailabilityMatch[],
) {
  if (!args) {
    return null;
  }

  const columnId = asString(args.columnId);
  const profileId = asString(args.profileId);

  return (
    matches.find(
      (match) =>
        sameIdentifier(match.columnId, columnId) &&
        sameIdentifier(match.profileId, profileId),
    ) ??
    matches.find((match) => sameIdentifier(match.columnId, columnId)) ??
    matches.find((match) => sameIdentifier(match.profileId, profileId)) ??
    null
  );
}

function fallbackAgentSummary(turns: Record<string, unknown>[]) {
  for (let index = turns.length - 1; index >= 0; index--) {
    const text = asString(turns[index]?.agentText);
    if (text) {
      return text;
    }
  }

  return null;
}

export function extractBookedAppointment(call: {
  callerPhone: string;
  data: unknown;
  id: string;
  outcomeSummary: string | null;
  startedAt: Date;
}): PortalBookedAppointment {
  const turns = getTurns(call.data);
  const availabilityMatches: AvailabilityMatch[] = [];
  let booking: {
    args: Record<string, unknown> | null;
    result: Record<string, unknown> | null;
    turnAgentText: string | null;
  } | null = null;

  for (const turn of turns) {
    const toolCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];

    for (const rawTool of toolCalls) {
      if (!isRecord(rawTool)) {
        continue;
      }

      const name = asString(rawTool.name);
      const result = parseToolPayload(rawTool.result);

      if (name === "get_availability" && result) {
        availabilityMatches.push(...getAvailabilityMatches(result));
      }

      if (
        name === "book_appt" &&
        isSuccessfulBookAppointmentTool({
          isError: rawTool.isError === true,
          name,
          result: rawTool.result,
        })
      ) {
        booking = {
          args: parseToolPayload(rawTool.args),
          result,
          turnAgentText: asString(turn.agentText),
        };
      }
    }
  }

  const matchedAvailability = findAvailabilityMatch(
    booking?.args ?? null,
    availabilityMatches,
  );
  const appointmentId =
    asString(booking?.result?.appointmentId) ?? asString(booking?.result?.id);

  return {
    appointmentId,
    appointmentStart:
      asString(booking?.result?.startDatetime) ??
      asString(booking?.args?.startDatetime) ??
      asString(booking?.args?.startDateTime) ??
      asString(booking?.args?.datetime),
    appointmentStatus:
      asString(booking?.result?.status) ?? (appointmentId ? "booked" : "unknown"),
    appointmentTypeName: asString(booking?.result?.appointmentTypeName),
    callId: call.id,
    callStartedAt: call.startedAt,
    callerPhone: call.callerPhone,
    duration: asNumber(booking?.result?.duration) ?? asNumber(booking?.args?.duration),
    locationName:
      asString(booking?.result?.locationName) ??
      matchedAvailability?.locationName ??
      null,
    patientName:
      normalizeDisplayName(asString(booking?.result?.patientName)) ??
      extractPatientName(booking?.args ?? null),
    providerName:
      asString(booking?.result?.providerName) ??
      matchedAvailability?.providerName ??
      null,
    summary:
      call.outcomeSummary ??
      booking?.turnAgentText ??
      fallbackAgentSummary(turns) ??
      "Appointment booked by the AI receptionist.",
  };
}

function isRenderableBooking(booking: PortalBookedAppointment) {
  return booking.appointmentStatus !== "error" && Boolean(booking.appointmentId);
}

function extractPatientName(args: Record<string, unknown> | null) {
  if (!args) return null;
  const direct =
    asString(args.patientName) ??
    asString(args.fullName) ??
    asString(args.name) ??
    asString(args.callerName);
  if (direct) return normalizeDisplayName(direct);

  const first = asString(args.firstName) ?? asString(args.first_name);
  const last = asString(args.lastName) ?? asString(args.last_name);
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return normalizeDisplayName(combined);
}

function normalizeDisplayName(value: string | null) {
  if (!value) return null;
  let name = value.trim();
  if (!name) return null;

  const commaParts = name.split(",");
  if (commaParts.length === 2) {
    name = [commaParts[1], commaParts[0]]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ");
  }

  if (name === name.toUpperCase() || name === name.toLowerCase()) {
    return name
      .toLowerCase()
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  return name;
}

export async function getPortalOverviewMetrics(
  range: PortalOverviewRange = "24h",
  office?: string | string[] | null,
): Promise<PortalOverviewMetrics | null> {
  const session = await getAuthSession();

  if (!session) {
    return null;
  }

  const membership = await prisma.practiceMembership.findFirst({
    include: {
      practice: {
        select: {
          brandAccentColor: true,
          brandLogoAlt: true,
          brandLogoUrl: true,
          brandMarkUrl: true,
          brandPrimaryColor: true,
          id: true,
          name: true,
          phoneNumbers: {
            include: {
              location: {
                select: {
                  name: true,
                },
              },
            },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          },
        },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    where: {
      userId: session.user.id,
    },
  });

  if (!membership) {
    return null;
  }

  const officeFilters = buildPortalOverviewOfficeFilters(
    membership.practice.phoneNumbers,
  );
  const selectedOffice = resolvePortalOverviewOfficeFilter(office, officeFilters);
  const rangeStart = getRangeStart(range);
  const previousWindow = getPreviousRangeWindow(range);
  const officeWhere = buildPortalOverviewOfficeWhere(selectedOffice);
  const callWhere = {
    practiceId: membership.practiceId,
    ...(rangeStart ? { startedAt: { gte: rangeStart } } : {}),
    ...officeWhere,
  };

  const [callRows, previousTotalCalls] = await Promise.all([
    prisma.agentCall.findMany({
      orderBy: {
        startedAt: "desc",
      },
      select: {
        bookedAppointment: true,
        cancelledAppointment: true,
        confirmedAppointment: true,
        durationSec: true,
        startedAt: true,
        transferred: true,
      },
      where: callWhere,
    }),
    previousWindow
      ? prisma.agentCall.count({
          where: {
            practiceId: membership.practiceId,
            startedAt: { gte: previousWindow.start, lt: previousWindow.end },
            ...officeWhere,
          },
        })
      : Promise.resolve(0),
  ]);

  const callCount = callRows.length;
  let transferredCalls = 0;
  let totalDurationSec = 0;
  let bookedActionCount = 0;
  let confirmedActionCount = 0;
  let cancelledActionCount = 0;
  let schedulingSeconds = 0;
  let afterHoursSeconds = 0;
  let staffTimeSavedSeconds = 0;

  if (range === "all") {
    const [
      aggregate,
      transferred,
      booked,
      confirmed,
      cancelled,
      scheduling
    ] = await Promise.all([
      prisma.agentCall.aggregate({
        _count: { _all: true },
        _sum: { durationSec: true },
        where: callWhere,
      }),
      prisma.agentCall.count({ where: { ...callWhere, transferred: true } }),
      prisma.agentCall.count({ where: { ...callWhere, bookedAppointment: true } }),
      prisma.agentCall.count({ where: { ...callWhere, confirmedAppointment: true } }),
      prisma.agentCall.count({ where: { ...callWhere, cancelledAppointment: true } }),
      prisma.agentCall.aggregate({
        _sum: { durationSec: true },
        where: {
          ...callWhere,
          OR: [
            { bookedAppointment: true },
            { confirmedAppointment: true },
            { cancelledAppointment: true },
          ],
        },
      })
    ]);

    totalDurationSec = aggregate._sum.durationSec ?? 0;
    transferredCalls = transferred;
    bookedActionCount = booked;
    confirmedActionCount = confirmed;
    cancelledActionCount = cancelled;
    schedulingSeconds = scheduling._sum.durationSec ?? 0;
    for (const call of callRows) {
      if (!call.bookedAppointment && !call.confirmedAppointment && !call.cancelledAppointment && isAfterHours(call.startedAt)) {
        afterHoursSeconds += call.durationSec;
      }
    }
    staffTimeSavedSeconds = totalDurationSec;
  } else {
    for (const call of callRows) {
      totalDurationSec += call.durationSec;
      if (call.transferred) transferredCalls += 1;
      if (call.bookedAppointment) bookedActionCount += 1;
      if (call.confirmedAppointment) confirmedActionCount += 1;
      if (call.cancelledAppointment) cancelledActionCount += 1;
      const isSchedulingCall =
        call.bookedAppointment || call.confirmedAppointment || call.cancelledAppointment;
      const isAfterHoursCall = isAfterHours(call.startedAt);

      if (isSchedulingCall) {
        schedulingSeconds += call.durationSec;
      } else if (isAfterHoursCall) {
        afterHoursSeconds += call.durationSec;
      }
      staffTimeSavedSeconds += call.durationSec;
    }
  }

  const callVolume = bucketCallVolume(
    callRows.map((call) => call.startedAt),
    range,
  );

  return {
    appointmentActions: {
      booked: bookedActionCount,
      cancelled: cancelledActionCount,
      confirmed: confirmedActionCount,
    },
    averageCallDurationSec: callCount > 0 ? totalDurationSec / callCount : 0,
    branding: getPracticeBranding(membership.practice),
    callVolume,
    officeFilters,
    practiceName: membership.practice.name,
    previousTotalCalls,
    range,
    selectedOfficeId: selectedOffice?.id ?? null,
    selectedOfficeLabel: selectedOffice?.label ?? null,
    staffTimeSaved: buildStaffTimeSaved(
      staffTimeSavedSeconds,
      schedulingSeconds,
      afterHoursSeconds,
    ),
    totalCallMinutes: totalDurationSec / 60,
    totalCalls: callCount,
    transferRate: callCount > 0 ? transferredCalls / callCount : 0,
    transferredCalls,
  };
}

export async function getPortalBookings(
  range: PortalOverviewRange = "7d",
  limit = 50,
): Promise<PortalBookingsResult | null> {
  const session = await getAuthSession();

  if (!session) {
    return null;
  }

  const membership = await prisma.practiceMembership.findFirst({
    include: {
      practice: {
        select: {
          brandAccentColor: true,
          brandLogoAlt: true,
          brandLogoUrl: true,
          brandMarkUrl: true,
          brandPrimaryColor: true,
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    where: {
      userId: session.user.id,
    },
  });

  if (!membership) {
    return null;
  }

  const rangeStart = getRangeStart(range);
  const bookedCalls = await prisma.agentCall.findMany({
    orderBy: {
      startedAt: "desc",
    },
    select: {
      callerPhone: true,
      data: true,
      id: true,
      outcomeSummary: true,
      startedAt: true,
    },
    take: limit,
    where: {
      bookedAppointment: true,
      practiceId: membership.practiceId,
      ...(rangeStart ? { startedAt: { gte: rangeStart } } : {}),
    },
  });

  return {
    bookings: bookedCalls.map(extractBookedAppointment).filter(isRenderableBooking),
    branding: getPracticeBranding(membership.practice),
    practiceName: membership.practice.name,
    range,
  };
}

export type PortalCallTranscript = {
  branding: PracticeBranding;
  callerPhone: string;
  callId: string;
  messages: PortalCallTranscriptMessage[];
  practiceName: string;
  startedAt: Date;
};

export type PortalCallTranscriptMessage = {
  role: "agent" | "caller";
  text: string;
  timestamp: number | null;
};

function extractChatText(content?: ChatHistoryItem["content"]) {
  if (!content) {
    return "";
  }

  return content
    .map((part) => (typeof part === "string" ? part : (part.transcript ?? "")))
    .filter(Boolean)
    .join(" ")
    .trim();
}

function transcriptMessagesFromSessionItems(
  items: ChatHistoryItem[],
): PortalCallTranscriptMessage[] {
  const messages: PortalCallTranscriptMessage[] = [];

  for (const item of items) {
    if (item.type !== "message") {
      continue;
    }

    const role =
      item.role === "user" ? "caller" : item.role === "assistant" ? "agent" : null;
    const text = extractChatText(item.content);

    if (!role || !text) {
      continue;
    }

    messages.push({
      role,
      text,
      timestamp: typeof item.createdAt === "number" ? item.createdAt : null,
    });
  }

  return messages;
}

function transcriptMessagesFromTurns(turns: TurnRecord[]): PortalCallTranscriptMessage[] {
  const messages: PortalCallTranscriptMessage[] = [];

  for (const turn of turns) {
    if (turn.callerText) {
      messages.push({
        role: "caller",
        text: turn.callerText,
        timestamp: null,
      });
    }

    if (turn.agentText) {
      messages.push({
        role: "agent",
        text: turn.agentText,
        timestamp: null,
      });
    }
  }

  return messages;
}

export function buildPortalCallTranscriptMessages({
  sessionItems,
  turns,
}: {
  sessionItems: ChatHistoryItem[];
  turns: TurnRecord[];
}) {
  const sessionMessages = transcriptMessagesFromSessionItems(sessionItems);
  return sessionMessages.length ? sessionMessages : transcriptMessagesFromTurns(turns);
}

export async function getPortalCallTranscript(
  callId: string,
): Promise<PortalCallTranscript | null> {
  const session = await getAuthSession();

  if (!session) {
    return null;
  }

  const membership = await prisma.practiceMembership.findFirst({
    include: {
      practice: {
        select: {
          brandAccentColor: true,
          brandLogoAlt: true,
          brandLogoUrl: true,
          brandMarkUrl: true,
          brandPrimaryColor: true,
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    where: {
      userId: session.user.id,
    },
  });

  if (!membership) {
    return null;
  }

  const call = await prisma.agentCall.findFirst({
    select: {
      callerPhone: true,
      data: true,
      id: true,
      startedAt: true,
    },
    where: {
      id: callId,
      practiceId: membership.practiceId,
    },
  });

  if (!call) {
    return null;
  }

  const data = (isRecord(call.data) ? (call.data as CallSummaryData) : null) ?? null;
  const turns = Array.isArray(data?.turns) ? (data?.turns as TurnRecord[]) : [];
  const sessionItems = Array.isArray(data?.sessionReport?.chat_history?.items)
    ? (data?.sessionReport?.chat_history?.items as ChatHistoryItem[])
    : [];

  return {
    branding: getPracticeBranding(membership.practice),
    callerPhone: call.callerPhone,
    callId: call.id,
    messages: buildPortalCallTranscriptMessages({ sessionItems, turns }),
    practiceName: membership.practice.name,
    startedAt: call.startedAt,
  };
}
