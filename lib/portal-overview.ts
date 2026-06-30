import { Prisma } from "@/generated/prisma/client";
import {
  buildPortalAgentCallScopeSql,
  buildPortalAgentCallScopeWhere,
  getCurrentPortalPracticeContext,
} from "@/lib/portal-access";
import type {
  AppointmentActionAnalytics,
  AppointmentAnalytics,
  CallSummaryData,
  ChatHistoryItem,
  ToolExecutionAnalytics,
  TurnRecord,
} from "@/lib/call-types";
import {
  appointmentActionFromOutputClass,
  getAppointmentActions,
  hasRenderableAppointmentDetails,
  isResolvedAppointmentAction,
} from "@/lib/appointment-actions";
import { getChatItemCreatedAt } from "@/lib/chat-history-items";
import { phoneDigits, phoneLookupVariants } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { getPracticeBranding, type PracticeBranding } from "@/lib/practice-branding";
import { isSuccessfulAppointmentBookingTool } from "@/lib/tool-action-status";

export type PortalBookedAppointment = {
  appointmentId: string | null;
  appointmentStart: string | null;
  appointmentStatus: string;
  appointmentTypeName: string | null;
  callId: string;
  callStartedAt: Date;
  callerPhone: string;
  careLane: PortalBookingCareLane;
  duration: number | null;
  locationName: string | null;
  patientName: string | null;
  providerName: string | null;
  summary: string | null;
  visitType: PortalBookingVisitType;
};

export type PortalBookingCareLane = "medical" | "routine_vision" | "unknown";

export type PortalBookingVisitType = "follow_up_or_existing" | "new" | "unknown";

export type PortalBookingCategoryCount = {
  followUpOrExisting: number;
  newPatient: number;
  total: number;
  unknownVisitType: number;
};

