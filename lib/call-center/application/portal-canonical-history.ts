import { type CallCenterCallStatus, type Prisma } from "@/generated/prisma/client";
import {
  buildPortalNeedsActionGroups,
  portalNeedsActionGroupId,
  type PortalCallActivityItem,
  type PortalCallCenterHistoryRange,
  type PortalCallCenterHistoryTotals,
  type PortalCallCenterHistoryView,
  type PortalCallerTimeline,
  type PortalCallerTimelineItem,
  type PortalNeedsActionGroup,
  type PortalRecentCallItem,
} from "@/lib/call-center/portal-model";
import { canonicalCallOutcome } from "@/lib/call-center/domain/canonical-call-outcome";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";
import { getPracticeBranding } from "@/lib/practice-branding";
import { prisma } from "@/lib/prisma";
import { getCurrentPortalPracticeContext } from "@/lib/portal-access";

type PortalContext = NonNullable<
  Awaited<ReturnType<typeof getCurrentPortalPracticeContext>>
>;
type CallAccessContext = {
  allowedLocationIds: string[];
  hasAllLocationAccess: boolean;
  practice: { id: string };
};
type CanonicalHistoryDatabase = Pick<typeof prisma, "callCenterCall" | "callCenterTask">;
type CanonicalHistoryDependencies = {
  database?: CanonicalHistoryDatabase;
  getContext?: typeof getCurrentPortalPracticeContext;
};

function accessibleLocationIds(context: CallAccessContext, requested: string[]) {
  if (requested.length) {
    return context.hasAllLocationAccess
      ? requested
      : requested.filter((id) => context.allowedLocationIds.includes(id));
  }
  return context.hasAllLocationAccess ? null : context.allowedLocationIds;
}

export function canonicalCallAccessWhere(
  context: CallAccessContext,
  requestedLocationIds: string[] = [],
): Prisma.CallCenterCallWhereInput {
  const locationIds = accessibleLocationIds(context, requestedLocationIds);
  return {
    practiceId: context.practice.id,
    ...(locationIds === null
      ? {}
      : locationIds.length
        ? {
            number: {
              practiceId: context.practice.id,
              practicePhoneNumber: {
                locationId: { in: locationIds },
                practiceId: context.practice.id,
              },
            },
          }
        : { id: { in: [] } }),
  };
}

function rangeCutoff(range: PortalCallCenterHistoryRange, now: Date) {
  if (range === "24h") return new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  if (range === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);
  return null;
}

const connectedHistoryStatuses = ["CONNECTED", "WRAP_UP", "COMPLETED"] as const;

function portalStatus(call: {
  answeredAt: Date | null;
  direction: "INBOUND" | "OUTBOUND";
  status: CallCenterCallStatus;
  voicemail: {
    durationSec: number;
    recordingId: string;
    recordingUrl: string;
  } | null;
}) {
  const outcome = canonicalCallOutcome(call);
  if (outcome === "MISSED_CALL") return "MISSED" as const;
  if (outcome === "VOICEMAIL") return "VOICEMAIL" as const;
  switch (call.status) {
    case "RECEIVED":
    case "QUEUED":
    case "RINGING":
      return "RINGING" as const;
    case "CONNECTED":
    case "WRAP_UP":
      return "ACTIVE" as const;
    case "COMPLETED":
      return "COMPLETED" as const;
    case "VOICEMAIL":
      return "VOICEMAIL" as const;
    case "ABANDONED":
      return "MISSED" as const;
    case "FAILED":
      return "FAILED" as const;
  }
}

function callDurationSec(call: {
  answeredAt: Date | null;
  endedAt: Date | null;
  receivedAt: Date;
}) {
  if (!call.endedAt) return null;
  const duration =
    call.endedAt.getTime() - (call.answeredAt ?? call.receivedAt).getTime();
  return duration < 0 ? null : Math.round(duration / 1_000);
}

