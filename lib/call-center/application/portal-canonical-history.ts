import { type CallCenterCallStatus, Prisma } from "@/generated/prisma/client";
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
  type PortalNeedsActionPreviewItem,
  type PortalRecentCallItem,
} from "@/lib/call-center/portal-model";
import {
  resolveQueueAccess,
  type QueueAccessActor,
} from "@/lib/call-center/auth/queue-access";
import { canonicalCallOutcome } from "@/lib/call-center/domain/canonical-call-outcome";
import { normalizeCanonicalCallStatus } from "@/lib/call-center/domain/canonical-call-state";
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
type CanonicalHistoryDatabase = Pick<
  typeof prisma,
  "$queryRaw" | "callCenterCall" | "callCenterTask"
>;
type CanonicalNeedsActionPreviewDatabase = Pick<
  typeof prisma,
  "$queryRaw" | "callCenterQueue" | "callCenterTask"
>;
type CanonicalHistoryDependencies = {
  database?: CanonicalHistoryDatabase;
  getContext?: typeof getCurrentPortalPracticeContext;
  listNeedsActionThreadPage?: typeof listCanonicalNeedsActionThreadPage;
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

const connectedHistoryStatuses = ["CONNECTED", "COMPLETED"] as const;

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
  switch (normalizeCanonicalCallStatus(call.status)) {
    case "RECEIVED":
    case "QUEUED":
    case "RINGING":
      return "RINGING" as const;
    case "CONNECTED":
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

const needsActionTaskSelect = {
  call: {
    select: {
      answeredAt: true,
      callerName: true,
      direction: true,
      fromPhone: true,
      number: {
        select: {
          practicePhoneNumber: {
            select: {
              location: { select: { id: true, name: true } },
            },
          },
        },
      },
      queueId: true,
      status: true,
      toPhone: true,
      voicemail: {
        select: {
          durationSec: true,
          recordingId: true,
          recordingUrl: true,
        },
      },
    },
  },
  createdAt: true,
  id: true,
  kind: true,
  note: true,
} satisfies Prisma.CallCenterTaskSelect;

type NeedsActionTask = Prisma.CallCenterTaskGetPayload<{
  select: typeof needsActionTaskSelect;
}>;

function taskActivity(task: NeedsActionTask): PortalCallActivityItem {
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
    locationId: task.call.number.practicePhoneNumber.location?.id ?? null,
    locationName: task.call.number.practicePhoneNumber.location?.name ?? null,
    queueId: task.call.queueId,
    recordingId: voicemail ? (task.call?.voicemail?.recordingId ?? null) : null,
    taskId: task.id,
  };
}

export const CANONICAL_NEEDS_ACTION_PREVIEW_LIMIT = 15;

export async function readCanonicalNeedsActionPreview(
  actor: QueueAccessActor,
  options: {
    locationIds?: string[];
    queueId: string;
  },
  database: CanonicalNeedsActionPreviewDatabase = prisma,
  listNeedsActionThreadPage: typeof listCanonicalNeedsActionThreadPage = listCanonicalNeedsActionThreadPage,
): Promise<PortalNeedsActionPreviewItem[]> {
  await resolveQueueAccess(actor, options.queueId, database);
  const context = {
    allowedLocationIds: actor.allowedLocationIds,
    hasAllLocationAccess: actor.hasAllLocationAccess,
    practice: { id: actor.practiceId },
  };
  const callAccess = {
    ...canonicalCallAccessWhere(context, options.locationIds ?? []),
    queueId: options.queueId,
  };
  const threadPage = await listNeedsActionThreadPage(
    context,
    {
      locationIds: options.locationIds ?? [],
      page: 1,
      pageSize: CANONICAL_NEEDS_ACTION_PREVIEW_LIMIT,
      queueId: options.queueId,
    },
    database,
  );
  if (!threadPage.threads.length) return [];
  const tasks = await database.callCenterTask.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: needsActionTaskSelect,
    where: {
      call: needsActionThreadCallWhere(callAccess, threadPage.threads),
      practiceId: actor.practiceId,
      status: "OPEN",
    },
  });
  const activities = tasks.map(taskActivity);
  return orderNeedsActionGroups(
    buildPortalNeedsActionGroups(activities),
    threadPage.threads,
  ).map((group) => ({
    ...group,
    activities: activities.filter(
      (activity) =>
        portalNeedsActionGroupId(
          activity.fromPhone,
          activity.queueId,
          activity.locationId,
        ) === group.id,
    ),
  }));
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
    listNeedsActionThreadPage = listCanonicalNeedsActionThreadPage,
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
  const threadPage = await listNeedsActionThreadPage(
    context,
    {
      locationIds: options.locationIds ?? [],
      page,
      pageSize,
      queueId: options.queueId,
    },
    database,
  );
  if (!threadPage.threads.length) {
    return { groups: [], total: threadPage.total };
  }
  const tasks = await database.callCenterTask.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: needsActionTaskSelect,
    where: {
      ...taskWhere,
      call: needsActionThreadCallWhere(callAccess, threadPage.threads),
    },
  });
  const groups = orderNeedsActionGroups(
    buildPortalNeedsActionGroups(tasks.map(taskActivity)),
    threadPage.threads,
  );
  return {
    groups,
    total: threadPage.total,
  };
}

