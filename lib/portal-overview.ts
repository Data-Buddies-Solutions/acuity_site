import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type PortalBookedAppointment = {
  appointmentId: string | null;
  appointmentStart: string | null;
  appointmentStatus: string;
  callId: string;
  callStartedAt: Date;
  callerPhone: string;
  locationName: string | null;
  providerName: string | null;
  summary: string | null;
};

export type PortalOverviewMetrics = {
  averageCallDurationSec: number;
  bookedAppointments: PortalBookedAppointment[];
  practiceName: string;
  range: PortalOverviewRange;
  totalCallMinutes: number;
  totalCalls: number;
  transferRate: number;
  transferredCalls: number;
};

export type PortalOverviewRange = "24h" | "7d" | "30d" | "all";

const rangeDays: Record<Exclude<PortalOverviewRange, "all">, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
};

function getRangeStart(range: PortalOverviewRange) {
  if (range === "all") {
    return null;
  }

  return new Date(Date.now() - rangeDays[range] * 24 * 60 * 60 * 1000);
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
  let booking:
    | {
        args: Record<string, unknown> | null;
        result: Record<string, unknown> | null;
        turnAgentText: string | null;
      }
    | null = null;

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
    providerName: matchedAvailability?.providerName ?? null,
    summary:
      call.outcomeSummary ??
      booking?.turnAgentText ??
      fallbackAgentSummary(turns) ??
      "Appointment booked by the AI receptionist.",
  };
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
  const callWhere = {
    practiceId: membership.practiceId,
    ...(rangeStart ? { startedAt: { gte: rangeStart } } : {}),
  };

  const [callCount, transferredCalls, durationAggregate, bookedCalls] = await Promise.all([
    prisma.agentCall.count({
      where: callWhere,
    }),
    prisma.agentCall.count({
      where: {
        ...callWhere,
        transferred: true,
      },
    }),
    prisma.agentCall.aggregate({
      _sum: {
        durationSec: true,
      },
      where: callWhere,
    }),
    prisma.agentCall.findMany({
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
      take: 8,
      where: {
        ...callWhere,
        bookedAppointment: true,
      },
    }),
  ]);

  const totalDurationSec = durationAggregate._sum.durationSec ?? 0;

  return {
    averageCallDurationSec: callCount > 0 ? totalDurationSec / callCount : 0,
    bookedAppointments: bookedCalls.map(extractBookedAppointment),
    practiceName: membership.practice.name,
    range,
    totalCallMinutes: totalDurationSec / 60,
    totalCalls: callCount,
    transferRate: callCount > 0 ? transferredCalls / callCount : 0,
    transferredCalls,
  };
}
