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
    <div className="rounded-lg border border-black/8 bg-white px-3 py-2 shadow-sm">
      <p className="text-xs font-medium text-[#617477]">{point.label}</p>
      <p className="mt-0.5 text-sm font-semibold text-[#10272c]">
        {point.count} {point.count === 1 ? "call" : "calls"}
      </p>
    </div>
  );
}

export default function CallVolumeChart({ points }: { points: PortalCallVolumePoint[] }) {
  const tickInterval = points.length > 12 ? Math.ceil(points.length / 8) - 1 : 0;

  return (
    <div className="rounded-xl border border-black/6 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold tracking-[-0.02em] text-[#10272c]">
          Call Volume
        </h3>
      </div>
      <div className="mt-4 h-64">
        <ResponsiveContainer height="100%" width="100%">
          <BarChart
            data={points}
            margin={{ bottom: 0, left: -16, right: 8, top: 8 }}
          >
            <CartesianGrid stroke="#eef2f2" strokeDasharray="3 3" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="label"
              fontSize={12}
              interval={tickInterval}
              stroke="#8a999b"
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              fontSize={12}
              stroke="#8a999b"
              tickLine={false}
              width={32}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: "rgba(13, 115, 119, 0.06)" }}
            />
            <Bar
              dataKey="count"
              fill="var(--color-accent)"
              radius={[6, 6, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
