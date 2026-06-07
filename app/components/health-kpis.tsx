"use client";

import type {
  AdminPracticeDashboardData,
  LatencyPercentiles,
} from "@/lib/admin-analytics";
import {
  formatDuration,
  formatLatencyMs,
  formatPercent,
  inverseRateColor,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { AnimatedValue } from "@/app/components/animated-value";
import { StatCard } from "@/app/components/stat-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function PercentileRow({ label, p }: { label: string; p: LatencyPercentiles }) {
  const hasData = p.p50 > 0 || p.p90 > 0 || p.p95 > 0 || p.p99 > 0;
  const maxValue = Math.max(p.p50, p.p90, p.p95, p.p99, 1);

  return (
    <div className="rounded-xl border border-border/70 bg-card/80 px-4 py-3 shadow-sm">
      <p className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["p50", "p90", "p95", "p99"] as const).map((key) => {
          const value = p[key];
          const width = hasData
            ? `${Math.max((value / maxValue) * 100, value > 0 ? 10 : 0)}%`
            : "0%";
          const emphasized = key === "p95" || key === "p99";

          return (
            <div
              key={key}
              className={cn(
                "rounded-lg border px-2 py-2",
                emphasized
                  ? "border-foreground/15 bg-muted/40"
                  : "border-border/70 bg-background/70",
              )}
            >
              <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                {key}
              </p>
              <p
                className={cn(
                  "mt-1 font-mono text-sm tabular-nums text-foreground",
                  emphasized ? "font-semibold" : "font-medium",
                )}
              >
                {hasData ? formatLatencyMs(value) : "--"}
              </p>
              <div className="mt-2 h-1.5 rounded-full bg-muted">
                <div
                  className={cn(
                    "h-1.5 rounded-full",
                    emphasized ? "bg-foreground/75" : "bg-foreground/45",
                  )}
                  style={{ width }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InlineMetric({
  color,
  label,
  sub,
  value,
}: {
  color?: string;
  label: string;
  sub?: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-lg font-semibold tracking-tight text-foreground",
          color,
        )}
      >
        <AnimatedValue value={value} />
      </p>
      {sub ? <p className="mt-1 text-[10px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function SectionHeading({ description, title }: { description?: string; title: string }) {
  return (
    <div className="mb-3">
      <p className="text-[11px] font-semibold uppercase text-muted-foreground">{title}</p>
      {description ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

export function HealthKPIs({ data }: { data: AdminPracticeDashboardData }) {
  const toolFailureRate =
    data.toolCallCount > 0 ? (data.toolFailureCount / data.toolCallCount) * 100 : null;
  const transferRate =
    data.totalCalls > 0 ? (data.transferCount / data.totalCalls) * 100 : null;
  const cacheShare =
    data.totalInputTokens > 0 ? data.totalCachedTokens / data.totalInputTokens : 0;
  const effectiveInputTokens = Math.max(
    0,
    data.totalInputTokens - data.totalCachedTokens,
  );
  const totalMinutes = Math.round(data.totalDurationSec / 60);
  const showToolFailures = data.toolFailureCount > 0;

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <SectionHeading title="Operational Snapshot" />
        <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
          <StatCard
            label="Call Volume"
            value={String(data.totalCalls)}
            sub={data.totalCalls > 0 ? "Completed calls in range" : undefined}
            size="hero"
          />
          <StatCard
            label="Workload"
            value={
              totalMinutes > 0
                ? `${totalMinutes.toLocaleString()} min`
                : formatDuration(data.totalDurationSec)
            }
            sub={data.totalCalls > 0 ? formatDuration(data.totalDurationSec) : undefined}
            size="hero"
          />
          <StatCard
            label="Avg / Call"
            value={formatDuration(data.avgDurationSec)}
            sub={data.totalCalls > 0 ? "Average call duration" : undefined}
            size="hero"
          />
          <StatCard
            label="Transfer Rate"
            value={transferRate != null ? `${transferRate.toFixed(0)}%` : "--"}
            sub={
              data.transferCount > 0
                ? `${data.transferCount}/${data.totalCalls} calls transferred`
                : "No transfers in range"
            }
            size="hero"
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_1.35fr] xl:gap-6">
        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader className="px-4 py-4 sm:px-6">
            <CardTitle>Appointment Actions</CardTitle>
            <CardDescription>
              What actually happened inside appointment flows.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2 px-4 pb-4 sm:gap-3 sm:px-6">
            <InlineMetric
              label="Booked"
              value={String(data.bookApptSuccesses)}
              sub="Successful bookings"
            />
            <InlineMetric
              label="Confirmed"
              value={String(data.confirmApptSuccesses)}
              sub="Successful confirmations"
            />
            <InlineMetric
              label="Cancelled"
              value={String(data.cancelApptSuccesses)}
              sub="Successful cancellations"
            />
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader className="px-4 py-4 sm:px-6">
            <CardTitle>Prompt Footprint</CardTitle>
            <CardDescription>
              Input, output, cache reuse, and context shape.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 px-4 pb-4 sm:gap-3 sm:px-6 xl:grid-cols-3">
            <InlineMetric
              label="Total Input Tokens"
              value={
                data.totalInputTokens > 0 ? data.totalInputTokens.toLocaleString() : "--"
              }
              sub={
                data.avgInputTokens > 0
                  ? `${Math.round(data.avgInputTokens).toLocaleString()} avg / call`
                  : "Per-call average unavailable"
              }
            />
            <InlineMetric
              label="Total Output Tokens"
              value={
                data.totalOutputTokens > 0
                  ? data.totalOutputTokens.toLocaleString()
                  : "--"
              }
              sub={
                data.avgOutputTokens > 0
                  ? `${Math.round(data.avgOutputTokens).toLocaleString()} avg / call`
                  : "Per-call average unavailable"
              }
            />
            <InlineMetric
              label="Cache Efficiency"
              value={data.totalInputTokens > 0 ? formatPercent(cacheShare) : "--"}
              sub={
                data.totalInputTokens > 0
                  ? `${data.totalCachedTokens.toLocaleString()} cached / ${data.totalInputTokens.toLocaleString()} input`
                  : "No input tokens in range"
              }
            />
            <InlineMetric
              label="Effective Uncached Input"
              value={
                effectiveInputTokens > 0 ? effectiveInputTokens.toLocaleString() : "--"
              }
              sub="Fresh prompt load after cache reuse"
            />
            <InlineMetric
              label="Avg Peak Context"
              value={
                data.avgPeakContext > 0
                  ? Math.round(data.avgPeakContext).toLocaleString()
                  : "--"
              }
              sub="Prompt tokens at peak"
            />
            {showToolFailures ? (
              <InlineMetric
                label="Tool Failures"
                value={toolFailureRate != null ? `${toolFailureRate.toFixed(1)}%` : "--"}
                sub={`${data.toolFailureCount}/${data.toolCallCount} tool calls failed`}
                color={
                  toolFailureRate != null
                    ? inverseRateColor(toolFailureRate, 0, 5)
                    : undefined
                }
              />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div>
        <SectionHeading
          title="Latency Bands"
          description="P50 to P99 for the parts of the response path you said matter most."
        />
        <div className="grid gap-3 md:grid-cols-3">
          <PercentileRow label="LLM TTFT" p={data.ttftPercentiles} />
          <PercentileRow label="TTS TTFB" p={data.ttsttfbPercentiles} />
          <PercentileRow label="E2E Response" p={data.totalLatencyPercentiles} />
        </div>
      </div>
    </div>
  );
}
