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
  nonCachedInput: { label: "Non-cached input", color: "var(--chart-1)" },
  cachedInput: { label: "Cached input", color: "var(--chart-3)" },
  output: { label: "Output", color: "var(--chart-2)" },
} satisfies ChartConfig;

function formatCompact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

export function TokenMixTrendChart({
  data,
  granularityLabel,
}: {
  data: {
    label: string;
    tooltipLabel: string;
    cachedInput: number;
    nonCachedInput: number;
    output: number;
    totalInput: number;
  }[];
  granularityLabel: string;
}) {
  const hasData = data.some(
    (row) => row.totalInput > 0 || row.output > 0 || row.cachedInput > 0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token Mix</CardTitle>
        <CardDescription>
          {granularityLabel[0].toUpperCase() + granularityLabel.slice(1)} real token
          volume split by cache status
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
              <YAxis
                tickFormatter={(value) => formatCompact(Number(value))}
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
                        <p>{row.totalInput.toLocaleString()} input</p>
                        <p>{row.nonCachedInput.toLocaleString()} non-cached</p>
                        <p>{row.cachedInput.toLocaleString()} cached</p>
                        <p>{row.output.toLocaleString()} output</p>
                      </div>
                    </div>
                  );
                }}
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                dataKey="nonCachedInput"
                stackId="tokens"
                fill="var(--color-nonCachedInput)"
              />
              <Bar
                dataKey="cachedInput"
                stackId="tokens"
                fill="var(--color-cachedInput)"
              />
              <Bar
                dataKey="output"
                stackId="tokens"
                fill="var(--color-output)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
