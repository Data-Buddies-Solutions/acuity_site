import { describe, expect, it } from "bun:test";

import {
  computePercentiles,
  formatEasternAppointmentDateTime,
  percentile,
} from "@/lib/format";

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
    expect(formatEasternAppointmentDateTime(null, "Not detected")).toBe("Not detected");
  });
});

describe("percentile", () => {
  it("uses observed nearest-rank values instead of interpolation", () => {
    const samples = [500, 600, 500];

    expect(percentile(samples, 50)).toBe(500);
    expect(percentile(samples, 95)).toBe(600);
    expect(percentile(samples, 99)).toBe(600);
  });

  it("does not synthesize a midpoint for even sample counts", () => {
    expect(percentile([100, 200, 300, 400], 50)).toBe(200);
  });

  it("keeps computed latency percentiles on real samples", () => {
    expect(computePercentiles([500, 600, 500])).toEqual({
      p50: 500,
      p90: 600,
      p95: 600,
      p99: 600,
    });
  });
});
