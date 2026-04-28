"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
  p95Ms: { label: "P95 Duration", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function ToolP95DurationChart({
  data,
}: {
  data: { tool: string; p95Ms: number; avgMs: number }[];
}) {
  const displayData = data.filter((row) => row.p95Ms > 0).slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool P95 Duration</CardTitle>
        <CardDescription>Tail latency by tool, not just average duration</CardDescription>
      </CardHeader>
      <CardContent>
        {displayData.length === 0 ? (
          <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
            No data available
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[240px] w-full">
            <BarChart data={displayData} layout="vertical">
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(value) => `${Math.round(Number(value))}ms`}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="tool"
                tickLine={false}
                axisLine={false}
                width={140}
              />
              <ChartTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as (typeof displayData)[number];
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-sm text-xs">
                      <p className="font-medium">{row.tool}</p>
                      <div className="mt-1 space-y-0.5 font-mono">
                        <p>P95: {formatLatencyMs(row.p95Ms)}</p>
                        <p>Avg: {formatLatencyMs(row.avgMs)}</p>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="p95Ms" fill="var(--color-p95Ms)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
