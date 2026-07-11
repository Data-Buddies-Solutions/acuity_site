import { describe, expect, it } from "bun:test";

import { createMigrationReportHandler } from "./handler";

const request = new Request("https://example.test/api/admin/call-center/report");
const context = (practiceId = "practice-1") => ({
  params: Promise.resolve({ practiceId }),
});

function report() {
  return {
    kind: "LEGACY_CALL_CENTER_BACKFILL_REPORT" as const,
    mode: "REPORT_ONLY" as const,
    practiceId: "practice-1",
    writeSupported: false as const,
  };
}

describe("call-center migration report route", () => {
  it("requires an administrator", async () => {
    let reads = 0;
    const GET = createMigrationReportHandler({
      getSession: async () => ({ user: { email: "staff@example.com" } }),
      isAdmin: () => false,
      readReport: async () => {
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
      readReport: async () => null,
    });

    expect((await GET(request, context())).status).toBe(404);
  });

  it("returns one uncached, read-only report", async () => {
    const GET = createMigrationReportHandler({
      clock: () => new Date("2026-07-11T18:00:00.000Z"),
      getSession: async () => ({ user: { email: "admin@example.com" } }),
      isAdmin: () => true,
      readReport: async () => report(),
    });

    const response = await GET(request, context());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      generatedAt: "2026-07-11T18:00:00.000Z",
      report: report(),
    });
  });

  it("does not expose reader failures", async () => {
    const GET = createMigrationReportHandler({
      getSession: async () => ({ user: { email: "admin@example.com" } }),
      isAdmin: () => true,
      readReport: async () => {
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
