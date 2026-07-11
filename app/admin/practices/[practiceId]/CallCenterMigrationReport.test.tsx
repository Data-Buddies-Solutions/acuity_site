import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { buildLegacyCallCenterBackfillReport } from "@/lib/call-center/application/legacy-backfill-plan";

import { CallCenterMigrationReportView } from "./CallCenterMigrationReport";

it("shows blocked discovery without an apply control", () => {
  const report = buildLegacyCallCenterBackfillReport({
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
  });

  const html = renderToStaticMarkup(<CallCenterMigrationReportView report={report} />);

  expect(html).toContain("Migration apply is blocked");
  expect(html).toContain("LEGACY_SETTINGS_MISSING");
  expect(html).not.toContain("<button");
  expect(html).not.toContain("Apply configuration");
});
