import { describe, expect, it } from "bun:test";

import {
  collectPagePrefix,
  mergeNeedsActionGroups,
  readCombinedCallCenterHistory,
  readCombinedCallerTimeline,
  readCombinedNeedsAction,
} from "../portal-combined-call-center-reads";

function call(
  id: string,
  occurredAt: string,
  source: "CANONICAL" | "LEGACY",
  providerCallSessionId: string | null = null,
) {
  return {
    answeredBy: null,
    connected: true,
    direction: "INBOUND" as const,
    durationSec: 30,
    fromPhone: "+15555550123",
    id,
    locationName: "Optical",
    occurredAt: new Date(occurredAt),
    providerCallSessionId,
    recordSource: source,
    startedAt: new Date(occurredAt),
    status: "COMPLETED" as const,
    toPhone: "+15555550000",
  };
}

function historyResult(calls: ReturnType<typeof call>[], total = calls.length) {
  return {
    branding: {
      accentColor: null,
      logoAlt: null,
      logoUrl: null,
      markUrl: null,
      primaryColor: null,
    },
    calls,
    page: 1,
    pageSize: 100,
    practiceName: "Acuity",
    range: "all" as const,
    totals: {
      inboundCalls: total,
      outboundCalls: 0,
      outboundDialedCalls: 0,
      totalCalls: total,
    },
  };
}

function group(id: string, occurredAt: string, recordId: string) {
  return {
    callbackNeededCount: 0,
    callerName: null,
    eventCount: 1,
    followUpRequiredCount: 0,
    fromPhone: id.replace("needs-action:", ""),
    id,
    lastActivityAt: new Date(occurredAt),
    latestKind: "missed" as const,
    latestVoicemailDurationSec: null,
    latestVoicemailRecordingId: null,
    locationNames: ["Optical"],
    missedCount: 1,
    noteCount: 0,
    recordIds: [recordId],
    voicemailCount: 0,
  };
}

function callerItem(
  id: string,
  occurredAt: string,
  source: "CANONICAL" | "LEGACY",
  providerCallSessionId: string | null = null,
) {
  return {
    body: null,
    direction: "inbound" as const,
    durationSec: 30,
    id,
    kind: "call" as const,
    locationName: "Optical",
    note: null,
    occurredAt: new Date(occurredAt),
    phone: "+15555550123",
    providerCallSessionId,
    recordId: id,
    recordingId: null,
    recordSource: source,
    stationLabel: null,
    status: "COMPLETED",
    title: "Inbound",
  };
}

function callerResult(items: ReturnType<typeof callerItem>[], total = items.length) {
  return {
    branding: {
      accentColor: null,
      logoAlt: null,
      logoUrl: null,
      markUrl: null,
      primaryColor: null,
    },
    callerName: "Patient",
    items,
    latestItem: items[0] ?? null,
    latestNeedsActionItem: null,
    page: 1,
    pageSize: 100,
    phone: "+15555550123",
    practiceName: "Acuity",
    range: "all" as const,
    totalPages: Math.max(1, Math.ceil(total / 100)),
    totals: {
      inboundItems: total,
      outboundConnectedCalls: 0,
      outboundDialedCalls: 0,
      totalItems: total,
    },
  };
}

