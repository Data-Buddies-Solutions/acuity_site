import {
  getPortalCallCenterCallerTimeline,
  getPortalCallCenterHistoryData,
  type PortalCallCenterHistoryRange,
  type PortalCallCenterHistoryView,
  type PortalCallerTimelineItem,
  type PortalNeedsActionGroup,
  type PortalRecentCallItem,
} from "@/lib/call-center";
import {
  readCanonicalCallCenterHistory,
  readCanonicalCallerTimeline,
  readCanonicalNeedsAction,
} from "@/lib/call-center/application/portal-canonical-history";

type PageResult<T> = { items: T[]; total: number };

export async function collectPagePrefix<T>(
  read: (page: number, pageSize: number) => Promise<PageResult<T>>,
  limit: number,
  pageSize = 100,
) {
  if (limit <= 0) return [];
  const first = await read(1, pageSize);
  const pageCount = Math.min(
    Math.ceil(first.total / pageSize),
    Math.ceil(limit / pageSize),
  );
  if (pageCount <= 1) return first.items.slice(0, limit);
  const remaining = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) => read(index + 2, pageSize)),
  );
  return [first, ...remaining].flatMap(({ items }) => items).slice(0, limit);
}

export function mergeOrderedRecords<T>(input: {
  identity: (item: T) => string;
  items: T[];
  occurredAt: (item: T) => Date;
  prefer: (left: T, right: T) => T;
}) {
  const records = new Map<string, T>();
  for (const item of input.items) {
    const key = input.identity(item);
    const existing = records.get(key);
    records.set(key, existing ? input.prefer(existing, item) : item);
  }
  return [...records.values()].sort((left, right) => {
    const time = input.occurredAt(right).getTime() - input.occurredAt(left).getTime();
    return time || input.identity(left).localeCompare(input.identity(right));
  });
}

function historyIdentity(call: PortalRecentCallItem) {
  return call.providerCallSessionId
    ? `provider:${call.providerCallSessionId}`
    : `${call.recordSource ?? "LEGACY"}:${call.id}`;
}

function preferCanonicalHistory(left: PortalRecentCallItem, right: PortalRecentCallItem) {
  if (right.recordSource === "CANONICAL") return right;
  return left;
}

function duplicateHistoryCounts(
  legacyCalls: PortalRecentCallItem[],
  canonicalCalls: PortalRecentCallItem[],
) {
  const canonicalByProvider = new Map(
    canonicalCalls.flatMap((call) =>
      call.providerCallSessionId ? [[call.providerCallSessionId, call] as const] : [],
    ),
  );
  let inboundConnections = 0;
  let outboundAttempts = 0;
  let outboundConnections = 0;
  let total = 0;

  for (const call of legacyCalls) {
    if (!call.providerCallSessionId) continue;
    const duplicate = canonicalByProvider.get(call.providerCallSessionId);
    if (!duplicate) continue;
    total += 1;
    if (duplicate.direction === "OUTBOUND") {
      outboundAttempts += 1;
      if (call.connected && duplicate.connected) outboundConnections += 1;
    } else if (call.connected && duplicate.connected) {
      inboundConnections += 1;
    }
  }

  return { inboundConnections, outboundAttempts, outboundConnections, total };
}

type CombinedHistoryDependencies = {
  readCanonical?: typeof readCanonicalCallCenterHistory;
  readLegacy?: typeof getPortalCallCenterHistoryData;
};

export async function readCombinedCallCenterHistory(
  options: {
    page: number;
    pageSize: number;
    range: PortalCallCenterHistoryRange;
    view: PortalCallCenterHistoryView;
  },
  {
    readCanonical = readCanonicalCallCenterHistory,
    readLegacy = getPortalCallCenterHistoryData,
  }: CombinedHistoryDependencies = {},
) {
  const [legacyFirst, canonicalFirst] = await Promise.all([
    readLegacy({ page: 1, pageSize: 100, range: options.range, view: options.view }),
    readCanonical({ page: 1, pageSize: 100, range: options.range, view: options.view }),
  ]);
  const base = legacyFirst ?? canonicalFirst;
  if (!base) return null;
  const prefixSize = options.page * options.pageSize;
  const [legacyCalls, canonicalCalls] = await Promise.all([
    collectPagePrefix(async (page, pageSize) => {
      const result =
        page === 1
          ? legacyFirst
          : await readLegacy({
              page,
              pageSize,
              range: options.range,
              view: options.view,
            });
      return { items: result?.calls ?? [], total: result?.totals.totalCalls ?? 0 };
    }, prefixSize),
    collectPagePrefix(async (page, pageSize) => {
      const result =
        page === 1
          ? canonicalFirst
          : await readCanonical({
              page,
              pageSize,
              range: options.range,
              view: options.view,
            });
      return { items: result?.calls ?? [], total: result?.totals.totalCalls ?? 0 };
    }, prefixSize),
  ]);
  const calls = mergeOrderedRecords({
    identity: historyIdentity,
    items: [...legacyCalls, ...canonicalCalls],
    occurredAt: (call) => call.occurredAt,
    prefer: preferCanonicalHistory,
  });
  const start = (options.page - 1) * options.pageSize;
  const duplicates = duplicateHistoryCounts(legacyCalls, canonicalCalls);
  const legacyTotals = legacyFirst?.totals ?? {
    inboundCalls: 0,
    outboundCalls: 0,
    outboundDialedCalls: 0,
    totalCalls: 0,
  };
  const canonicalTotals = canonicalFirst?.totals ?? {
    inboundCalls: 0,
    outboundCalls: 0,
    outboundDialedCalls: 0,
    totalCalls: 0,
  };
  return {
    ...base,
    calls: calls.slice(start, start + options.pageSize),
    page: options.page,
    pageSize: options.pageSize,
    totals: {
      inboundCalls: Math.max(
        0,
        legacyTotals.inboundCalls +
          canonicalTotals.inboundCalls -
          duplicates.inboundConnections,
      ),
      outboundCalls: Math.max(
        0,
        legacyTotals.outboundCalls +
          canonicalTotals.outboundCalls -
          duplicates.outboundConnections,
      ),
      outboundDialedCalls: Math.max(
        0,
        legacyTotals.outboundDialedCalls +
          canonicalTotals.outboundDialedCalls -
          duplicates.outboundAttempts,
      ),
      totalCalls: Math.max(
        calls.length,
        legacyTotals.totalCalls + canonicalTotals.totalCalls - duplicates.total,
      ),
    },
  };
}