type NeedsActionThreadKey = {
  locationId: string | null;
  phone: string;
  queueId: string | null;
  rawPhones?: string[];
};

type NeedsActionThreadPage = {
  threads: NeedsActionThreadKey[];
  total: number;
};

function orderNeedsActionGroups(
  groups: PortalNeedsActionGroup[],
  threads: NeedsActionThreadKey[],
) {
  const positions = new Map(
    threads.map((thread, index) => [
      portalNeedsActionGroupId(thread.phone, thread.queueId, thread.locationId),
      index,
    ]),
  );
  return [...groups].sort(
    (left, right) =>
      (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

function needsActionThreadCallWhere(
  callAccess: Prisma.CallCenterCallWhereInput,
  threads: NeedsActionThreadKey[],
): Prisma.CallCenterCallWhereInput {
  return {
    AND: [
      callAccess,
      {
        OR: threads.map((thread) => {
          const phones = [
            ...new Set([
              thread.phone,
              ...(thread.rawPhones ?? []),
              ...phoneLookupVariants(thread.phone),
            ]),
          ];
          return {
            number: {
              practicePhoneNumber: { locationId: thread.locationId },
            },
            OR: [
              { direction: "INBOUND", fromPhone: { in: phones } },
              { direction: "OUTBOUND", toPhone: { in: phones } },
            ],
            queueId: thread.queueId,
          };
        }),
      },
    ],
  };
}

export async function listCanonicalNeedsActionThreadPage(
  context: CallAccessContext,
  options: {
    locationIds: string[];
    page: number;
    pageSize: number;
    queueId?: string;
  },
  database: Pick<typeof prisma, "$queryRaw"> = prisma,
): Promise<NeedsActionThreadPage> {
  const locationIds = accessibleLocationIds(context, options.locationIds);
  if (locationIds !== null && locationIds.length === 0) {
    return { threads: [], total: 0 };
  }
  const queueFilter = options.queueId
    ? Prisma.sql`AND c."queueId" = ${options.queueId}`
    : Prisma.empty;
  const locationFilter =
    locationIds === null
      ? Prisma.empty
      : Prisma.sql`AND pn."locationId" IN (${Prisma.join(locationIds)})`;
  const offset = (options.page - 1) * options.pageSize;
  const rows = await database.$queryRaw<
    Array<{ threads: NeedsActionThreadKey[]; total: number }>
  >(
    Prisma.sql`
      WITH raw_scoped AS (
        SELECT
          CASE WHEN c."direction" = 'OUTBOUND'
            THEN c."toPhone"
            ELSE c."fromPhone"
          END AS raw_phone,
          c."queueId" AS queue_id,
          pn."locationId" AS location_id,
          t."createdAt" AS created_at
        FROM "call_center_task" t
        JOIN "call_center_call" c ON c."id" = t."callId"
        JOIN "call_center_number" n ON n."id" = c."numberId"
        JOIN "practice_phone_number" pn ON pn."id" = n."practicePhoneNumberId"
        WHERE t."practiceId" = ${context.practice.id}
          AND c."practiceId" = ${context.practice.id}
          AND t."status" = 'OPEN'
          ${queueFilter}
          ${locationFilter}
      ),
      scoped AS (
        SELECT
          CASE
            WHEN REGEXP_REPLACE(raw_phone, '[^0-9]', '', 'g') = ''
              THEN BTRIM(raw_phone)
            WHEN LENGTH(REGEXP_REPLACE(raw_phone, '[^0-9]', '', 'g')) = 10
              THEN '+1' || REGEXP_REPLACE(raw_phone, '[^0-9]', '', 'g')
            WHEN LENGTH(REGEXP_REPLACE(raw_phone, '[^0-9]', '', 'g')) = 11
              AND LEFT(REGEXP_REPLACE(raw_phone, '[^0-9]', '', 'g'), 1) = '1'
              THEN '+' || REGEXP_REPLACE(raw_phone, '[^0-9]', '', 'g')
            WHEN LEFT(BTRIM(raw_phone), 1) = '+'
              THEN BTRIM(raw_phone)
            ELSE '+' || REGEXP_REPLACE(raw_phone, '[^0-9]', '', 'g')
          END AS phone,
          raw_phone,
          queue_id,
          location_id,
          created_at
        FROM raw_scoped
      ),
      threads AS (
        SELECT
          phone,
          queue_id,
          location_id,
          ARRAY_AGG(DISTINCT raw_phone) AS raw_phones,
          MAX(created_at) AS last_activity_at
        FROM scoped
        GROUP BY phone, queue_id, location_id
      ),
      page AS (
        SELECT phone, queue_id, location_id, raw_phones, last_activity_at
        FROM threads
        ORDER BY last_activity_at DESC, phone ASC, queue_id ASC, location_id ASC
        LIMIT ${options.pageSize}
        OFFSET ${offset}
      )
      SELECT
        COALESCE(
          (
            SELECT JSONB_AGG(
              JSONB_BUILD_OBJECT(
                'phone', phone,
                'queueId', queue_id,
                'locationId', location_id,
                'rawPhones', raw_phones
              )
              ORDER BY last_activity_at DESC, phone ASC, queue_id ASC, location_id ASC
            )
            FROM page
          ),
          '[]'::jsonb
        ) AS threads,
        (SELECT COUNT(*)::int FROM threads) AS total
    `,
  );
  return rows[0] ?? { threads: [], total: 0 };
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
        select: { location: { select: { id: true, name: true } } },
      },
    },
  },
  providerCallSessionId: true,
  queueId: true,
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

type CallerTimelineCounts = PortalCallerTimeline["totals"];
type CallerTimelinePageKey = {
  id: string;
  recordType: "call" | "task";
};
type CallerOpenCycle = {
  openCycleToken: string;
  openTaskCount: number;
};

export async function readCanonicalCallerOpenCycle(
  context: CallAccessContext,
  options: {
    locationIds: string[];
    phoneVariants: string[];
  },
  database: Pick<typeof prisma, "$queryRaw"> = prisma,
): Promise<CallerOpenCycle> {
  const locationIds = accessibleLocationIds(context, options.locationIds);
  if (
    !options.phoneVariants.length ||
    (locationIds !== null && locationIds.length === 0)
  ) {
    return { openCycleToken: "v1:0:d41d8cd98f00b204e9800998ecf8427e", openTaskCount: 0 };
  }
  const locationFilter =
    locationIds === null
      ? Prisma.empty
      : Prisma.sql`AND pn."locationId" IN (${Prisma.join(locationIds)})`;
  const rows = await database.$queryRaw<CallerOpenCycle[]>(
    Prisma.sql`
      SELECT
        (
          'v1:' ||
          COUNT(*)::text ||
          ':' ||
          MD5(
            COALESCE(
              STRING_AGG(LENGTH(t."id")::text || ':' || t."id", '' ORDER BY t."id"),
              ''
            )
          )
        ) AS "openCycleToken",
        COUNT(*)::int AS "openTaskCount"
      FROM "call_center_task" t
      JOIN "call_center_call" c ON c."id" = t."callId"
      JOIN "call_center_number" n ON n."id" = c."numberId"
      JOIN "practice_phone_number" pn ON pn."id" = n."practicePhoneNumberId"
      WHERE t."practiceId" = ${context.practice.id}
        AND c."practiceId" = ${context.practice.id}
        AND t."status" = 'OPEN'
        AND (c."fromPhone" IN (${Prisma.join(options.phoneVariants)})
          OR c."toPhone" IN (${Prisma.join(options.phoneVariants)}))
        ${locationFilter}
    `,
  );
  return (
    rows[0] ?? {
      openCycleToken: "v1:0:d41d8cd98f00b204e9800998ecf8427e",
      openTaskCount: 0,
    }
  );
}

export async function readCanonicalCallerTimelineCounts(
  context: CallAccessContext,
  options: {
    cutoff: Date | null;
    locationIds: string[];
    phoneVariants: string[];
  },
  database: Pick<typeof prisma, "$queryRaw"> = prisma,
): Promise<CallerTimelineCounts> {
  const locationIds = accessibleLocationIds(context, options.locationIds);
  if (
    !options.phoneVariants.length ||
    (locationIds !== null && locationIds.length === 0)
  ) {
    return {
      inboundItems: 0,
      outboundConnectedCalls: 0,
      outboundDialedCalls: 0,
      totalItems: 0,
    };
  }
  const locationFilter =
    locationIds === null
      ? Prisma.empty
      : Prisma.sql`AND pn."locationId" IN (${Prisma.join(locationIds)})`;
  const callCutoff = options.cutoff
    ? Prisma.sql`AND c."receivedAt" >= ${options.cutoff}`
    : Prisma.empty;
  const taskCutoff = options.cutoff
    ? Prisma.sql`AND t."createdAt" >= ${options.cutoff}`
    : Prisma.empty;
  const rows = await database.$queryRaw<Array<CallerTimelineCounts>>(
    Prisma.sql`
      WITH scoped_calls AS (
        SELECT c."direction", c."answeredAt"
        FROM "call_center_call" c
        JOIN "call_center_number" n ON n."id" = c."numberId"
        JOIN "practice_phone_number" pn ON pn."id" = n."practicePhoneNumberId"
        WHERE c."practiceId" = ${context.practice.id}
          AND (c."fromPhone" IN (${Prisma.join(options.phoneVariants)})
            OR c."toPhone" IN (${Prisma.join(options.phoneVariants)}))
          AND c."status" IN ('CONNECTED', 'COMPLETED')
          AND NOT EXISTS (
            SELECT 1
            FROM "call_center_task" excluded_task
            WHERE excluded_task."callId" = c."id"
              AND excluded_task."kind" IN ('MISSED_CALL', 'VOICEMAIL')
          )
          ${locationFilter}
          ${callCutoff}
      ),
      scoped_tasks AS (
        SELECT t."kind"
        FROM "call_center_task" t
        JOIN "call_center_call" c ON c."id" = t."callId"
        JOIN "call_center_number" n ON n."id" = c."numberId"
        JOIN "practice_phone_number" pn ON pn."id" = n."practicePhoneNumberId"
        WHERE t."practiceId" = ${context.practice.id}
          AND c."practiceId" = ${context.practice.id}
          AND (c."fromPhone" IN (${Prisma.join(options.phoneVariants)})
            OR c."toPhone" IN (${Prisma.join(options.phoneVariants)}))
          ${locationFilter}
          ${taskCutoff}
      )
      SELECT
        (
          (SELECT COUNT(*) FROM scoped_calls WHERE "direction" = 'INBOUND') +
          (SELECT COUNT(*) FROM scoped_tasks WHERE "kind" IN ('MISSED_CALL', 'VOICEMAIL'))
        )::int AS "inboundItems",
        (
          SELECT COUNT(*)
          FROM scoped_calls
          WHERE "direction" = 'OUTBOUND' AND "answeredAt" IS NOT NULL
        )::int AS "outboundConnectedCalls",
        (
          SELECT COUNT(*) FROM scoped_calls WHERE "direction" = 'OUTBOUND'
        )::int AS "outboundDialedCalls",
        (
          (SELECT COUNT(*) FROM scoped_calls) +
          (SELECT COUNT(*) FROM scoped_tasks)
        )::int AS "totalItems"
    `,
  );
  return (
    rows[0] ?? {
      inboundItems: 0,
      outboundConnectedCalls: 0,
      outboundDialedCalls: 0,
      totalItems: 0,
    }
  );
}

export async function readCanonicalCallerTimelinePage(
  context: CallAccessContext,
  options: {
    cutoff: Date | null;
    locationIds: string[];
    page: number;
    pageSize: number;
    phoneVariants: string[];
  },
  database: Pick<typeof prisma, "$queryRaw"> = prisma,
): Promise<{ items: CallerTimelinePageKey[]; latest: CallerTimelinePageKey | null }> {
  const locationIds = accessibleLocationIds(context, options.locationIds);
  if (
    !options.phoneVariants.length ||
    (locationIds !== null && locationIds.length === 0)
  ) {
    return { items: [], latest: null };
  }
  const locationFilter =
    locationIds === null
      ? Prisma.empty
      : Prisma.sql`AND pn."locationId" IN (${Prisma.join(locationIds)})`;
  const callCutoff = options.cutoff
    ? Prisma.sql`AND c."receivedAt" >= ${options.cutoff}`
    : Prisma.empty;
  const taskCutoff = options.cutoff
    ? Prisma.sql`AND t."createdAt" >= ${options.cutoff}`
    : Prisma.empty;
  const offset = (options.page - 1) * options.pageSize;
  const rows = await database.$queryRaw<
    Array<{ items: CallerTimelinePageKey[]; latest: CallerTimelinePageKey | null }>
  >(
    Prisma.sql`
      WITH scoped_calls AS (
        SELECT
          c."id",
          COALESCE(c."endedAt", c."answeredAt", c."receivedAt") AS occurred_at
        FROM "call_center_call" c
        JOIN "call_center_number" n ON n."id" = c."numberId"
        JOIN "practice_phone_number" pn ON pn."id" = n."practicePhoneNumberId"
        WHERE c."practiceId" = ${context.practice.id}
          AND (c."fromPhone" IN (${Prisma.join(options.phoneVariants)})
            OR c."toPhone" IN (${Prisma.join(options.phoneVariants)}))
          AND c."status" IN ('CONNECTED', 'COMPLETED')
          AND NOT EXISTS (
            SELECT 1
            FROM "call_center_task" excluded_task
            WHERE excluded_task."callId" = c."id"
              AND excluded_task."kind" IN ('MISSED_CALL', 'VOICEMAIL')
          )
          ${locationFilter}
          ${callCutoff}
      ),
      scoped_tasks AS (
        SELECT t."id", t."createdAt" AS occurred_at
        FROM "call_center_task" t
        JOIN "call_center_call" c ON c."id" = t."callId"
        JOIN "call_center_number" n ON n."id" = c."numberId"
        JOIN "practice_phone_number" pn ON pn."id" = n."practicePhoneNumberId"
        WHERE t."practiceId" = ${context.practice.id}
          AND c."practiceId" = ${context.practice.id}
          AND (c."fromPhone" IN (${Prisma.join(options.phoneVariants)})
            OR c."toPhone" IN (${Prisma.join(options.phoneVariants)}))
          ${locationFilter}
          ${taskCutoff}
      ),
      timeline AS (
        SELECT 'call'::text AS record_type, "id", occurred_at FROM scoped_calls
        UNION ALL
        SELECT 'task'::text AS record_type, "id", occurred_at FROM scoped_tasks
      ),
      page AS (
        SELECT record_type, "id", occurred_at
        FROM timeline
        ORDER BY occurred_at DESC, "id" ASC, record_type ASC
        LIMIT ${options.pageSize}
        OFFSET ${offset}
      )
      SELECT
        COALESCE(
          JSONB_AGG(
            JSONB_BUILD_OBJECT('recordType', record_type, 'id', "id")
            ORDER BY occurred_at DESC, "id" ASC, record_type ASC
          ),
          '[]'::jsonb
        ) AS items,
        (
          SELECT JSONB_BUILD_OBJECT('recordType', record_type, 'id', "id")
          FROM timeline
          ORDER BY occurred_at DESC, "id" ASC, record_type ASC
          LIMIT 1
        ) AS latest
      FROM page
    `,
  );
  return rows[0] ?? { items: [], latest: null };
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
    latestCall: null,
    latestItem: null,
    latestNeedsActionItem: null,
    openCycleToken: "v1:0:d41d8cd98f00b204e9800998ecf8427e",
    openTaskCount: 0,
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

  const totals = await readCanonicalCallerTimelineCounts(
    context,
    {
      cutoff,
      locationIds: options.locationIds ?? [],
      phoneVariants: variants,
    },
    database,
  );
  const totalItems = totals.totalItems;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(1, Math.round(options.page ?? 1)), totalPages);
  const timelinePage = await readCanonicalCallerTimelinePage(
    context,
    {
      cutoff,
      locationIds: options.locationIds ?? [],
      page,
      pageSize,
      phoneVariants: variants,
    },
    database,
  );
  const selectedCallIds = [
    ...new Set(
      [...timelinePage.items, timelinePage.latest]
        .filter(
          (item): item is CallerTimelinePageKey =>
            Boolean(item) && item?.recordType === "call",
        )
        .map(({ id }) => id),
    ),
  ];
  const selectedTaskIds = [
    ...new Set(
      [...timelinePage.items, timelinePage.latest]
        .filter(
          (item): item is CallerTimelinePageKey =>
            Boolean(item) && item?.recordType === "task",
        )
        .map(({ id }) => id),
    ),
  ];
  const [calls, tasks, callerNameSource, currentOpenTask, latestCall, openCycle] =
    await Promise.all([
      database.callCenterCall.findMany({
        select: callerCallSelect,
        where: { ...callWhere, id: { in: selectedCallIds } },
      }),
      database.callCenterTask.findMany({
        select: callerTaskSelect,
        where: { ...taskWhere, id: { in: selectedTaskIds } },
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
      database.callCenterCall.findFirst({
        orderBy: [{ receivedAt: "desc" }],
        select: { id: true, stateVersion: true },
        where: { ...access, ...phoneWhere },
      }),
      readCanonicalCallerOpenCycle(
        context,
        {
          locationIds: options.locationIds ?? [],
          phoneVariants: variants,
        },
        database,
      ),
    ]);
  const itemByKey = new Map([
    ...calls.map(callerCallItem).map((item) => [`call:${item.recordId}`, item] as const),
    ...tasks.map(callerTaskItem).map((item) => [`task:${item.recordId}`, item] as const),
  ]);
  const items = timelinePage.items.flatMap((key) => {
    const item = itemByKey.get(`${key.recordType}:${key.id}`);
    return item ? [item] : [];
  });
  const latestItem = timelinePage.latest
    ? (itemByKey.get(`${timelinePage.latest.recordType}:${timelinePage.latest.id}`) ??
      null)
    : null;
  const currentOpenItem = currentOpenTask ? callerTaskItem(currentOpenTask) : null;

  return {
    branding: getPracticeBranding(context.practice),
    callerName:
      callerNameSource?.callerName ??
      calls.find(({ callerName }) => callerName)?.callerName ??
      tasks.find(({ call }) => call?.callerName)?.call?.callerName ??
      null,
    items,
    latestCall,
    latestItem,
    latestNeedsActionItem: currentOpenItem ?? items.find(isOpenCallerTask) ?? null,
    openCycleToken: openCycle.openCycleToken,
    openTaskCount: openCycle.openTaskCount,
    page,
    pageSize,
    phone: normalizedPhone,
    practiceName: context.practice.name,
    range,
    totalPages,
    totals,
  } satisfies PortalCallerTimeline;
}
