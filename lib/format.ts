import { calculateUsageCostBreakdown, microsToDollars } from "@/lib/pricing";

export const EASTERN_TIME_ZONE = "America/New_York";

const easternAppointmentDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: EASTERN_TIME_ZONE,
  weekday: "short",
});

const easternWallClockAppointmentDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
  weekday: "short",
});

const timezoneLessIsoDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

function formatAppointmentDateTimeParts(formatter: Intl.DateTimeFormat, date: Date) {
  const parts = formatter.formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const dayPeriod = getPart("dayPeriod");

  return `${getPart("weekday")}, ${getPart("month")} ${getPart("day")}, ${getPart(
    "hour",
  )}:${getPart("minute")}${dayPeriod ? ` ${dayPeriod}` : ""}`;
}

export function formatLatencyMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatDuration(secs: number): string {
  const minutes = Math.floor(secs / 60);
  const seconds = Math.round(secs % 60);

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return phone;
}

export function formatEasternAppointmentDateTime(
  value: string | null,
  fallback = "—",
): string {
  if (!value) return fallback;

  const localMatch = timezoneLessIsoDateTimePattern.exec(value);
  if (localMatch) {
    const [, year, month, day, hour, minute] = localMatch;
    return formatAppointmentDateTimeParts(
      easternWallClockAppointmentDateTimeFormatter,
      new Date(
        Date.UTC(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hour),
          Number(minute),
        ),
      ),
    );
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : formatAppointmentDateTimeParts(easternAppointmentDateTimeFormatter, parsed);
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export interface LatencyPercentiles {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export function computePercentiles(values: number[]): LatencyPercentiles {
  return {
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
  };
}

export function percentile(values: number[], p: number): number {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);

  if (sorted.length === 0) return 0;

  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
}

export function deriveTotalLatency(turn: {
  endOfTurnDelayMs?: number | null;
  totalLatencyMs?: number;
  ttftMs: number;
  ttsttfbMs?: number | null;
}): number {
  if ((turn.totalLatencyMs ?? 0) > 0) return turn.totalLatencyMs!;
  if (turn.ttftMs <= 0) return 0;
  if ((turn.endOfTurnDelayMs ?? 0) <= 0) return 0;
  return (turn.endOfTurnDelayMs ?? 0) + turn.ttftMs + (turn.ttsttfbMs ?? 0);
}

export function latencyColor(ms: number): string {
  if (ms < 500) return "text-emerald-600";
  if (ms < 1000) return "text-amber-500";
  return "text-red-500";
}

export function cacheColor(rate: number): string {
  if (rate >= 0.7) return "text-emerald-600";
  if (rate >= 0.4) return "text-amber-500";
  return "text-red-500";
}

export function inverseRateColor(
  rate: number,
  goodThreshold: number,
  warnThreshold: number,
): string {
  if (rate <= goodThreshold) return "text-emerald-600";
  if (rate <= warnThreshold) return "text-amber-500";
  return "text-red-500";
}

export function estimateCost(opts: {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  ttsChars: number;
  durationSec: number;
}): number {
  return microsToDollars(calculateUsageCostBreakdown(opts).totalCostMicros);
}

export function formatCost(dollars: number): string {
  if (dollars < 0.01) return `$${(dollars * 100).toFixed(2)}c`;
  if (dollars < 1) return `$${dollars.toFixed(3)}`;
  return `$${dollars.toFixed(2)}`;
}