function mergeNeedsActionGroup(
  left: PortalNeedsActionGroup,
  right: PortalNeedsActionGroup,
) {
  const latest = right.lastActivityAt > left.lastActivityAt ? right : left;
  return {
    ...latest,
    callbackNeededCount: left.callbackNeededCount + right.callbackNeededCount,
    eventCount: left.eventCount + right.eventCount,
    followUpRequiredCount: left.followUpRequiredCount + right.followUpRequiredCount,
    locationNames: [...new Set([...left.locationNames, ...right.locationNames])],
    missedCount: left.missedCount + right.missedCount,
    noteCount: left.noteCount + right.noteCount,
    recordIds: [...new Set([...(left.recordIds ?? []), ...(right.recordIds ?? [])])],
    voicemailCount: left.voicemailCount + right.voicemailCount,
  };
}

export function mergeNeedsActionGroups(groups: PortalNeedsActionGroup[]) {
  const merged = new Map<string, PortalNeedsActionGroup>();
  for (const group of groups) {
    const existing = merged.get(group.id);
    merged.set(group.id, existing ? mergeNeedsActionGroup(existing, group) : group);
  }
  return [...merged.values()].sort(
    (left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime(),
  );
}

type CombinedNeedsActionDependencies = {
  readCanonical?: typeof readCanonicalNeedsAction;
  readLegacy?: (
    page: number,
    pageSize: number,
  ) => Promise<PageResult<PortalNeedsActionGroup>>;
};

export async function readCombinedNeedsAction(
  options: {
    legacyGroups: PortalNeedsActionGroup[];
    legacyGroupIds?: string[];
    legacyTotal?: number;
    locationIds: string[];
    page: number;
    pageSize: number;
  },
  {
    readCanonical = readCanonicalNeedsAction,
    readLegacy,
  }: CombinedNeedsActionDependencies = {},
) {
  const prefixSize = options.page * options.pageSize;
  const legacyFirst = {
    items: options.legacyGroups,
    total: options.legacyTotal ?? options.legacyGroups.length,
  };
  const canonicalFirst = await readCanonical({
    locationIds: options.locationIds,
    page: 1,
    pageSize: 100,
  });
  const [legacy, canonical] = await Promise.all([
    collectPagePrefix(
      (page, pageSize) =>
        page === 1
          ? Promise.resolve(legacyFirst)
          : (readLegacy?.(page, pageSize) ??
            Promise.resolve({ items: [], total: legacyFirst.total })),
      prefixSize,
    ),
    collectPagePrefix(async (page, pageSize) => {
      const result =
        page === 1
          ? canonicalFirst
          : await readCanonical({
              locationIds: options.locationIds,
              page,
              pageSize,
            });
      return { items: result?.groups ?? [], total: result?.total ?? 0 };
    }, prefixSize),
  ]);
  const groups = mergeNeedsActionGroups([...legacy, ...canonical]);
  const canonicalIds = new Set(canonical.map(({ id }) => id));
  const duplicateCount = legacy.filter(({ id }) => canonicalIds.has(id)).length;
  const exactTotal =
    options.legacyGroupIds && canonicalFirst?.groupIds
      ? new Set([...options.legacyGroupIds, ...canonicalFirst.groupIds]).size
      : null;
  const start = (options.page - 1) * options.pageSize;
  return {
    groups: groups.slice(start, start + options.pageSize),
    total:
      exactTotal ??
      Math.max(
        groups.length,
        legacyFirst.total + (canonicalFirst?.total ?? 0) - duplicateCount,
      ),
  };
}

function callerIdentity(item: PortalCallerTimelineItem) {
  return item.providerCallSessionId
    ? `provider:${item.providerCallSessionId}`
    : `${item.recordSource ?? "LEGACY"}:${item.id}`;
}

function preferCanonicalCaller(
  left: PortalCallerTimelineItem,
  right: PortalCallerTimelineItem,
) {
  return right.recordSource === "CANONICAL" ? right : left;
}

export async function readCombinedCallerTimeline(
  phone: string,
  options: {
    locationId?: string;
    locationIds: string[];
    page: number;
    pageSize: number;
    range: PortalCallCenterHistoryRange;
  },
  {
    readCanonical = readCanonicalCallerTimeline,
    readLegacy = getPortalCallCenterCallerTimeline,
  }: {
    readCanonical?: typeof readCanonicalCallerTimeline;
    readLegacy?: typeof getPortalCallCenterCallerTimeline;
  } = {},
) {
  const [legacyFirst, canonicalFirst] = await Promise.all([
    readLegacy(phone, {
      excludeCanonicalLinkedActivity: true,
      locationId: options.locationId,
      page: 1,
      pageSize: 100,
      range: options.range,
    }),
    readCanonical(phone, {
      locationIds: options.locationIds,
      page: 1,
      pageSize: 100,
      range: options.range,
    }),
  ]);
  const base = legacyFirst ?? canonicalFirst;
  if (!base) return null;
  const prefixSize = options.page * options.pageSize;
  const [legacyItems, canonicalItems] = await Promise.all([
    collectPagePrefix(async (page, pageSize) => {
      const result =
        page === 1
          ? legacyFirst
          : await readLegacy(phone, {
              excludeCanonicalLinkedActivity: true,
              locationId: options.locationId,
              page,
              pageSize,
              range: options.range,
            });
      return { items: result?.items ?? [], total: result?.totals.totalItems ?? 0 };
    }, prefixSize),
    collectPagePrefix(async (page, pageSize) => {
      const result =
        page === 1
          ? canonicalFirst
          : await readCanonical(phone, {
              locationIds: options.locationIds,
              page,
              pageSize,
              range: options.range,
            });
      return { items: result?.items ?? [], total: result?.totals.totalItems ?? 0 };
    }, prefixSize),
  ]);
  const items = mergeOrderedRecords({
    identity: callerIdentity,
    items: [...legacyItems, ...canonicalItems],
    occurredAt: (item) => item.occurredAt,
    prefer: preferCanonicalCaller,
  });
  const start = (options.page - 1) * options.pageSize;
  const latestNeedsActionItem = [
    legacyFirst?.latestNeedsActionItem,
    canonicalFirst?.latestNeedsActionItem,
  ]
    .filter((item): item is PortalCallerTimelineItem => Boolean(item))
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())[0];
  const canonicalProviderIds = new Set(
    canonicalItems.flatMap((item) =>
      item.providerCallSessionId ? [item.providerCallSessionId] : [],
    ),
  );
  const duplicateItems = legacyItems.filter(
    (item) =>
      item.providerCallSessionId && canonicalProviderIds.has(item.providerCallSessionId),
  );
  const duplicateInbound = duplicateItems.filter(
    ({ direction }) => direction === "inbound",
  ).length;
  const duplicateOutboundDialed = duplicateItems.filter(
    ({ direction, kind }) => direction === "outbound" && kind === "call",
  ).length;
  const duplicateOutboundConnected = duplicateItems.filter(
    ({ direction, kind, status }) =>
      direction === "outbound" &&
      kind === "call" &&
      ["COMPLETED", "CONNECTED", "WRAP_UP"].includes(status ?? ""),
  ).length;
  const legacyTotals = legacyFirst?.totals ?? {
    inboundItems: 0,
    outboundConnectedCalls: 0,
    outboundDialedCalls: 0,
    totalItems: 0,
  };
  const canonicalTotals = canonicalFirst?.totals ?? {
    inboundItems: 0,
    outboundConnectedCalls: 0,
    outboundDialedCalls: 0,
    totalItems: 0,
  };
  const totalItems = Math.max(
    items.length,
    legacyTotals.totalItems + canonicalTotals.totalItems - duplicateItems.length,
  );

  return {
    ...base,
    callerName: canonicalFirst?.callerName ?? legacyFirst?.callerName ?? null,
    items: items.slice(start, start + options.pageSize),
    latestItem: items[0] ?? null,
    latestNeedsActionItem: latestNeedsActionItem ?? null,
    page: options.page,
    pageSize: options.pageSize,
    totalPages: Math.max(1, Math.ceil(totalItems / options.pageSize)),
    totals: {
      inboundItems: Math.max(
        0,
        legacyTotals.inboundItems + canonicalTotals.inboundItems - duplicateInbound,
      ),
      outboundConnectedCalls: Math.max(
        0,
        legacyTotals.outboundConnectedCalls +
          canonicalTotals.outboundConnectedCalls -
          duplicateOutboundConnected,
      ),
      outboundDialedCalls: Math.max(
        0,
        legacyTotals.outboundDialedCalls +
          canonicalTotals.outboundDialedCalls -
          duplicateOutboundDialed,
      ),
      totalItems,
    },
  };
}