export type PortalBookingCategorySummary = {
  medical: PortalBookingCategoryCount;
  routineVision: PortalBookingCategoryCount;
  total: number;
  unknown: PortalBookingCategoryCount;
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
  bookingCategories: PortalBookingCategorySummary;
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
  bookingCategories: PortalBookingCategorySummary;
  branding: PracticeBranding;
  officeFilters: PortalOverviewOfficeFilterOption[];
  practiceName: string;
  range: PortalOverviewRange;
  searchQuery: string | null;
  selectedOfficeId: string | null;
  selectedOfficeLabel: string | null;
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

type PortalPracticeContext = NonNullable<
  Awaited<ReturnType<typeof getCurrentPortalPracticeContext>>
>;

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
type RawBookingCategoryCount = {
  appointmentTypeName: string | null;
  count: bigint | number | null;
};

function createEmptyBookingCategoryCount(): PortalBookingCategoryCount {
  return {
    followUpOrExisting: 0,
    newPatient: 0,
    total: 0,
    unknownVisitType: 0,
  };
}

function createEmptyBookingCategorySummary(): PortalBookingCategorySummary {
  return {
    medical: createEmptyBookingCategoryCount(),
    routineVision: createEmptyBookingCategoryCount(),
    total: 0,
    unknown: createEmptyBookingCategoryCount(),
  };
}

export function classifyBookingAppointmentType(appointmentTypeName: string | null): {
  careLane: PortalBookingCareLane;
  visitType: PortalBookingVisitType;
} {
  const normalized =
    appointmentTypeName
      ?.toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() ?? "";

  const careLane: PortalBookingCareLane = /\b(medical|crystal river|post op)\b/.test(
    normalized,
  )
    ? "medical"
    : /\b(routine|vision)\b/.test(normalized)
      ? "routine_vision"
      : "unknown";
  const visitType: PortalBookingVisitType = /\bnew\b/.test(normalized)
    ? "new"
    : /\b(established|follow|follow up|post op)\b/.test(normalized)
      ? "follow_up_or_existing"
      : "unknown";

  return { careLane, visitType };
}

export function summarizeBookingCategories(
  bookings: PortalBookedAppointment[],
): PortalBookingCategorySummary {
  const summary = createEmptyBookingCategorySummary();

  for (const booking of bookings) {
    addBookingCategoryCount(summary, booking.careLane, booking.visitType, 1);
  }

  return summary;
}

function addBookingCategoryCount(
  summary: PortalBookingCategorySummary,
  careLane: PortalBookingCareLane,
  visitType: PortalBookingVisitType,
  count: number,
) {
  const bucket =
    careLane === "medical"
      ? summary.medical
      : careLane === "routine_vision"
        ? summary.routineVision
        : summary.unknown;

  summary.total += count;
  bucket.total += count;

  if (visitType === "new") {
    bucket.newPatient += count;
  } else if (visitType === "follow_up_or_existing") {
    bucket.followUpOrExisting += count;
  } else {
    bucket.unknownVisitType += count;
  }
}

function summarizeBookingCategoryTypeCounts(
  rows: RawBookingCategoryCount[],
): PortalBookingCategorySummary {
  const summary = createEmptyBookingCategorySummary();

  for (const row of rows) {
    const count = numberValue(row.count);
    if (count <= 0) {
      continue;
    }

    const { careLane, visitType } = classifyBookingAppointmentType(
      asString(row.appointmentTypeName),
    );
    addBookingCategoryCount(summary, careLane, visitType, count);
  }

  return summary;
}

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

function normalizePortalBookingSearch(value: string | string[] | null | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return null;
  }

  const query = raw.replace(/\s+/g, " ").trim();
  return query ? query.slice(0, 80) : null;
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
    const key = phoneDigits(phone.phoneNumber);

    if (!key) {
      continue;
    }

    const id = phone.locationId ? `location:${phone.locationId}` : `phone:${key}`;
    const existing = optionsById.get(id);

    if (existing) {
      if (!existing.phones.some((item) => phoneDigits(item) === key)) {
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
  const key = phoneDigits(office);

  if (!office) {
    return null;
  }

  return (
    options.find(
      (option) =>
        option.id === office ||
        (key && option.phones.some((phone) => phoneDigits(phone) === key)),
    ) ?? null
  );
}

function buildPortalOverviewOfficeWhere(
  officeFilter: PortalOverviewOfficeFilterOption | null,
): Prisma.AgentCallWhereInput {
  const { officeLocationId, officePhoneVariants } =
    getPortalOverviewOfficeFilterParts(officeFilter);
  const clauses: Prisma.AgentCallWhereInput[] = [];

  if (officeLocationId) {
    clauses.push({ locationId: officeLocationId });
  }

  if (officePhoneVariants.length) {
    clauses.push({ officePhone: { in: officePhoneVariants } });
  }

  return clauses.length ? { OR: clauses } : {};
}

function andAgentCallWhere(
  ...clauses: Array<Prisma.AgentCallWhereInput | null | undefined>
): Prisma.AgentCallWhereInput {
  const activeClauses = clauses.filter((clause): clause is Prisma.AgentCallWhereInput =>
    Boolean(clause && Object.keys(clause).length > 0),
  );

  if (activeClauses.length === 0) {
    return {};
  }

  if (activeClauses.length === 1) {
    return activeClauses[0];
  }

  return {
    AND: activeClauses,
  };
}

function getPortalOverviewOfficeFilterParts(
  officeFilter: PortalOverviewOfficeFilterOption | null,
) {
  return {
    officeLocationId: officeFilter?.id.startsWith("location:")
      ? officeFilter.id.replace("location:", "")
      : null,
    officePhoneVariants: [
      ...new Set((officeFilter?.phones ?? []).flatMap(phoneLookupVariants)),
    ],
  };
}

function buildAllTimeOverviewSqlWhere(
  practiceId: string,
  accessContext: Awaited<ReturnType<typeof getCurrentPortalPracticeContext>>,
  officeFilter: PortalOverviewOfficeFilterOption | null,
) {
  const { officeLocationId, officePhoneVariants } =
    getPortalOverviewOfficeFilterParts(officeFilter);
  const clauses = [Prisma.sql`"practiceId" = ${practiceId}`];
  const officeClauses = [];

  if (accessContext) {
    clauses.push(buildPortalAgentCallScopeSql(accessContext));
  }

  if (officeLocationId) {
    officeClauses.push(Prisma.sql`"locationId" = ${officeLocationId}`);
  }

  if (officePhoneVariants.length) {
    officeClauses.push(
      Prisma.sql`"officePhone" IN (${Prisma.join(officePhoneVariants)})`,
    );
  }

  if (officeClauses.length) {
    clauses.push(Prisma.sql`(${Prisma.join(officeClauses, " OR ")})`);
  }

  return Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}`;
}

function buildBookedCallsSqlWhere(
  practiceId: string,
  accessContext: PortalPracticeContext,
  officeFilter: PortalOverviewOfficeFilterOption | null,
  rangeStart: Date | null,
) {
  const { officeLocationId, officePhoneVariants } =
    getPortalOverviewOfficeFilterParts(officeFilter);
  const clauses = [
    Prisma.sql`"practiceId" = ${practiceId}`,
    Prisma.sql`"bookedAppointment" = true`,
  ];
  const officeClauses = [];

  clauses.push(buildPortalAgentCallScopeSql(accessContext));

  if (rangeStart) {
    clauses.push(Prisma.sql`"startedAt" >= ${rangeStart}`);
  }

  if (officeLocationId) {
    officeClauses.push(Prisma.sql`"locationId" = ${officeLocationId}`);
  }

  if (officePhoneVariants.length) {
    officeClauses.push(
      Prisma.sql`"officePhone" IN (${Prisma.join(officePhoneVariants)})`,
    );
  }

  if (officeClauses.length) {
    clauses.push(Prisma.sql`(${Prisma.join(officeClauses, " OR ")})`);
  }

  return Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}`;
}

function numberValue(value: bigint | number | null | undefined) {
  return Number(value ?? 0);
}

async function getAllTimeOverviewAggregate(
  practiceId: string,
  accessContext: Awaited<ReturnType<typeof getCurrentPortalPracticeContext>>,
  officeFilter: PortalOverviewOfficeFilterOption | null,
): Promise<OverviewAggregate> {
  const where = buildAllTimeOverviewSqlWhere(practiceId, accessContext, officeFilter);
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
              NOT ("bookedAppointment" OR "confirmedAppointment" OR "cancelledAppointment")
              AND (
                EXTRACT(HOUR FROM timezone(${PRACTICE_TIMEZONE}, timezone('UTC', "startedAt"))) >= ${AFTER_HOURS_START}
                OR EXTRACT(HOUR FROM timezone(${PRACTICE_TIMEZONE}, timezone('UTC', "startedAt"))) < ${AFTER_HOURS_END}
              )
            THEN "durationSec"
            ELSE 0
          END
        ),
        0
      )::int AS "afterHoursSeconds",
      COALESCE(SUM("durationSec"), 0)::int AS "staffTimeSavedSeconds"
    FROM "agent_call"
    ${where}
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

