"use client";

import type { TurnRecord } from "@/lib/types";
import { computePercentiles, formatLatencyMs, deriveTotalLatency } from "@/lib/format";
import {
  ScatterChart,
  Scatter,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

function PercentileBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
      {label}: {formatLatencyMs(value)}
    </span>
  );
}

function LatencyChart({
  title,
  data,
  color,
}: {
  title: string;
  data: { turn: number; value: number }[];
  color: string;
}) {
  const p = computePercentiles(data.map((d) => d.value));

  return (
    <div className="min-w-0 rounded-xl border border-white/60 bg-white/50 p-4 backdrop-blur-lg dark:border-white/10 dark:bg-white/5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        <div className="flex flex-wrap gap-1.5">
          <PercentileBadge label="P50" value={p.p50} />
          <PercentileBadge label="P90" value={p.p90} />
          <PercentileBadge label="P95" value={p.p95} />
          <PercentileBadge label="P99" value={p.p99} />
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220} minWidth={0}>
        <ScatterChart margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            dataKey="turn"
            type="number"
            name="Turn"
            tick={{ fontSize: 10 }}
            label={{ value: "Turn", position: "insideBottom", offset: 0, fontSize: 10 }}
          />
          <YAxis
            dataKey="value"
            type="number"
            name="Latency"
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => formatLatencyMs(v)}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload as { turn: number; value: number };
              return (
                <div className="rounded-md border bg-background px-3 py-1.5 text-xs shadow-sm">
                  <p className="font-medium">Turn {d.turn}</p>
                  <p className="text-muted-foreground">{formatLatencyMs(d.value)}</p>
                </div>
              );
            }}
          />
          <Scatter data={data} fill={color} r={5} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function ContextGrowthChart({ turns }: { turns: TurnRecord[] }) {
  const data = turns
    .filter((t) => t.promptTokens > 0)
    .map((t) => ({
      turn: t.turn,
      cached: t.cachedTokens,
      nonCached: Math.max(0, t.promptTokens - t.cachedTokens),
      output: t.completionTokens,
      total: t.promptTokens,
    }));

  if (data.length < 2) return null;

  const peak = Math.max(...data.map((d) => d.total));
  const avgCacheRate =
    data.reduce((s, d) => s + d.cached, 0) /
    Math.max(
      1,
      data.reduce((s, d) => s + d.total, 0),
    );

  return (
    <div className="min-w-0 rounded-xl border border-white/60 bg-white/50 p-4 backdrop-blur-lg dark:border-white/10 dark:bg-white/5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground">Context Window Growth</h3>
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
            Peak: {formatTokens(peak)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
            Cache: {(avgCacheRate * 100).toFixed(0)}%
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220} minWidth={0}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            dataKey="turn"
            type="number"
            tick={{ fontSize: 10 }}
            label={{ value: "Turn", position: "insideBottom", offset: 0, fontSize: 10 }}
          />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={formatTokens} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof data)[number];
              const cacheRate = d.total > 0 ? (d.cached / d.total) * 100 : 0;
              return (
                <div className="rounded-md border bg-background px-3 py-1.5 text-xs shadow-sm space-y-0.5">
                  <p className="font-medium">Turn {d.turn}</p>
                  <p style={{ color: "#10b981" }}>Cached: {d.cached.toLocaleString()}</p>
                  <p style={{ color: "#6366f1" }}>
                    Non-cached: {d.nonCached.toLocaleString()}
                  </p>
                  <p className="text-muted-foreground">
                    Total input: {d.total.toLocaleString()} ({cacheRate.toFixed(0)}%
                    cached)
                  </p>
                  <p style={{ color: "#f59e0b" }}>Output: {d.output.toLocaleString()}</p>
                </div>
              );
            }}
          />
          <Area
            dataKey="cached"
            stackId="context"
            name="Cached"
            stroke="#10b981"
            fill="rgba(16,185,129,0.25)"
            strokeWidth={1.5}
          />
          <Area
            dataKey="nonCached"
            stackId="context"
            name="Non-cached"
            stroke="#6366f1"
            fill="rgba(99,102,241,0.15)"
            strokeWidth={1.5}
          />
          <Area
            dataKey="output"
            name="Output"
            stroke="#f59e0b"
            fill="none"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LatencyScatterCharts({ turns }: { turns: TurnRecord[] }) {
  const ttftData = turns
    .filter((t) => t.ttftMs > 0)
    .map((t) => ({ turn: t.turn, value: t.ttftMs }));

  const ttsData = turns
    .filter((t) => t.ttsttfbMs > 0)
    .map((t) => ({ turn: t.turn, value: t.ttsttfbMs }));

  const totalData = turns
    .map((t) => ({ turn: t.turn, value: deriveTotalLatency(t) }))
    .filter((t) => t.value > 0);

  const sttData = turns
    .filter((t) => (t.sttLatencyMs ?? 0) > 0)
    .map((t) => ({ turn: t.turn, value: t.sttLatencyMs }));

  const hasLatency = ttftData.length > 0 || ttsData.length > 0;
  const hasContext = turns.filter((t) => t.promptTokens > 0).length >= 2;

  if (!hasLatency && !hasContext) return null;

  return (
    <div className="space-y-4">
      {hasLatency && (
        <div className="grid gap-4 md:grid-cols-2">
          {ttftData.length > 0 && (
            <LatencyChart title="TTFT by Turn" data={ttftData} color="#6366f1" />
          )}
          {ttsData.length > 0 && (
            <LatencyChart title="TTS TTFB by Turn" data={ttsData} color="#3b82f6" />
          )}
          {sttData.length > 0 && (
            <LatencyChart title="STT Latency by Turn" data={sttData} color="#f59e0b" />
          )}
          {totalData.length > 0 && (
            <LatencyChart
              title="Total Latency by Turn"
              data={totalData}
              color="#10b981"
            />
          )}
        </div>
      )}
      <ContextGrowthChart turns={turns} />
    </div>
  );
}
