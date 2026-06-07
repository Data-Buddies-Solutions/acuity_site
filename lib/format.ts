import { calculateUsageCostBreakdown, microsToDollars } from "@/lib/pricing";

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
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);

  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? 0;
  return (
    (sorted[lower] ?? 0) + ((sorted[upper] ?? 0) - (sorted[lower] ?? 0)) * (index - lower)
  );
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
