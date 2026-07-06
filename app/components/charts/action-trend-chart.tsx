"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
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
  bookedRate: { label: "Booked", color: "var(--chart-1)" },
  cancelledRate: { label: "Cancelled", color: "var(--chart-4)" },
  transferRate: { label: "Transferred", color: "var(--chart-5)" },
} satisfies ChartConfig;

export function ActionTrendChart({
  data,
  granularityLabel,
}: {
  data: {
    label: string;
    tooltipLabel: string;
    calls: number;
    booked: number;
    bookedRate: number;
    cancelled: number;
    cancelledRate: number;
    transfers: number;
    transferRate: number;
  }[];
  granularityLabel: string;
}) {
  const hasData = data.some(
    (row) => row.booked > 0 || row.cancelled > 0 || row.transfers > 0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Action Rates</CardTitle>
        <CardDescription>
          {granularityLabel[0].toUpperCase() + granularityLabel.slice(1)} action share
          normalized by call volume
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
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
                domain={[0, 100]}
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
                    <div className="rounded-lg border bg-background p-2 shadow-sm text-xs">
                      <p className="font-medium">{row.tooltipLabel}</p>
                      <div className="mt-1 flex flex-col gap-0.5 font-mono">
                        <p>
                          {row.bookedRate.toFixed(1)}% booked ({row.booked}/
                          {row.calls})
                        </p>
                        <p>
                          {row.cancelledRate.toFixed(1)}% cancelled ({row.cancelled}/
                          {row.calls})
                        </p>
                        <p>
                          {row.transferRate.toFixed(1)}% transferred ({row.transfers}/
                          {row.calls})
                        </p>
                      </div>
                    </div>
                  );
                }}
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Line
                type="monotone"
                dataKey="bookedRate"
                stroke="var(--color-bookedRate)"
                strokeWidth={2}
                dot={{ r: 2.5 }}
              />
              <Line
                type="monotone"
                dataKey="cancelledRate"
                stroke="var(--color-cancelledRate)"
                strokeWidth={2}
                dot={{ r: 2.5 }}
              />
              <Line
                type="monotone"
                dataKey="transferRate"
                stroke="var(--color-transferRate)"
                strokeWidth={2}
                dot={{ r: 2.5 }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