describe("combined call-center reads", () => {
  it("collects deep source pages before applying global pagination", async () => {
    const pages: number[] = [];
    const items = await collectPagePrefix(async (page, pageSize) => {
      pages.push(page);
      const start = (page - 1) * pageSize;
      return {
        items: Array.from(
          { length: Math.min(pageSize, 205 - start) },
          (_, index) => start + index,
        ),
        total: 205,
      };
    }, 205);

    expect(pages).toEqual([1, 2, 3]);
    expect(items).toHaveLength(205);
    expect(items.at(-1)).toBe(204);
  });

  it("dedupes exact provider identity, prefers canonical, and orders mixed pages", async () => {
    let legacyReads = 0;
    let canonicalReads = 0;
    const result = await readCombinedCallCenterHistory(
      { page: 2, pageSize: 2, range: "all", view: "all" },
      {
        readCanonical: async () => {
          canonicalReads += 1;
          return historyResult([
            call("canonical-new", "2026-07-12T12:04:00.000Z", "CANONICAL"),
            call(
              "canonical-duplicate",
              "2026-07-12T12:03:00.000Z",
              "CANONICAL",
              "provider-1",
            ),
          ]);
        },
        readLegacy: async () => {
          legacyReads += 1;
          return historyResult([
            call("legacy-duplicate", "2026-07-12T12:03:00.000Z", "LEGACY", "provider-1"),
            call("legacy-old", "2026-07-12T12:02:00.000Z", "LEGACY"),
            call("legacy-oldest", "2026-07-12T12:01:00.000Z", "LEGACY"),
          ]);
        },
      },
    );

    expect(legacyReads).toBeGreaterThan(0);
    expect(canonicalReads).toBeGreaterThan(0);
    expect(result?.calls.map(({ id }) => id)).toEqual(["legacy-old", "legacy-oldest"]);
    expect(result?.totals.totalCalls).toBe(4);
  });

  it("reads both stores identically during ACTIVE and rollback", async () => {
    for (const _mode of ["ACTIVE", "ROLLBACK"] as const) {
      const reads: string[] = [];
      await readCombinedCallCenterHistory(
        { page: 1, pageSize: 25, range: "24h", view: "connections" },
        {
          readCanonical: async (options) => {
            reads.push(`canonical:${options?.view ?? "connections"}`);
            return historyResult([]);
          },
          readLegacy: async (options) => {
            reads.push(`legacy:${options?.view ?? "connections"}`);
            return historyResult([]);
          },
        },
      );
      expect(reads.sort()).toEqual(["canonical:connections", "legacy:connections"]);
    }
  });

  it("keeps mixed caller history visible during ACTIVE and rollback", async () => {
    for (const _mode of ["ACTIVE", "ROLLBACK"] as const) {
      const reads: string[] = [];
      const result = await readCombinedCallerTimeline(
        "+15555550123",
        {
          locationId: "office-1",
          locationIds: ["location-1"],
          page: 1,
          pageSize: 25,
          range: "all",
        },
        {
          readCanonical: async () => {
            reads.push("canonical");
            return callerResult([
              callerItem(
                "canonical-call",
                "2026-07-12T12:02:00.000Z",
                "CANONICAL",
                "provider-1",
              ),
            ]);
          },
          readLegacy: async () => {
            reads.push("legacy");
            return callerResult([
              callerItem(
                "legacy-duplicate",
                "2026-07-12T12:01:00.000Z",
                "LEGACY",
                "provider-1",
              ),
              callerItem("legacy-old", "2026-07-12T12:00:00.000Z", "LEGACY"),
            ]);
          },
        },
      );

      expect(reads.sort()).toEqual(["canonical", "legacy"]);
      expect(result?.items.map(({ id }) => id)).toEqual(["canonical-call", "legacy-old"]);
      expect(result?.totals.totalItems).toBe(2);
    }
  });

  it("merges caller threads, preserves source IDs, then paginates", async () => {
    const legacy = group(
      "needs-action:+15555550111",
      "2026-07-12T12:00:00.000Z",
      "legacy-missed-1",
    );
    const canonical = {
      ...group(
        "needs-action:+15555550111",
        "2026-07-12T12:01:00.000Z",
        "canonical-task-1",
      ),
      latestKind: "voicemail" as const,
      missedCount: 0,
      voicemailCount: 1,
    };
    expect(mergeNeedsActionGroups([legacy, canonical])[0]).toMatchObject({
      eventCount: 2,
      latestKind: "voicemail",
      recordIds: ["legacy-missed-1", "canonical-task-1"],
    });

    const result = await readCombinedNeedsAction(
      {
        legacyGroups: [
          legacy,
          group("needs-action:+15555550222", "2026-07-12T11:00:00.000Z", "legacy-2"),
        ],
        legacyGroupIds: ["needs-action:+15555550111", "needs-action:+15555550222"],
        locationIds: ["location-1"],
        page: 2,
        pageSize: 1,
      },
      {
        readCanonical: async () => ({
          groupIds: ["needs-action:+15555550111"],
          groups: [canonical],
          total: 1,
        }),
      },
    );
    expect(result.groups.map(({ id }) => id)).toEqual(["needs-action:+15555550222"]);
    expect(result.total).toBe(2);
  });
});
