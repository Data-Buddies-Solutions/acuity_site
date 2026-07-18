import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

import type { PortalRecentCallItem } from "@/lib/call-center/portal-model";

import { CallHistoryRow } from "./CallHistoryRow";

afterEach(cleanup);

function historyCall(): PortalRecentCallItem {
  return {
    answeredBy: "Emma",
    connected: true,
    direction: "INBOUND",
    durationSec: 95,
    fromPhone: "+15555550123",
    id: "call-1",
    locationName: "South Florida",
    occurredAt: new Date("2026-07-18T10:57:03.000Z"),
    startedAt: new Date("2026-07-18T10:55:28.000Z"),
    status: "COMPLETED",
    toPhone: "+15555550999",
  };
}

describe("Call history row", () => {
  it("keeps direction, outcome, office, and number history visible", () => {
    render(<CallHistoryRow call={historyCall()} />);

    expect(screen.getByText("(555) 555-0123")).toBeTruthy();
    expect(screen.getByText("Inbound")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("South Florida")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View history" })).toBeTruthy();
  });
});
