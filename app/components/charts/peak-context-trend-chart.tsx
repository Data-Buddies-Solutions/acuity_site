"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  peak: { label: "Peak Context", color: "var(--chart-5)" },
} satisfies ChartConfig;

export function PeakContextTrendChart({
  data,
  granularityLabel,
}: {
  data: { label: string; tooltipLabel: string; peak: number }[];
  granularityLabel: string;
}) {
  const hasData = data.some((row) => row.peak > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Peak Context</CardTitle>
        <CardDescription>{granularityLabel[0].toUpperCase() + granularityLabel.slice(1)} maximum prompt tokens</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">No data available</div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="peak-context-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-peak)" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="var(--color-peak)" stopOpacity={0.06} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} width={56} />
              <ChartTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as (typeof data)[number];
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-sm text-xs">
                      <p className="font-medium">{row.tooltipLabel}</p>
                      <p className="mt-1 font-mono">{row.peak.toLocaleString()} peak tokens</p>
                    </div>
                  );
                }}
              />
              <Area type="natural" dataKey="peak" fill="url(#peak-context-fill)" stroke="var(--color-peak)" strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
