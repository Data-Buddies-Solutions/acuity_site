import { describe, expect, it } from "bun:test";

import { formatEasternAppointmentDateTime } from "@/lib/format";

describe("formatEasternAppointmentDateTime", () => {
  it("preserves timezone-less appointment wall time as Eastern office time", () => {
    expect(formatEasternAppointmentDateTime("2026-05-12T11:00")).toBe(
      "Tue, May 12, 11:00 AM",
    );
    expect(formatEasternAppointmentDateTime("2026-05-12T11:00:00.000")).toBe(
      "Tue, May 12, 11:00 AM",
    );
  });

  it("converts timestamped values into Eastern time", () => {
    expect(formatEasternAppointmentDateTime("2026-05-12T15:00:00.000Z")).toBe(
      "Tue, May 12, 11:00 AM",
    );
  });

  it("uses the caller fallback when no appointment was detected", () => {
    expect(formatEasternAppointmentDateTime(null, "Not detected")).toBe(
      "Not detected",
    );
  });
});
