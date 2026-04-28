"use client";

import { Area, AreaChart, CartesianGrid, Line, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatLatencyMs } from "@/lib/format";

const chartConfig = {
  p95: { label: "P95", color: "var(--chart-4)" },
  p50: { label: "P50", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function LatencyBandChart({
  data,
  title,
  description,
}: {
  data: { label: string; tooltipLabel: string; p50: number | null; p95: number | null }[];
  title: string;
  description: string;
}) {
  const hasData = data.some((row) => row.p50 != null || row.p95 != null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            No data available
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <AreaChart data={data}>
              <defs>
                <linearGradient id={`${title}-p95`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-p95)" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="var(--color-p95)" stopOpacity={0.06} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(value) => `${Math.round(Number(value))}ms`}
                tickLine={false}
                axisLine={false}
                width={54}
              />
              <ChartTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as (typeof data)[number];
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-sm text-xs">
                      <p className="font-medium">{row.tooltipLabel}</p>
                      <div className="mt-1 space-y-0.5 font-mono">
                        <p>P50: {row.p50 != null ? formatLatencyMs(row.p50) : "--"}</p>
                        <p>P95: {row.p95 != null ? formatLatencyMs(row.p95) : "--"}</p>
                      </div>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="p95"
                stroke="var(--color-p95)"
                fill={`url(#${title}-p95)`}
                strokeWidth={1.5}
              />
              <Line
                type="natural"
                dataKey="p50"
                stroke="var(--color-p50)"
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
