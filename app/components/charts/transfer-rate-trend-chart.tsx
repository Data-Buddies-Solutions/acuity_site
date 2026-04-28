"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  rate: { label: "Transfer Rate", color: "var(--chart-5)" },
} satisfies ChartConfig;

export function TransferRateTrendChart({
  data,
  granularityLabel,
}: {
  data: {
    label: string;
    tooltipLabel: string;
    rate: number;
    transfers: number;
    calls: number;
  }[];
  granularityLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer Rate Trend</CardTitle>
        <CardDescription>
          {granularityLabel[0].toUpperCase() + granularityLabel.slice(1)} transfer rate to
          a human
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            No data available
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <LineChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(value) => `${Math.round(Number(value))}%`}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <ChartTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as (typeof data)[number];
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-sm">
                      <p className="text-xs font-medium">{row.tooltipLabel}</p>
                      <p className="mt-1 text-sm font-mono tabular-nums">
                        {row.rate.toFixed(1)}% ({row.transfers}/{row.calls} calls)
                      </p>
                    </div>
                  );
                }}
              />
              <Line
                type="natural"
                dataKey="rate"
                stroke="var(--color-rate)"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
