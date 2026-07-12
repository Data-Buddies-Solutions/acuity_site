import { describe, expect, it } from "bun:test";

import {
  buildLegacyCallCenterBackfillReport,
  legacyCallCenterBackfillSnapshotVersion,
  type LegacyCallCenterBackfillSnapshot,
} from "@/lib/call-center/application/legacy-backfill-plan";

import { createMigrationReportHandler } from "./handler";

const request = new Request("https://example.test/api/admin/call-center/report");
const context = (practiceId = "practice-1") => ({
  params: Promise.resolve({ practiceId }),
});

function snapshot(): LegacyCallCenterBackfillSnapshot {
  return {
    practiceId: "practice-1",
    locationIds: [],
    existingGenericConfiguration: {
      endpointCount: 0,
      numberCount: 0,
      queueCount: 0,
    },
    settings: null,
    phoneNumbers: [],
    seats: [],
    profileAssignments: [],
    runtimeFallbacks: {
      connection: false,
      credential: false,
      inboundNumber: false,
      outboundNumber: false,
    },
  };
}

function report() {
  return buildLegacyCallCenterBackfillReport(snapshot());
}

describe("call-center migration report route", () => {
  it("requires an administrator", async () => {
    let reads = 0;
    const GET = createMigrationReportHandler({
      getSession: async () => ({ user: { email: "staff@example.com" } }),
      isAdmin: () => false,
      readSnapshot: async () => {
        reads += 1;
        return null;
      },
    });

    expect((await GET(request, context())).status).toBe(401);
    expect(reads).toBe(0);
  });

  it("returns not found for a missing practice", async () => {
    const GET = createMigrationReportHandler({
      getSession: async () => ({ user: { email: "admin@example.com" } }),
      isAdmin: () => true,
      readSnapshot: async () => null,
    });

    expect((await GET(request, context())).status).toBe(404);
  });

  it("returns one uncached, read-only report", async () => {
    const GET = createMigrationReportHandler({
      clock: () => new Date("2026-07-11T18:00:00.000Z"),
      getSession: async () => ({ user: { email: "admin@example.com" } }),
      isAdmin: () => true,
      readSnapshot: async () => snapshot(),
    });

    const response = await GET(request, context());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("x-call-center-report-version")).toBe(
      legacyCallCenterBackfillSnapshotVersion(snapshot()),
    );
    expect(await response.json()).toEqual({
      generatedAt: "2026-07-11T18:00:00.000Z",
      report: report(),
      reportVersion: legacyCallCenterBackfillSnapshotVersion(snapshot()),
    });
  });

  it("does not expose reader failures", async () => {
    const GET = createMigrationReportHandler({
      getSession: async () => ({ user: { email: "admin@example.com" } }),
      isAdmin: () => true,
      readSnapshot: async () => {
        throw new Error("sensitive database detail");
      },
    });

    const response = await GET(request, context());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "call_center_migration_report_failed",
    });
  });
});
