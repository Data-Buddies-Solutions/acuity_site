"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatLatencyMs } from "@/lib/format";
import type { LatencyDistributionData } from "@/lib/admin-analytics";

const chartConfig = {
  count: { label: "Samples", color: "var(--chart-1)" },
  p50: { label: "P50", color: "var(--chart-2)" },
  p95: { label: "P95", color: "var(--chart-4)" },
  sample: { label: "Latency", color: "var(--chart-5)" },
} satisfies ChartConfig;

function PercentileBadge({
  hasSamples,
  label,
  value,
}: {
  hasSamples: boolean;
  label: string;
  value: number;
}) {
  return (
    <Badge variant="outline" className="font-mono">
      {label} {hasSamples ? formatLatencyMs(value) : "--"}
    </Badge>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
      No latency samples
    </div>
  );
}

export function LatencyDistributionChart({
  data,
  description,
  title,
}: {
  data: LatencyDistributionData;
  description: string;
  title: string;
}) {
  const hasSamples = data.sampleCount > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge variant="secondary">{data.sampleCount.toLocaleString()} samples</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <PercentileBadge
            hasSamples={hasSamples}
            label="P50"
            value={data.percentiles.p50}
          />
          <PercentileBadge
            hasSamples={hasSamples}
            label="P90"
            value={data.percentiles.p90}
          />
          <PercentileBadge
            hasSamples={hasSamples}
            label="P95"
            value={data.percentiles.p95}
          />
          <PercentileBadge
            hasSamples={hasSamples}
            label="P99"
            value={data.percentiles.p99}
          />
        </div>

        {!hasSamples ? (
          <EmptyChart />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartContainer config={chartConfig} className="h-[280px] w-full">
              <BarChart accessibilityLayer data={data.buckets}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  interval={0}
                  minTickGap={8}
                  tickLine={false}
                  tickMargin={8}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={42}
                />
                <ChartTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;

                    const row = payload[0].payload as (typeof data.buckets)[number];

                    return (
                      <div className="rounded-lg border bg-background p-2 text-xs shadow-sm">
                        <p className="font-medium">{row.label}</p>
                        <p className="mt-1 font-mono">
                          {row.count.toLocaleString()} samples (
                          {row.percent.toFixed(1)}%)
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>

            <ChartContainer config={chartConfig} className="h-[280px] w-full">
              <ScatterChart accessibilityLayer margin={{ top: 12, right: 8, bottom: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="percentile"
                  domain={[0, 100]}
                  name="Percentile"
                  tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                  tickLine={false}
                  axisLine={false}
                  type="number"
                />
                <YAxis
                  dataKey="value"
                  name="Latency"
                  tickFormatter={(value) => formatLatencyMs(Number(value))}
                  tickLine={false}
                  axisLine={false}
                  type="number"
                  width={56}
                />
                <ReferenceLine
                  y={data.percentiles.p50}
                  stroke="var(--color-p50)"
                  strokeDasharray="3 3"
                />
                <ReferenceLine
                  y={data.percentiles.p95}
                  stroke="var(--color-p95)"
                  strokeDasharray="5 3"
                />
                <ChartTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;

                    const row = payload[0].payload as (typeof data.samples)[number];

                    return (
                      <div className="rounded-lg border bg-background p-2 text-xs shadow-sm">
                        <p className="font-medium">
                          Percentile {row.percentile.toFixed(1)}%
                        </p>
                        <div className="mt-1 flex flex-col gap-0.5 font-mono">
                          <p>{formatLatencyMs(row.value)}</p>
                          <p className="text-muted-foreground">
                            sample {row.sample.toLocaleString()} of{" "}
                            {data.sampleCount.toLocaleString()}
                          </p>
                        </div>
                      </div>
                    );
                  }}
                />
                <Scatter
                  data={data.samples}
                  dataKey="value"
                  fill="var(--color-sample)"
                  fillOpacity={0.7}
                />
              </ScatterChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
