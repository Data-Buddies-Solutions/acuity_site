import { prisma } from "@/lib/prisma";

type AgentStatus = "SETUP" | "ACTIVE" | "PAUSED" | "ERROR";
type CostCategory =
  | "LLM_INPUT"
  | "LLM_CACHED_INPUT"
  | "LLM_OUTPUT"
  | "SPEECH_TO_TEXT"
  | "TEXT_TO_SPEECH"
  | "TELEPHONY"
  | "REVIEW"
  | "OTHER";

type CallMetric = {
  bookedAppointment: boolean;
  cancelledAppointment: boolean;
  confirmedAppointment: boolean;
  durationSec: number;
  estimatedCostMicros: number;
  needsReview: boolean;
  practiceId: string;
  startedAt: Date;
  status: string;
  transferred: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function sinceDays(days: number) {
  return new Date(Date.now() - days * DAY_MS);
}

function getAgentStatus(agents: Array<{ status: AgentStatus }>): AgentStatus {
  if (agents.some((agent) => agent.status === "ERROR")) {
    return "ERROR";
  }

  if (agents.some((agent) => agent.status === "ACTIVE")) {
    return "ACTIVE";
  }

  if (agents.some((agent) => agent.status === "PAUSED")) {
    return "PAUSED";
  }

  return "SETUP";
}

function addMapValue(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function countCallsByPractice(calls: CallMetric[], since: Date) {
  const counts = new Map<string, number>();

  for (const call of calls) {
    if (call.startedAt >= since) {
      addMapValue(counts, call.practiceId, 1);
    }
  }

  return counts;
}

function sumCostByPractice(calls: CallMetric[], since: Date) {
  const costs = new Map<string, number>();

  for (const call of calls) {
    if (call.startedAt >= since) {
      addMapValue(costs, call.practiceId, call.estimatedCostMicros);
    }
  }

  return costs;
}

function needsReviewByPractice(calls: CallMetric[]) {
  const counts = new Map<string, number>();

  for (const call of calls) {
    if (call.needsReview) {
      addMapValue(counts, call.practiceId, 1);
    }
  }

  return counts;
}

function latestCallByPractice(calls: CallMetric[]) {
  const latest = new Map<string, CallMetric>();

  for (const call of calls) {
    const current = latest.get(call.practiceId);
    if (!current || call.startedAt > current.startedAt) {
      latest.set(call.practiceId, call);
    }
  }

  return latest;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildDailyBuckets(calls: CallMetric[], days: number) {
  const start = sinceDays(days - 1);
  start.setHours(0, 0, 0, 0);

  const buckets = Array.from({ length: days }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY_MS);
    return {
      calls: 0,
      costMicros: 0,
      date,
    };
  });

  for (const call of calls) {
    const bucketIndex = Math.floor((call.startedAt.getTime() - start.getTime()) / DAY_MS);
    const bucket = buckets[bucketIndex];

    if (bucket) {
      bucket.calls += 1;
      bucket.costMicros += call.estimatedCostMicros;
    }
  }

  return buckets;
}

export async function getAdminPracticeSummaries() {
  const since30 = sinceDays(30);
  const since7 = sinceDays(7);
  const since1 = sinceDays(1);

  const [practices, calls] = await Promise.all([
    prisma.practice.findMany({
      include: {
        agents: {
          orderBy: {
            createdAt: "desc",
          },
        },
        phoneNumbers: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
      },
      orderBy: {
        name: "asc",
      },
    }),
    prisma.agentCall.findMany({
      orderBy: {
        startedAt: "desc",
      },
      select: {
        bookedAppointment: true,
        cancelledAppointment: true,
        confirmedAppointment: true,
        durationSec: true,
        estimatedCostMicros: true,
        needsReview: true,
        practiceId: true,
        startedAt: true,
        status: true,
        transferred: true,
      },
      where: {
        startedAt: {
          gte: since30,
        },
      },
    }),
  ]);

  const calls24 = countCallsByPractice(calls, since1);
  const calls7 = countCallsByPractice(calls, since7);
  const costs7 = sumCostByPractice(calls, since7);
  const reviewCounts = needsReviewByPractice(calls);
  const latestCalls = latestCallByPractice(calls);

  return practices.map((practice) => {
    const agentStatus = getAgentStatus(practice.agents);
    const primaryPhone = practice.phoneNumbers.find((phone) => phone.isPrimary) ?? practice.phoneNumbers[0];
    const lastCall = latestCalls.get(practice.id);

    return {
      agentCount: practice.agents.length,
      agentStatus,
      calls24h: calls24.get(practice.id) ?? 0,
      calls7d: calls7.get(practice.id) ?? 0,
      cost7dMicros: costs7.get(practice.id) ?? 0,
      id: practice.id,
      lastCallAt: lastCall?.startedAt ?? null,
      launchedAt: practice.launchedAt,
      needsReviewCount: reviewCounts.get(practice.id) ?? 0,
      onboardingStatus: practice.onboardingStatus,
      phoneNumber: primaryPhone?.phoneNumber ?? null,
      practiceType: practice.practiceType,
      name: practice.name,
    };
  });
}

export async function getAdminPracticeDetail(practiceId: string) {
  const since30 = sinceDays(30);
  const since7 = sinceDays(7);
  const since1 = sinceDays(1);

  const [practice, calls, costLineItems] = await Promise.all([
    prisma.practice.findUnique({
      include: {
        agents: {
          orderBy: {
            createdAt: "desc",
          },
        },
        locations: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
        memberships: {
          include: {
            user: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
        phoneNumbers: {
          include: {
            location: true,
          },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
      },
      where: {
        id: practiceId,
      },
    }),
    prisma.agentCall.findMany({
      orderBy: {
        startedAt: "desc",
      },
      select: {
        bookedAppointment: true,
        callerPhone: true,
        cancelledAppointment: true,
        confirmedAppointment: true,
        durationSec: true,
        estimatedCostMicros: true,
        id: true,
        needsReview: true,
        officePhone: true,
        outcomeSummary: true,
        practiceId: true,
        reviewAverageScore: true,
        reviewStatus: true,
        startedAt: true,
        status: true,
        toolErrors: true,
        toolCalls: true,
        transferred: true,
      },
      where: {
        practiceId,
        startedAt: {
          gte: since30,
        },
      },
    }),
    prisma.usageCostLineItem.findMany({
      orderBy: {
        occurredAt: "desc",
      },
      select: {
        category: true,
        costMicros: true,
      },
      where: {
        occurredAt: {
          gte: since30,
        },
        practiceId,
      },
    }),
  ]);

  if (!practice) {
    return null;
  }

  const callMetrics: CallMetric[] = calls.map((call) => ({
    bookedAppointment: call.bookedAppointment,
    cancelledAppointment: call.cancelledAppointment,
    confirmedAppointment: call.confirmedAppointment,
    durationSec: call.durationSec,
    estimatedCostMicros: call.estimatedCostMicros,
    needsReview: call.needsReview,
    practiceId,
    startedAt: call.startedAt,
    status: call.status,
    transferred: call.transferred,
  }));

  const calls24h = callMetrics.filter((call) => call.startedAt >= since1);
  const calls7d = callMetrics.filter((call) => call.startedAt >= since7);
  const needsReview = callMetrics.filter((call) => call.needsReview);
  const costByCategory = new Map<CostCategory, number>();

  for (const item of costLineItems) {
    addMapValue(costByCategory, item.category, item.costMicros);
  }

  return {
    agentStatus: getAgentStatus(practice.agents),
    costByCategory: [...costByCategory.entries()]
      .map(([category, costMicros]) => ({ category, costMicros }))
      .sort((a, b) => b.costMicros - a.costMicros),
    dailyBuckets7d: buildDailyBuckets(calls7d, 7),
    practice,
    recentCalls: calls.slice(0, 20),
    stats: {
      appointments:
        calls7d.filter(
          (call) =>
            call.bookedAppointment ||
            call.confirmedAppointment ||
            call.cancelledAppointment,
        ).length,
      avgDurationSec: average(calls7d.map((call) => call.durationSec)),
      calls24h: calls24h.length,
      calls7d: calls7d.length,
      calls30d: callMetrics.length,
      cost7dMicros: calls7d.reduce((sum, call) => sum + call.estimatedCostMicros, 0),
      cost30dMicros: callMetrics.reduce((sum, call) => sum + call.estimatedCostMicros, 0),
      failedCalls7d: calls7d.filter((call) => call.status === "FAILED").length,
      needsReview30d: needsReview.length,
      transferRate7d: calls7d.length > 0
        ? calls7d.filter((call) => call.transferred).length / calls7d.length
        : 0,
    },
  };
}

export async function getAdminCallDetail(practiceId: string, callId: string) {
  return prisma.agentCall.findFirst({
    include: {
      agent: true,
      costLineItems: {
        orderBy: {
          costMicros: "desc",
        },
      },
      location: true,
      practice: true,
    },
    where: {
      practiceId,
      OR: [{ id: callId }, { callId }],
    },
  });
}
