import { getAuthSession } from "@/lib/auth";
import type {
  CallSummaryData,
  ChatHistoryItem,
  TurnRecord,
} from "@/lib/call-types";
import { prisma } from "@/lib/prisma";
import { getPracticeBranding, type PracticeBranding } from "@/lib/practice-branding";

export type PortalBookedAppointment = {
  appointmentId: string | null;
  appointmentStart: string | null;
  appointmentStatus: string;
  callId: string;
  callStartedAt: Date;
  callerPhone: string;
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
  key: "scheduling" | "after_hours";
  label: string;
  seconds: number;
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
  practiceName: string;
  previousTotalCalls: number;
  range: PortalOverviewRange;
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

type OverviewAggregate = {
  bookedActionCount: number;
  cancelledActionCount: number;
  confirmedActionCount: number;
  afterHoursSeconds: number;
  callCount: number;
  schedulingSeconds: number;
  staffTimeSavedSeconds: number;
  totalDurationSec: number;
  transferredCalls: number;
};

type RawOverviewAggregate = Record<keyof OverviewAggregate, bigint | number | null>;

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

function numberValue(value: bigint | number | null | undefined) {
  return Number(value ?? 0);
}

async function getAllTimeOverviewAggregate(
  practiceId: string,
): Promise<OverviewAggregate> {
  const rows = await prisma.$queryRaw<RawOverviewAggregate[]>`
    SELECT
      COUNT(*)::int AS "callCount",
      COALESCE(SUM("durationSec"), 0)::int AS "totalDurationSec",
      COUNT(*) FILTER (WHERE "transferred")::int AS "transferredCalls",
      COUNT(*) FILTER (WHERE "bookedAppointment")::int AS "bookedActionCount",
      COUNT(*) FILTER (WHERE "confirmedAppointment")::int AS "confirmedActionCount",
      COUNT(*) FILTER (WHERE "cancelledAppointment")::int AS "cancelledActionCount",
      COALESCE(
        SUM(
          CASE
            WHEN "bookedAppointment" OR "confirmedAppointment" OR "cancelledAppointment"
            THEN "durationSec"
            ELSE 0
          END
        ),
        0
      )::int AS "schedulingSeconds",
      COALESCE(
        SUM(
          CASE
            WHEN
              EXTRACT(HOUR FROM timezone(${PRACTICE_TIMEZONE}, timezone('UTC', "startedAt"))) >= ${AFTER_HOURS_START}
              OR EXTRACT(HOUR FROM timezone(${PRACTICE_TIMEZONE}, timezone('UTC', "startedAt"))) < ${AFTER_HOURS_END}
            THEN "durationSec"
            ELSE 0
          END
        ),
        0
      )::int AS "afterHoursSeconds",
      COALESCE(
        SUM(
          CASE
            WHEN
              "bookedAppointment"
              OR "confirmedAppointment"
              OR "cancelledAppointment"
              OR EXTRACT(HOUR FROM timezone(${PRACTICE_TIMEZONE}, timezone('UTC', "startedAt"))) >= ${AFTER_HOURS_START}
              OR EXTRACT(HOUR FROM timezone(${PRACTICE_TIMEZONE}, timezone('UTC', "startedAt"))) < ${AFTER_HOURS_END}
            THEN "durationSec"
            ELSE 0
          END
        ),
        0
      )::int AS "staffTimeSavedSeconds"
    FROM "agent_call"
    WHERE "practiceId" = ${practiceId}
  `;
  const row = rows[0];

  return {
    bookedActionCount: numberValue(row?.bookedActionCount),
    cancelledActionCount: numberValue(row?.cancelledActionCount),
    confirmedActionCount: numberValue(row?.confirmedActionCount),
    afterHoursSeconds: numberValue(row?.afterHoursSeconds),
    callCount: numberValue(row?.callCount),
    schedulingSeconds: numberValue(row?.schedulingSeconds),
    staffTimeSavedSeconds: numberValue(row?.staffTimeSavedSeconds),
    totalDurationSec: numberValue(row?.totalDurationSec),
    transferredCalls: numberValue(row?.transferredCalls),
  };
}

async function getAllTimeCallVolume(practiceId: string) {
  const firstRows = await prisma.$queryRaw<Array<{ firstStartedAt: Date | null }>>`
    SELECT MIN("startedAt") AS "firstStartedAt"
    FROM "agent_call"
    WHERE "practiceId" = ${practiceId}
  `;
  const firstStartedAt = firstRows[0]?.firstStartedAt;

  if (!firstStartedAt) {
    return [];
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const firstCallTime = new Date(firstStartedAt).getTime();
  const spanDays = Math.ceil((Date.now() - firstCallTime) / dayMs);

  if (spanDays > 90) {
    return prisma.$queryRaw<PortalCallVolumePoint[]>`
      SELECT
        to_char(date_trunc('month', timezone(${PRACTICE_TIMEZONE}, timezone('UTC', "startedAt"))), 'YYYY-MM') AS "bucket",
        to_char(date_trunc('month', timezone(${PRACTICE_TIMEZONE}, timezone('UTC', "startedAt"))), 'Mon YYYY') AS "label",
        COUNT(*)::int AS "count"
      FROM "agent_call"
      WHERE "practiceId" = ${practiceId}
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `;
  }

  return prisma.$queryRaw<PortalCallVolumePoint[]>`
    SELECT
      to_char(timezone(${PRACTICE_TIMEZONE}, timezone('UTC', "startedAt")), 'YYYY-MM-DD') AS "bucket",
      to_char(timezone(${PRACTICE_TIMEZONE}, timezone('UTC', "startedAt")), 'Mon FMDD') AS "label",
      COUNT(*)::int AS "count"
    FROM "agent_call"
    WHERE "practiceId" = ${practiceId}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `;
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

    const firstCallTime = Math.min(...startedAtList.map((date) => date.getTime()));
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

function extractBookedAppointment(call: {
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

      if (name === "book_appt" && rawTool.isError !== true) {
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

  return {
    appointmentId: asString(booking?.result?.appointmentId),
    appointmentStart:
      asString(booking?.args?.startDatetime) ??
      asString(booking?.args?.startDateTime) ??
      asString(booking?.args?.datetime),
    appointmentStatus: asString(booking?.result?.status) ?? "booked",
    callId: call.id,
    callStartedAt: call.startedAt,
    callerPhone: call.callerPhone,
    locationName: matchedAvailability?.locationName ?? null,
    patientName: extractPatientName(booking?.args ?? null),
    providerName: matchedAvailability?.providerName ?? null,
    summary:
      call.outcomeSummary ??
      booking?.turnAgentText ??
      fallbackAgentSummary(turns) ??
      "Appointment booked by the AI receptionist.",
  };
}

function extractPatientName(args: Record<string, unknown> | null) {
  if (!args) return null;
  const direct =
    asString(args.patientName) ??
    asString(args.fullName) ??
    asString(args.name) ??
    asString(args.callerName);
  if (direct) return direct;

  const first = asString(args.firstName) ?? asString(args.first_name);
  const last = asString(args.lastName) ?? asString(args.last_name);
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

export async function getPortalOverviewMetrics(
  range: PortalOverviewRange = "24h",
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

  if (range === "all") {
    const [aggregate, callVolume] = await Promise.all([
      getAllTimeOverviewAggregate(membership.practiceId),
      getAllTimeCallVolume(membership.practiceId),
    ]);

    return {
      appointmentActions: {
        booked: aggregate.bookedActionCount,
        cancelled: aggregate.cancelledActionCount,
        confirmed: aggregate.confirmedActionCount,
      },
      averageCallDurationSec:
        aggregate.callCount > 0 ? aggregate.totalDurationSec / aggregate.callCount : 0,
      branding: getPracticeBranding(membership.practice),
      callVolume,
      practiceName: membership.practice.name,
      previousTotalCalls: 0,
      range,
      staffTimeSaved: {
        buckets: [
          {
            key: "scheduling",
            label: "Scheduling",
            seconds: aggregate.schedulingSeconds,
          },
          {
            key: "after_hours",
            label: "After-Hours",
            seconds: aggregate.afterHoursSeconds,
          },
        ],
        totalSeconds: aggregate.staffTimeSavedSeconds,
      },
      totalCallMinutes: aggregate.totalDurationSec / 60,
      totalCalls: aggregate.callCount,
      transferRate:
        aggregate.callCount > 0 ? aggregate.transferredCalls / aggregate.callCount : 0,
      transferredCalls: aggregate.transferredCalls,
    };
  }

  const rangeStart = getRangeStart(range);
  const previousWindow = getPreviousRangeWindow(range);
  const callWhere = {
    practiceId: membership.practiceId,
    ...(rangeStart ? { startedAt: { gte: rangeStart } } : {}),
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
    }
    if (isAfterHoursCall) {
      afterHoursSeconds += call.durationSec;
    }
    if (isSchedulingCall || isAfterHoursCall) {
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
    practiceName: membership.practice.name,
    previousTotalCalls,
    range,
    staffTimeSaved: {
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
      ],
      totalSeconds: staffTimeSavedSeconds,
    },
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
    bookings: bookedCalls.map(extractBookedAppointment),
    branding: getPracticeBranding(membership.practice),
    practiceName: membership.practice.name,
    range,
  };
}

export type PortalCallTranscript = {
  branding: PracticeBranding;
  callerPhone: string;
  callId: string;
  practiceName: string;
  sessionItems: ChatHistoryItem[];
  startedAt: Date;
  turns: TurnRecord[];
};

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
    practiceName: membership.practice.name,
    sessionItems,
    startedAt: call.startedAt,
    turns,
  };
}
