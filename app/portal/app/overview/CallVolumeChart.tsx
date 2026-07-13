"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PortalCallVolumePoint } from "@/lib/portal-overview";

type TooltipPayload = {
  payload?: PortalCallVolumePoint;
  value?: number;
};

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) {
    return null;
  }
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-lg border border-[var(--portal-border)] bg-white px-3 py-2 shadow-sm">
      <p className="text-xs font-medium text-[var(--portal-muted)]">{point.label}</p>
      <p className="mt-0.5 text-sm font-semibold text-[var(--portal-ink)]">
        {point.count} {point.count === 1 ? "call" : "calls"}
      </p>
    </div>
  );
}

export default function CallVolumeChart({
  points,
  totalMinutes,
}: {
  points: PortalCallVolumePoint[];
  totalMinutes: string;
}) {
  const tickInterval = points.length > 12 ? Math.ceil(points.length / 8) - 1 : 0;

  return (
    <div className="flex h-full min-h-0 flex-col p-5 lg:p-6">
      <div>
        <h2 className="text-base font-semibold text-[var(--portal-ink)]">Call volume</h2>
        <p className="mt-1 text-xs text-[var(--portal-muted)]">
          {totalMinutes} minutes handled
        </p>
      </div>
      <div className="mt-3 min-h-48 min-w-0 flex-1">
        <ResponsiveContainer height="100%" minWidth={0} width="100%">
          <BarChart data={points} margin={{ bottom: 4, left: 0, right: 12, top: 10 }}>
            <CartesianGrid stroke="#edf0f5" strokeDasharray="3 3" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="label"
              fontSize={12}
              interval={tickInterval}
              stroke="var(--portal-muted-soft)"
              tickMargin={8}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              fontSize={12}
              stroke="var(--portal-muted-soft)"
              tickMargin={8}
              tickLine={false}
              width={42}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: "rgba(83, 106, 145, 0.08)" }}
            />
            <Bar
              dataKey="count"
              fill="var(--color-accent)"
              maxBarSize={42}
              radius={[6, 6, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
