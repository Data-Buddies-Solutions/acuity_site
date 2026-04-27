"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  input: { label: "Input", color: "var(--chart-1)" },
  output: { label: "Output", color: "var(--chart-2)" },
  cached: { label: "Cached", color: "var(--chart-4)" },
} satisfies ChartConfig;

export function TokenMixTrendChart({
  data,
  granularityLabel,
}: {
  data: { label: string; tooltipLabel: string; input: number; output: number; cached: number }[];
  granularityLabel: string;
}) {
  const hasData = data.some((row) => row.input > 0 || row.output > 0 || row.cached > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token Mix</CardTitle>
        <CardDescription>{granularityLabel[0].toUpperCase() + granularityLabel.slice(1)} input, output, and cached token totals</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">No data available</div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <BarChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} width={48} />
              <ChartTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as (typeof data)[number];
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-sm text-xs">
                      <p className="font-medium">{row.tooltipLabel}</p>
                      <div className="mt-1 space-y-0.5 font-mono">
                        <p>{row.input.toLocaleString()} input</p>
                        <p>{row.output.toLocaleString()} output</p>
                        <p>{row.cached.toLocaleString()} cached</p>
                      </div>
                    </div>
                  );
                }}
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="input" stackId="tokens" fill="var(--color-input)" />
              <Bar dataKey="output" stackId="tokens" fill="var(--color-output)" />
              <Bar dataKey="cached" stackId="tokens" fill="var(--color-cached)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
