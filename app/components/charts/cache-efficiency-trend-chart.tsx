"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  rate: { label: "Cache Efficiency", color: "var(--chart-3)" },
} satisfies ChartConfig;

export function CacheEfficiencyTrendChart({
  data,
  granularityLabel,
}: {
  data: { label: string; tooltipLabel: string; rate: number; cached: number; input: number }[];
  granularityLabel: string;
}) {
  const hasData = data.some((row) => row.input > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cache Efficiency</CardTitle>
        <CardDescription>{granularityLabel[0].toUpperCase() + granularityLabel.slice(1)} cached input share</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">No data available</div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <LineChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value))}%`} tickLine={false} axisLine={false} width={48} />
              <ChartTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as (typeof data)[number];
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-sm text-xs">
                      <p className="font-medium">{row.tooltipLabel}</p>
                      <div className="mt-1 space-y-0.5 font-mono">
                        <p>{row.rate.toFixed(1)}% cached</p>
                        <p>{row.cached.toLocaleString()} cached / {row.input.toLocaleString()} input</p>
                      </div>
                    </div>
                  );
                }}
              />
              <Line type="natural" dataKey="rate" stroke="var(--color-rate)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
