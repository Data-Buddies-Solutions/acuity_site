"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  errorRate: { label: "Error Rate", color: "var(--chart-5)" },
} satisfies ChartConfig;

export function ToolErrorRateChart({
  data,
}: {
  data: { tool: string; errorRate: number; errors: number; total: number }[];
}) {
  const displayData = data.filter((row) => row.total > 0).slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool Error Rate</CardTitle>
        <CardDescription>Error rate by tool, sorted from worst to best</CardDescription>
      </CardHeader>
      <CardContent>
        {displayData.length === 0 ? (
          <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">No data available</div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[240px] w-full">
            <BarChart data={displayData} layout="vertical">
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickFormatter={(value) => `${Math.round(Number(value))}%`} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="tool" tickLine={false} axisLine={false} width={140} />
              <ChartTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as (typeof displayData)[number];
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-sm text-xs">
                      <p className="font-medium">{row.tool}</p>
                      <div className="mt-1 space-y-0.5 font-mono">
                        <p>{row.errorRate.toFixed(1)}% error rate</p>
                        <p>{row.errors} errors / {row.total} calls</p>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="errorRate" fill="var(--color-errorRate)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