export async function readCanonicalCallCenterHistory(
  options: {
    now?: Date;
    page?: number;
    pageSize?: number;
    range?: PortalCallCenterHistoryRange;
    view?: PortalCallCenterHistoryView;
  } = {},
  {
    database = prisma,
    getContext = getCurrentPortalPracticeContext,
  }: CanonicalHistoryDependencies = {},
) {
  const context = await getContext();
  if (!context) return null;
  const page = Math.max(1, Math.round(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(25, Math.round(options.pageSize ?? 100)));
  const range = options.range ?? "24h";
  const view = options.view ?? "connections";
  const cutoff = rangeCutoff(range, options.now ?? new Date());
  const accessWhere: Prisma.CallCenterCallWhereInput = {
    ...canonicalCallAccessWhere(context),
    ...(cutoff ? { receivedAt: { gte: cutoff } } : {}),
  };
  const connectedWhere: Prisma.CallCenterCallWhereInput = {
    ...accessWhere,
    answeredAt: { not: null },
    status: { in: [...connectedHistoryStatuses] },
  };
  const callWhere = view === "all" ? accessWhere : connectedWhere;
  const outboundAttemptWhere: Prisma.CallCenterCallWhereInput = {
    ...accessWhere,
    direction: "OUTBOUND",
  };
  const [calls, totalCalls, inboundCalls, outboundCalls, outboundDialedCalls] =
    await Promise.all([
      database.callCenterCall.findMany({
        orderBy: [{ endedAt: "desc" }, { answeredAt: "desc" }, { receivedAt: "desc" }],
        select: {
          answeredAt: true,
          direction: true,
          endedAt: true,
          fromPhone: true,
          id: true,
          number: {
            select: {
              practicePhoneNumber: {
                select: { location: { select: { name: true } } },
              },
            },
          },
          providerCallSessionId: true,
          receivedAt: true,
          status: true,
          toPhone: true,
          voicemail: {
            select: {
              durationSec: true,
              recordingId: true,
              recordingUrl: true,
            },
          },
          winningLeg: { select: { endpoint: { select: { label: true } } } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        where: callWhere,
      }),
      database.callCenterCall.count({ where: callWhere }),
      database.callCenterCall.count({
        where: { ...connectedWhere, direction: "INBOUND" },
      }),
      database.callCenterCall.count({
        where: { ...connectedWhere, direction: "OUTBOUND" },
      }),
      database.callCenterCall.count({
        where: outboundAttemptWhere,
      }),
    ]);

  return {
    branding: getPracticeBranding(context.practice),
    calls: calls.map((call): PortalRecentCallItem => ({
      answeredBy: call.winningLeg?.endpoint?.label ?? null,
      connected:
        call.answeredAt !== null &&
        connectedHistoryStatuses.includes(
          call.status as (typeof connectedHistoryStatuses)[number],
        ),
      direction: call.direction === "OUTBOUND" ? "OUTBOUND" : "INBOUND",
      durationSec: callDurationSec(call),
      fromPhone: call.fromPhone,
      id: call.id,
      locationName: call.number.practicePhoneNumber.location?.name ?? null,
      occurredAt: call.endedAt ?? call.answeredAt ?? call.receivedAt,
      providerCallSessionId: call.providerCallSessionId,
      startedAt: call.receivedAt,
      status: portalStatus(call),
      toPhone: call.toPhone,
    })),
    page,
    pageSize,
    practiceName: context.practice.name,
    range,
    totals: {
      inboundCalls,
      outboundCalls,
      outboundDialedCalls,
      totalCalls,
    } satisfies PortalCallCenterHistoryTotals,
  };
}

function taskActivity(task: {
  call: {
    answeredAt: Date | null;
    callerName: string | null;
    direction: "INBOUND" | "OUTBOUND";
    fromPhone: string;
    number: { practicePhoneNumber: { location: { name: string } | null } };
    status: CallCenterCallStatus;
    toPhone: string;
    voicemail: {
      durationSec: number;
      recordingId: string;
      recordingUrl: string;
    } | null;
  };
  createdAt: Date;
  id: string;
  kind: "CALLBACK" | "FOLLOW_UP" | "MISSED_CALL" | "NOTE" | "VOICEMAIL";
  note: string | null;
}): PortalCallActivityItem {
  const storedUnanswered = task.kind === "VOICEMAIL" || task.kind === "MISSED_CALL";
  const outcome =
    storedUnanswered && task.call
      ? canonicalCallOutcome(task.call)
      : task.kind === "VOICEMAIL"
        ? "VOICEMAIL"
        : task.kind === "MISSED_CALL"
          ? "MISSED_CALL"
          : "CALL";
  const voicemail = outcome === "VOICEMAIL";
  const missed = outcome === "MISSED_CALL";
  return {
    callerName: task.call.callerName,
    createdAt: task.createdAt,
    disposition:
      task.kind === "CALLBACK"
        ? "CALLBACK_NEEDED"
        : task.kind === "FOLLOW_UP"
          ? "FOLLOW_UP_REQUIRED"
          : task.kind === "NOTE"
            ? "OTHER"
            : null,
    durationSec: voicemail ? (task.call.voicemail?.durationSec ?? null) : null,
    fromPhone:
      task.call.direction === "OUTBOUND" ? task.call.toPhone : task.call.fromPhone,
    kind: voicemail ? "voicemail" : missed ? "missed" : "note",
    locationName: task.call.number.practicePhoneNumber.location?.name ?? null,
    recordingId: voicemail ? (task.call?.voicemail?.recordingId ?? null) : null,
  };
}

export async function readCanonicalNeedsAction(
  options: {
    locationIds?: string[];
    page?: number;
    pageSize?: number;
    queueId?: string;
  },
  {
    database = prisma,
    getContext = getCurrentPortalPracticeContext,
  }: CanonicalHistoryDependencies = {},
): Promise<{
  groups: PortalNeedsActionGroup[];
  total: number;
} | null> {
  const context = await getContext();
  if (!context) return null;
  const page = Math.max(1, Math.round(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.round(options.pageSize ?? 25)));
  const callAccess = {
    ...canonicalCallAccessWhere(context, options.locationIds ?? []),
    ...(options.queueId ? { queueId: options.queueId } : {}),
  };
  const taskWhere: Prisma.CallCenterTaskWhereInput = {
    call: callAccess,
    practiceId: context.practice.id,
    status: "OPEN",
  };
  const tasks = await database.callCenterTask.findMany({
    include: {
      call: {
        include: {
          number: {
            include: { practicePhoneNumber: { include: { location: true } } },
          },
          voicemail: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    where: taskWhere,
  });
  const groups = buildPortalNeedsActionGroups(tasks.map(taskActivity));
  return {
    groups: groups.slice((page - 1) * pageSize, page * pageSize),
    total: groups.length,
  };
}

const callerCallSelect = {
  answeredAt: true,
  callerName: true,
  direction: true,
  endedAt: true,
  fromPhone: true,
  id: true,
  number: {
    select: {
      practicePhoneNumber: {
        select: { location: { select: { name: true } } },
      },
    },
  },
  providerCallSessionId: true,
  receivedAt: true,
  status: true,
  toPhone: true,
  voicemail: {
    select: {
      durationSec: true,
      id: true,
      recordingId: true,
      recordingUrl: true,
    },
  },
  winningLeg: { select: { endpoint: { select: { label: true } } } },
} satisfies Prisma.CallCenterCallSelect;

const callerTaskSelect = {
  call: { select: callerCallSelect },
  createdAt: true,
  id: true,
  kind: true,
  note: true,
  resolvedAt: true,
  status: true,
} satisfies Prisma.CallCenterTaskSelect;

type CallerCall = Prisma.CallCenterCallGetPayload<{ select: typeof callerCallSelect }>;
type CallerTask = Prisma.CallCenterTaskGetPayload<{ select: typeof callerTaskSelect }>;

function callerCallItem(call: CallerCall): PortalCallerTimelineItem {
  const outbound = call.direction === "OUTBOUND";
  const outcome = canonicalCallOutcome(call);
  const voicemail = outcome === "VOICEMAIL";
  const missed = outcome === "MISSED_CALL";
  return {
    body: null,
    direction: outbound ? "outbound" : "inbound",
    durationSec: voicemail
      ? (call.voicemail?.durationSec ?? null)
      : callDurationSec(call),
    id: `canonical-call:${call.id}`,
    kind: voicemail ? "voicemail" : missed ? "missed" : "call",
    locationName: call.number.practicePhoneNumber.location?.name ?? null,
    note: null,
    occurredAt: call.endedAt ?? call.answeredAt ?? call.receivedAt,
    phone: outbound ? call.toPhone : call.fromPhone,
    providerCallSessionId: call.providerCallSessionId,
    recordId: call.id,
    recordingId: voicemail ? (call.voicemail?.recordingId ?? null) : null,
    agentLabel: call.winningLeg?.endpoint?.label ?? null,
    status: call.status,
    title: voicemail
      ? "Voicemail"
      : missed
        ? "Missed call"
        : outbound
          ? "Outbound"
          : "Inbound",
  };
}

function callerTaskItem(task: CallerTask): PortalCallerTimelineItem {
  const activity = taskActivity(task);
  const open = task.status === "OPEN";
  const voicemail = activity.kind === "voicemail";
  const missed = activity.kind === "missed";
  const status = open
    ? task.kind === "CALLBACK"
      ? "CALLBACK_NEEDED"
      : task.kind === "FOLLOW_UP"
        ? "FOLLOW_UP_REQUIRED"
        : "NEEDS_ACTION"
    : "RESOLVED";
  return {
    body: task.note,
    direction: voicemail || missed ? "inbound" : null,
    durationSec: activity.durationSec,
    id: `canonical-task:${task.id}`,
    kind: activity.kind,
    locationName: activity.locationName,
    note: task.note ?? (open ? null : "Resolved"),
    occurredAt: activity.createdAt,
    phone: activity.fromPhone,
    recordId: task.id,
    recordingId: activity.recordingId,
    agentLabel: null,
    status,
    title: voicemail
      ? "Voicemail"
      : missed
        ? "Missed call"
        : task.kind === "CALLBACK"
          ? "Callback needed"
          : task.kind === "FOLLOW_UP"
            ? "Follow-up required"
            : "Note",
  };
}

function isOpenCallerTask(item: PortalCallerTimelineItem) {
  return (
    item.status === "CALLBACK_NEEDED" ||
    item.status === "FOLLOW_UP_REQUIRED" ||
    item.status === "NEEDS_ACTION"
  );
}

export async function readCanonicalCallerTimeline(
  phone: string,
  options: {
    locationIds?: string[];
    now?: Date;
    page?: number;
    pageSize?: number;
    range?: PortalCallCenterHistoryRange;
  } = {},
  {
    database = prisma,
    getContext = getCurrentPortalPracticeContext,
  }: CanonicalHistoryDependencies = {},
): Promise<PortalCallerTimeline | null> {
  const context = await getContext();
  if (!context) return null;
  const normalizedPhone = normalizePhone(phone) || phone.trim();
  const variants = phoneLookupVariants(normalizedPhone).filter(Boolean);
  const pageSize = Math.min(100, Math.max(25, Math.round(options.pageSize ?? 100)));
  const range = options.range ?? "all";
  const empty = {
    branding: getPracticeBranding(context.practice),
    callerName: null,
    items: [],
    latestItem: null,
    latestNeedsActionItem: null,
    page: 1,
    pageSize,
    phone: normalizedPhone,
    practiceName: context.practice.name,
    range,
    totalPages: 1,
    totals: {
      inboundItems: 0,
      outboundConnectedCalls: 0,
      outboundDialedCalls: 0,
      totalItems: 0,
    },
  } satisfies PortalCallerTimeline;
  if (!variants.length) return empty;

  const cutoff = rangeCutoff(range, options.now ?? new Date());
  const access = canonicalCallAccessWhere(context, options.locationIds ?? []);
  const phoneWhere: Prisma.CallCenterCallWhereInput = {
    OR: [{ fromPhone: { in: variants } }, { toPhone: { in: variants } }],
  };
  const callWhere: Prisma.CallCenterCallWhereInput = {
    ...access,
    ...phoneWhere,
    NOT: {
      tasks: { some: { kind: { in: ["MISSED_CALL", "VOICEMAIL"] } } },
    },
    status: { in: [...connectedHistoryStatuses] },
    ...(cutoff ? { receivedAt: { gte: cutoff } } : {}),
  };
  const taskPhoneWhere: Prisma.CallCenterTaskWhereInput = {
    call: {
      ...access,
      OR: [{ fromPhone: { in: variants } }, { toPhone: { in: variants } }],
    },
  };
  const taskWhere: Prisma.CallCenterTaskWhereInput = {
    ...taskPhoneWhere,
    practiceId: context.practice.id,
    ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
  };
  const openTaskWhere: Prisma.CallCenterTaskWhereInput = {
    ...taskPhoneWhere,
    practiceId: context.practice.id,
    status: "OPEN",
  };

  const [
    callCount,
    taskCount,
    inboundCallCount,
    inboundTaskCount,
    outboundDialed,
    outboundConnected,
  ] = await Promise.all([
    database.callCenterCall.count({ where: callWhere }),
    database.callCenterTask.count({ where: taskWhere }),
    database.callCenterCall.count({
      where: { ...callWhere, direction: "INBOUND" },
    }),
    database.callCenterTask.count({
      where: { ...taskWhere, kind: { in: ["MISSED_CALL", "VOICEMAIL"] } },
    }),
    database.callCenterCall.count({
      where: { ...callWhere, direction: "OUTBOUND" },
    }),
    database.callCenterCall.count({
      where: { ...callWhere, answeredAt: { not: null }, direction: "OUTBOUND" },
    }),
  ]);
  const totalItems = callCount + taskCount;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(1, Math.round(options.page ?? 1)), totalPages);
  const sourceTake = page * pageSize;
  const [calls, tasks, callerNameSource, currentOpenTask] = await Promise.all([
    database.callCenterCall.findMany({
      orderBy: [{ endedAt: "desc" }, { answeredAt: "desc" }, { receivedAt: "desc" }],
      select: callerCallSelect,
      take: sourceTake,
      where: callWhere,
    }),
    database.callCenterTask.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: callerTaskSelect,
      take: sourceTake,
      where: taskWhere,
    }),
    database.callCenterCall.findFirst({
      orderBy: [{ receivedAt: "desc" }],
      select: { callerName: true },
      where: { ...access, ...phoneWhere, callerName: { not: null } },
    }),
    database.callCenterTask.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: callerTaskSelect,
      where: openTaskWhere,
    }),
  ]);
  const items = [...calls.map(callerCallItem), ...tasks.map(callerTaskItem)].sort(
    (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
  );
  const pageStart = (page - 1) * pageSize;
  const currentOpenItem = currentOpenTask ? callerTaskItem(currentOpenTask) : null;

  return {
    branding: getPracticeBranding(context.practice),
    callerName:
      callerNameSource?.callerName ??
      calls.find(({ callerName }) => callerName)?.callerName ??
      tasks.find(({ call }) => call?.callerName)?.call?.callerName ??
      null,
    items: items.slice(pageStart, pageStart + pageSize),
    latestItem: items[0] ?? null,
    latestNeedsActionItem: currentOpenItem ?? items.find(isOpenCallerTask) ?? null,
    page,
    pageSize,
    phone: normalizedPhone,
    practiceName: context.practice.name,
    range,
    totalPages,
    totals: {
      inboundItems: inboundCallCount + inboundTaskCount,
      outboundConnectedCalls: outboundConnected,
      outboundDialedCalls: outboundDialed,
      totalItems,
    },
  } satisfies PortalCallerTimeline;
}
