"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  count: { label: "Calls", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function CallVolumeTrendChart({
  data,
  granularityLabel,
}: {
  data: { label: string; tooltipLabel: string; count: number }[];
  granularityLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Call Volume Trend</CardTitle>
        <CardDescription>{granularityLabel[0].toUpperCase() + granularityLabel.slice(1)} call volume across the selected window</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">No data available</div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <BarChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
              <ChartTooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as (typeof data)[number];
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-sm">
                      <p className="text-xs font-medium">{row.tooltipLabel}</p>
                      <p className="mt-1 text-sm font-mono tabular-nums">{row.count.toLocaleString()} calls</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
