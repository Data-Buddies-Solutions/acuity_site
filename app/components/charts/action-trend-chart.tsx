"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";

const chartConfig = {
  booked: { label: "Booked", color: "var(--chart-1)" },
  cancelled: { label: "Cancelled", color: "var(--chart-5)" },
} satisfies ChartConfig;

export function ActionTrendChart({
  data,
  granularityLabel,
}: {
  data: {
    label: string;
    tooltipLabel: string;
    booked: number;
    cancelled: number;
  }[];
  granularityLabel: string;
}) {
  const hasData = data.some((row) => row.booked > 0 || row.cancelled > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Action Totals</CardTitle>
        <CardDescription>
          {granularityLabel[0].toUpperCase() + granularityLabel.slice(1)} booked and
          cancelled totals
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            No data available
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <BarChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
              />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
              <ChartTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as (typeof data)[number];
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-sm text-xs">
                      <p className="font-medium">{row.tooltipLabel}</p>
                      <div className="mt-1 space-y-0.5 font-mono">
                        <p>{row.booked} booked</p>
                        <p>{row.cancelled} cancelled</p>
                      </div>
                    </div>
                  );
                }}
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="booked" stackId="actions" fill="var(--color-booked)" />
              <Bar
                dataKey="cancelled"
                stackId="actions"
                fill="var(--color-cancelled)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
