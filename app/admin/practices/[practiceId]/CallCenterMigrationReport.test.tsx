import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildLegacyCallCenterBackfillReport,
  legacyCallCenterBackfillSnapshotVersion,
} from "@/lib/call-center/application/legacy-backfill-plan";

import { CallCenterMigrationReportView } from "./CallCenterMigrationReport";

it("shows blocked discovery without an apply control", () => {
  const snapshot = {
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
  const report = buildLegacyCallCenterBackfillReport(snapshot);

  const reportVersion = legacyCallCenterBackfillSnapshotVersion(snapshot);
  const html = renderToStaticMarkup(
    <CallCenterMigrationReportView report={report} reportVersion={reportVersion} />,
  );

  expect(html).toContain("Migration apply is blocked");
  expect(html).toContain("LEGACY_SETTINGS_MISSING");
  expect(html).toContain(reportVersion);
  expect(html).not.toContain("<button");
  expect(html).not.toContain("Apply configuration");
});
