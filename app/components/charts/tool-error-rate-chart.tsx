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

const chartConfig = {
  errors: { label: "Errors", color: "var(--chart-5)" },
} satisfies ChartConfig;

export function ToolErrorRateChart({
  data,
}: {
  data: { tool: string; errorRate: number; errors: number; total: number }[];
}) {
  const displayData = data.filter((row) => row.errors > 0).slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool Failures</CardTitle>
        <CardDescription>Tools causing the most failed executions</CardDescription>
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
                allowDecimals={false}
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
                      <div className="mt-1 flex flex-col gap-0.5 font-mono">
                        <p>{row.errors} failed executions</p>
                        <p>
                          {row.errorRate.toFixed(1)}% rate ({row.errors}/{row.total})
                        </p>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="errors"
                fill="var(--color-errors)"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