async function getAllTimeCallVolume(
  practiceId: string,
  accessContext: Awaited<ReturnType<typeof getCurrentPortalPracticeContext>>,
  officeFilter: PortalOverviewOfficeFilterOption | null,
) {
  const where = buildAllTimeOverviewSqlWhere(practiceId, accessContext, officeFilter);
  const firstRows = await prisma.$queryRaw<Array<{ firstStartedAt: Date | null }>>`
    SELECT MIN("startedAt") AS "firstStartedAt"
    FROM "agent_call"
    ${where}
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
      ${where}
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
    ${where}
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

function getToolExecutions(data: unknown): ToolExecutionAnalytics[] {
  if (!isRecord(data) || !Array.isArray(data.toolExecutions)) {
    return [];
  }

  return data.toolExecutions.filter(isRecord).map((tool) => ({
    ...(typeof tool.callId === "string" ? { callId: tool.callId } : {}),
    ...(typeof tool.createdAt === "string" ? { createdAt: tool.createdAt } : {}),
    ...(typeof tool.outputClass === "string" ? { outputClass: tool.outputClass } : {}),
    ...(tool.status === "success" || tool.status === "error"
      ? { status: tool.status }
      : {}),
    ...(typeof tool.toolName === "string" ? { toolName: tool.toolName } : {}),
  }));
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

type StateBookedAppointment = {
  appointmentId: string | null;
  appointmentStart: string | null;
  appointmentStatus: string;
  appointmentTypeName: string | null;
  locationName: string | null;
  patientName: string | null;
  providerName: string | null;
};

type BookingAction = Extract<
  AppointmentActionAnalytics["action"],
  "booked" | "rescheduled"
>;

function extractStateBookedAppointment(data: unknown): StateBookedAppointment | null {
  if (!isRecord(data) || !isRecord(data.callState)) {
    return null;
  }

  const callState = data.callState;
  const identity = isRecord(callState.identity) ? callState.identity : null;
  const patient = isRecord(callState.patient)
    ? callState.patient
    : isRecord(identity?.patient)
      ? identity.patient
      : null;
  const privateState = isRecord(callState.private) ? callState.private : null;
  const latestBookedAppointmentId =
    asString(privateState?.latestBookedAppointmentId) ??
    asString(identity?.latestBookedAppointmentId);
  const appointments = Array.isArray(patient?.appointments)
    ? patient.appointments.filter(isRecord)
    : [];
  if (!latestBookedAppointmentId || appointments.length === 0) {
    return null;
  }

  const appointment =
    appointments.find((item) => asString(item.id) === latestBookedAppointmentId) ?? null;
  if (!appointment) {
    return null;
  }

  return {
    appointmentId: asString(appointment.id),
    appointmentStart: appointmentStartFromStateAppointment(appointment),
    appointmentStatus: "booked",
    appointmentTypeName: asString(appointment.type),
    locationName: asString(appointment.facility),
    patientName: normalizeDisplayName(asString(patient?.name)),
    providerName: asString(appointment.provider),
  };
}

function appointmentStartFromAnalytics(appointment: AppointmentAnalytics | undefined) {
  if (!appointment) {
    return null;
  }

  if (appointment.startDatetime) {
    return appointment.startDatetime;
  }

  if (!appointment.appointmentDate) {
    return null;
  }

  const localTime = localTimeForAppointment(appointment.appointmentTime ?? null);
  return localTime
    ? `${appointment.appointmentDate}T${localTime}`
    : appointment.appointmentTime
      ? `${appointment.appointmentDate} ${appointment.appointmentTime}`
      : appointment.appointmentDate;
}

function careLaneFromAnalytics(value: string | undefined): PortalBookingCareLane | null {
  const normalized = value
    ?.toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized === "medical") return "medical";
  if (normalized === "routine vision" || normalized === "vision") {
    return "routine_vision";
  }
  return null;
}

function appointmentStatusFromAction(action: BookingAction) {
  return action === "rescheduled" ? "rescheduled" : "booked";
}

function extractLatestStructuredBookingAction(
  data: unknown,
): AppointmentActionAnalytics | null {
  const actions = getAppointmentActions(data);

  for (let index = actions.length - 1; index >= 0; index--) {
    const action = actions[index];
    if (
      !isResolvedAppointmentAction(action) ||
      (action.action !== "booked" && action.action !== "rescheduled") ||
      !hasRenderableAppointmentDetails(action.appointment ?? null)
    ) {
      continue;
    }

    return action;
  }

  return null;
}

function extractLatestAppointmentExecutionAction(data: unknown): BookingAction | null {
  const toolExecutions = getToolExecutions(data);

  for (let index = toolExecutions.length - 1; index >= 0; index--) {
    const tool = toolExecutions[index];
    if (tool.status !== "success") {
      continue;
    }

    const action = appointmentActionFromOutputClass(tool.outputClass);
    if (action === "booked" || action === "rescheduled") {
      return action;
    }
  }

  return null;
}

function portalBookingFromAppointmentAction(
  action: AppointmentActionAnalytics,
  call: {
    callerPhone: string;
    id: string;
    outcomeSummary: string | null;
    startedAt: Date;
  },
  turns: Record<string, unknown>[],
): PortalBookedAppointment {
  const appointment = action.appointment;
  const appointmentTypeName = appointment?.appointmentTypeName ?? null;
  const classified = classifyBookingAppointmentType(appointmentTypeName);
  const careLane = careLaneFromAnalytics(appointment?.careLane) ?? classified.careLane;

  return {
    appointmentId: appointment?.appointmentId ?? null,
    appointmentStart: appointmentStartFromAnalytics(appointment),
    appointmentStatus: appointmentStatusFromAction(action.action as BookingAction),
    appointmentTypeName,
    callId: call.id,
    callStartedAt: call.startedAt,
    callerPhone: call.callerPhone,
    careLane,
    duration: null,
    locationName: appointment?.locationName ?? null,
    patientName: normalizeDisplayName(appointment?.patientName ?? null),
    providerName: appointment?.providerName ?? null,
    summary:
      call.outcomeSummary ??
      action.message ??
      fallbackAgentSummary(turns) ??
      "Appointment booked by the AI receptionist.",
    visitType: classified.visitType,
  };
}

function portalBookingFromState(
  stateBooking: StateBookedAppointment,
  call: {
    callerPhone: string;
    id: string;
    outcomeSummary: string | null;
    startedAt: Date;
  },
  turns: Record<string, unknown>[],
  action?: BookingAction | null,
): PortalBookedAppointment {
  const appointmentTypeName = stateBooking.appointmentTypeName;
  const { careLane, visitType } = classifyBookingAppointmentType(appointmentTypeName);

  return {
    appointmentId: stateBooking.appointmentId,
    appointmentStart: stateBooking.appointmentStart,
    appointmentStatus: action
      ? appointmentStatusFromAction(action)
      : stateBooking.appointmentStatus,
    appointmentTypeName,
    callId: call.id,
    callStartedAt: call.startedAt,
    callerPhone: call.callerPhone,
    careLane,
    duration: null,
    locationName: stateBooking.locationName,
    patientName: stateBooking.patientName,
    providerName: stateBooking.providerName,
    summary:
      call.outcomeSummary ??
      fallbackAgentSummary(turns) ??
      "Appointment booked by the AI receptionist.",
    visitType,
  };
}

function appointmentStartFromStateAppointment(appointment: Record<string, unknown>) {
  const date = asString(appointment.date);
  const time = asString(appointment.time);
  if (!date) {
    return null;
  }

  const localTime = localTimeForAppointment(time);
  return localTime ? `${date}T${localTime}` : time ? `${date} ${time}` : date;
}

function localTimeForAppointment(time: string | null) {
  if (!time) {
    return null;
  }
  const match = time.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3]?.toUpperCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  if (meridiem === "PM" && hour !== 12) {
    hour += 12;
  }
  if (meridiem === "AM" && hour === 12) {
    hour = 0;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function extractBookedAppointment(call: {
  callerPhone: string;
  data: unknown;
  id: string;
  outcomeSummary: string | null;
  startedAt: Date;
}): PortalBookedAppointment {
  const turns = getTurns(call.data);
  const structuredAction = extractLatestStructuredBookingAction(call.data);
  if (structuredAction) {
    return portalBookingFromAppointmentAction(structuredAction, call, turns);
  }

  const stateBooking = extractStateBookedAppointment(call.data);
  const executionAction = extractLatestAppointmentExecutionAction(call.data);
  if (stateBooking) {
    return portalBookingFromState(stateBooking, call, turns, executionAction);
  }

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
        isSuccessfulAppointmentBookingTool({
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
    asString(booking?.result?.appointmentId) ?? asString(booking?.result?.id) ?? null;
  const appointmentTypeName = asString(booking?.result?.appointmentTypeName) ?? null;
  const { careLane, visitType } = classifyBookingAppointmentType(appointmentTypeName);

  return {
    appointmentId,
    appointmentStart:
      asString(booking?.result?.startDatetime) ??
      asString(booking?.args?.startDatetime) ??
      asString(booking?.args?.startDateTime) ??
      asString(booking?.args?.datetime) ??
      null,
    appointmentStatus:
      (executionAction ? appointmentStatusFromAction(executionAction) : null) ??
      asString(booking?.result?.status) ??
      (appointmentId ? "booked" : "unknown"),
    appointmentTypeName,
    callId: call.id,
    callStartedAt: call.startedAt,
    callerPhone: call.callerPhone,
    careLane,
    duration:
      asNumber(booking?.result?.duration) ?? asNumber(booking?.args?.duration) ?? null,
    locationName:
      asString(booking?.result?.locationName) ??
      matchedAvailability?.locationName ??
      null,
    patientName:
      normalizeDisplayName(asString(booking?.result?.patientName)) ??
      extractPatientName(booking?.args ?? null) ??
      null,
    providerName:
      asString(booking?.result?.providerName) ??
      matchedAvailability?.providerName ??
      null,
    summary:
      call.outcomeSummary ??
      booking?.turnAgentText ??
      fallbackAgentSummary(turns) ??
      "Appointment booked by the AI receptionist.",
    visitType,
  };
}

function isRenderableBooking(booking: PortalBookedAppointment) {
  return (
    booking.appointmentStatus !== "error" &&
    Boolean(
      booking.appointmentId ||
      booking.appointmentStart ||
      booking.appointmentTypeName ||
      booking.locationName ||
      booking.patientName ||
      booking.providerName,
    )
  );
}

export function filterPortalBookingsBySearch(
  bookings: PortalBookedAppointment[],
  search: string | string[] | null | undefined,
) {
  const query = normalizePortalBookingSearch(search);

  if (!query) {
    return bookings;
  }

  const textQuery = query.toLowerCase();
  const digitQuery = phoneDigits(query);

  return bookings.filter((booking) => {
    const patientName = booking.patientName?.toLowerCase() ?? "";
    const callerPhone = booking.callerPhone.toLowerCase();
    const callerPhoneDigits = phoneDigits(booking.callerPhone);

    return (
      patientName.includes(textQuery) ||
      callerPhone.includes(textQuery) ||
      Boolean(digitQuery && callerPhoneDigits.includes(digitQuery))
    );
  });
}

async function loadPortalBookedAppointments({
  context,
  limit,
  rangeStart,
  selectedOffice,
}: {
  context: PortalPracticeContext;
  limit: number | null;
  rangeStart: Date | null;
  selectedOffice: PortalOverviewOfficeFilterOption | null;
}) {
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
    ...(typeof limit === "number" ? { take: limit } : {}),
    where: andAgentCallWhere(
      {
        bookedAppointment: true,
        practiceId: context.practice.id,
      },
      rangeStart ? { startedAt: { gte: rangeStart } } : null,
      buildPortalAgentCallScopeWhere(context),
      buildPortalOverviewOfficeWhere(selectedOffice),
    ),
  });

  return bookedCalls.map(extractBookedAppointment).filter(isRenderableBooking);
}

async function loadPortalBookingCategorySummary({
  context,
  rangeStart,
  selectedOffice,
}: {
  context: PortalPracticeContext;
  rangeStart: Date | null;
  selectedOffice: PortalOverviewOfficeFilterOption | null;
}) {
  const where = buildBookedCallsSqlWhere(
    context.practice.id,
    context,
    selectedOffice,
    rangeStart,
  );
  // Keep overview summaries aggregated so all-time views do not hydrate every call JSON.
  const rows = await prisma.$queryRaw<RawBookingCategoryCount[]>`
    WITH booked AS (
      SELECT COALESCE("data", '{}'::jsonb) AS "data"
      FROM "agent_call"
      ${where}
    ),
    typed AS (
      SELECT
        COALESCE(
          action_type."appointmentTypeName",
          tool_type."appointmentTypeName",
          state_type."appointmentTypeName"
        ) AS "appointmentTypeName"
      FROM booked
      LEFT JOIN LATERAL (
        SELECT action_item.item -> 'appointment' ->> 'appointmentTypeName' AS "appointmentTypeName"
        FROM jsonb_array_elements(COALESCE(booked."data" -> 'appointmentActions', '[]'::jsonb))
          WITH ORDINALITY AS action_item(item, action_index)
        WHERE action_item.item ->> 'action' IN ('booked', 'rescheduled')
          AND COALESCE(action_item.item ->> 'status', '') <> 'error'
          AND jsonb_typeof(action_item.item -> 'appointment') = 'object'
          AND action_item.item -> 'appointment' ->> 'appointmentTypeName' IS NOT NULL
        ORDER BY action_item.action_index DESC
        LIMIT 1
      ) AS action_type ON TRUE
      LEFT JOIN LATERAL (
        SELECT parsed."appointmentTypeName"
        FROM (
          SELECT
            tool_item.tool ->> 'name' AS name,
            turn_item.turn_index,
            tool_item.tool_index,
            COALESCE(
              CASE
                WHEN jsonb_typeof(tool_item.tool -> 'result') = 'object'
                THEN tool_item.tool -> 'result' ->> 'appointmentTypeName'
                ELSE NULL
              END,
              substring(tool_item.tool ->> 'result' from '"appointmentTypeName"\\s*:\\s*"([^"]+)"')
            ) AS "appointmentTypeName",
            COALESCE(
              CASE
                WHEN jsonb_typeof(tool_item.tool -> 'result') = 'object'
                THEN tool_item.tool -> 'result' ->> 'appointmentId'
                ELSE NULL
              END,
              CASE
                WHEN jsonb_typeof(tool_item.tool -> 'result') = 'object'
                THEN tool_item.tool -> 'result' ->> 'id'
                ELSE NULL
              END,
              substring(tool_item.tool ->> 'result' from '"appointmentId"\\s*:\\s*"?([^",}]+)"?'),
              substring(tool_item.tool ->> 'result' from '"id"\\s*:\\s*"?([^",}]+)"?')
            ) AS "appointmentId",
            COALESCE(
              CASE
                WHEN jsonb_typeof(tool_item.tool -> 'result') = 'object'
                THEN tool_item.tool -> 'result' ->> 'cancelledAppointmentId'
                ELSE NULL
              END,
              substring(tool_item.tool ->> 'result' from '"cancelledAppointmentId"\\s*:\\s*"?([^",}]+)"?')
            ) AS "cancelledAppointmentId",
            COALESCE(
              CASE
                WHEN jsonb_typeof(tool_item.tool -> 'result') = 'object'
                THEN tool_item.tool -> 'result' ->> 'cancellationStatus'
                ELSE NULL
              END,
              substring(tool_item.tool ->> 'result' from '"cancellationStatus"\\s*:\\s*"([^"]+)"')
            ) AS "cancellationStatus",
            COALESCE(
              CASE
                WHEN
                  jsonb_typeof(tool_item.tool -> 'result') = 'object'
                  AND jsonb_typeof(tool_item.tool -> 'result' -> 'ok') = 'boolean'
                THEN tool_item.tool -> 'result' ->> 'ok'
                ELSE NULL
              END,
              substring(tool_item.tool ->> 'result' from '"ok"\\s*:\\s*(true|false)')
            ) AS ok,
            COALESCE(
              CASE
                WHEN jsonb_typeof(tool_item.tool -> 'result') = 'object'
                THEN tool_item.tool -> 'result' ->> 'status'
                ELSE NULL
              END,
              substring(tool_item.tool ->> 'result' from '"status"\\s*:\\s*"([^"]+)"')
            ) AS status
          FROM jsonb_array_elements(COALESCE(booked."data" -> 'turns', '[]'::jsonb))
            WITH ORDINALITY AS turn_item(turn, turn_index)
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(turn_item.turn -> 'toolCalls', '[]'::jsonb))
            WITH ORDINALITY AS tool_item(tool, tool_index)
          WHERE tool_item.tool ->> 'name' IN (
            'book_appt',
            'book_appointment',
            'reschedule_appt',
            'reschedule_appointment'
          )
            AND COALESCE(tool_item.tool ->> 'isError', 'false') <> 'true'
        ) AS parsed
        WHERE lower(COALESCE(parsed.status, '')) <> 'error'
          AND (
            (
              parsed.name IN ('book_appt', 'book_appointment')
              AND (
                lower(COALESCE(parsed.status, '')) = 'booked'
                OR parsed."appointmentId" IS NOT NULL
                OR lower(COALESCE(parsed.ok, '')) = 'true'
              )
            )
            OR (
              parsed.name IN ('reschedule_appt', 'reschedule_appointment')
              AND parsed."appointmentId" IS NOT NULL
              AND (
                lower(COALESCE(parsed.status, '')) = 'rescheduled'
                OR parsed."cancelledAppointmentId" IS NOT NULL
                OR lower(COALESCE(parsed."cancellationStatus", '')) = 'cancelled'
              )
            )
          )
        ORDER BY parsed.turn_index DESC, parsed.tool_index DESC
        LIMIT 1
      ) AS tool_type ON TRUE
      LEFT JOIN LATERAL (
        SELECT appointment.item ->> 'type' AS "appointmentTypeName"
        FROM (
          SELECT
            COALESCE(
              booked."data" -> 'callState' -> 'patient',
              booked."data" -> 'callState' -> 'identity' -> 'patient'
            ) AS patient,
            COALESCE(
              booked."data" -> 'callState' -> 'private' ->> 'latestBookedAppointmentId',
              booked."data" -> 'callState' -> 'identity' ->> 'latestBookedAppointmentId'
            ) AS latest_appointment_id
        ) AS state
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(state.patient -> 'appointments', '[]'::jsonb))
          AS appointment(item)
        WHERE appointment.item ->> 'id' = state.latest_appointment_id
        LIMIT 1
      ) AS state_type ON TRUE
    )
    SELECT "appointmentTypeName", COUNT(*)::int AS count
    FROM typed
    GROUP BY "appointmentTypeName"
  `;

  return summarizeBookingCategoryTypeCounts(rows);
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
  const context = await getCurrentPortalPracticeContext();

  if (!context) {
    return null;
  }

  const { practice } = context;

  const officeFilters = buildPortalOverviewOfficeFilters(context.allowedPhoneNumbers);
  const selectedOffice = resolvePortalOverviewOfficeFilter(office, officeFilters);
  const rangeStart = getRangeStart(range);
  const previousWindow = getPreviousRangeWindow(range);
  const accessWhere = buildPortalAgentCallScopeWhere(context);
  const officeWhere = buildPortalOverviewOfficeWhere(selectedOffice);

  if (range === "all") {
    const [aggregate, bookingCategories, callVolume] = await Promise.all([
      getAllTimeOverviewAggregate(practice.id, context, selectedOffice),
      loadPortalBookingCategorySummary({
        context,
        rangeStart: null,
        selectedOffice,
      }),
      getAllTimeCallVolume(practice.id, context, selectedOffice),
    ]);

    return {
      appointmentActions: {
        booked: aggregate.bookedActionCount,
        cancelled: aggregate.cancelledActionCount,
        confirmed: aggregate.confirmedActionCount,
      },
      averageCallDurationSec:
        aggregate.callCount > 0 ? aggregate.totalDurationSec / aggregate.callCount : 0,
      branding: getPracticeBranding(practice),
      bookingCategories,
      callVolume,
      officeFilters,
      practiceName: practice.name,
      previousTotalCalls: 0,
      range,
      selectedOfficeId: selectedOffice?.id ?? null,
      selectedOfficeLabel: selectedOffice?.label ?? null,
      staffTimeSaved: buildStaffTimeSaved(
        aggregate.staffTimeSavedSeconds,
        aggregate.schedulingSeconds,
        aggregate.afterHoursSeconds,
      ),
      totalCallMinutes: aggregate.totalDurationSec / 60,
      totalCalls: aggregate.callCount,
      transferRate:
        aggregate.callCount > 0 ? aggregate.transferredCalls / aggregate.callCount : 0,
      transferredCalls: aggregate.transferredCalls,
    };
  }

  const callWhere = andAgentCallWhere(
    { practiceId: practice.id },
    rangeStart ? { startedAt: { gte: rangeStart } } : null,
    accessWhere,
    officeWhere,
  );

  const [callRows, bookingCategories, previousTotalCalls] = await Promise.all([
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
    loadPortalBookingCategorySummary({
      context,
      rangeStart,
      selectedOffice,
    }),
    previousWindow
      ? prisma.agentCall.count({
          where: {
            practiceId: practice.id,
            startedAt: { gte: previousWindow.start, lt: previousWindow.end },
            ...andAgentCallWhere(accessWhere, officeWhere),
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
    } else if (isAfterHoursCall) {
      afterHoursSeconds += call.durationSec;
    }
    staffTimeSavedSeconds += call.durationSec;
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
    branding: getPracticeBranding(practice),
    bookingCategories,
    callVolume,
    officeFilters,
    practiceName: practice.name,
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
  limit: number | null = 50,
  office?: string | string[] | null,
  search?: string | string[] | null,
): Promise<PortalBookingsResult | null> {
  const context = await getCurrentPortalPracticeContext();

  if (!context) {
    return null;
  }

  const rangeStart = getRangeStart(range);
  const searchQuery = normalizePortalBookingSearch(search);
  const { practice } = context;
  const officeFilters = buildPortalOverviewOfficeFilters(context.allowedPhoneNumbers);
  const selectedOffice = resolvePortalOverviewOfficeFilter(office, officeFilters);
  const bookings = await loadPortalBookedAppointments({
    context,
    limit,
    rangeStart,
    selectedOffice,
  });
  const filteredBookings = filterPortalBookingsBySearch(bookings, searchQuery);

  return {
    bookings: filteredBookings,
    bookingCategories: summarizeBookingCategories(filteredBookings),
    branding: getPracticeBranding(practice),
    officeFilters,
    practiceName: practice.name,
    range,
    searchQuery,
    selectedOfficeId: selectedOffice?.id ?? null,
    selectedOfficeLabel: selectedOffice?.label ?? null,
  };
}

export type PortalCallTranscript = {
  branding: PracticeBranding;
  bookedAppointment: PortalBookedAppointment | null;
  callerPhone: string;
  callId: string;
  durationSec: number | null;
  messages: PortalCallTranscriptMessage[];
  outcomeSummary: string | null;
  practiceName: string;
  startedAt: Date;
  transferred: boolean;
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
      timestamp: getChatItemCreatedAt(item) ?? null,
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
  const context = await getCurrentPortalPracticeContext();

  if (!context) {
    return null;
  }

  const { practice } = context;

  const call = await prisma.agentCall.findFirst({
    select: {
      callerPhone: true,
      data: true,
      durationSec: true,
      id: true,
      outcomeSummary: true,
      startedAt: true,
      transferred: true,
    },
    where: andAgentCallWhere(
      {
        id: callId,
        practiceId: practice.id,
      },
      buildPortalAgentCallScopeWhere(context),
    ),
  });

  if (!call) {
    return null;
  }

  const data = (isRecord(call.data) ? (call.data as CallSummaryData) : null) ?? null;
  const turns = Array.isArray(data?.turns) ? (data?.turns as TurnRecord[]) : [];
  const sessionItems = Array.isArray(data?.sessionReport?.chat_history?.items)
    ? (data?.sessionReport?.chat_history?.items as ChatHistoryItem[])
    : [];
  const bookedAppointment = extractBookedAppointment(call);

  return {
    bookedAppointment: isRenderableBooking(bookedAppointment) ? bookedAppointment : null,
    branding: getPracticeBranding(practice),
    callerPhone: call.callerPhone,
    callId: call.id,
    durationSec: call.durationSec,
    messages: buildPortalCallTranscriptMessages({ sessionItems, turns }),
    outcomeSummary: call.outcomeSummary,
    practiceName: practice.name,
    startedAt: call.startedAt,
    transferred: call.transferred,
  };
}
