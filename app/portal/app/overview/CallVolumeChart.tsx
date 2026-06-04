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
    <div className="rounded-xl border border-[#cfd5e2] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_rgba(16,24,40,0.04)] transition duration-150 hover:-translate-y-0.5 hover:border-[#b9c4dd] hover:shadow-[0_2px_4px_rgba(16,24,40,0.06),0_16px_34px_rgba(16,24,40,0.08)]">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold tracking-normal text-[#151a24]">
          Call Volume
        </h3>
      </div>
      <div className="mt-4 h-48 min-w-0">
        <ResponsiveContainer height="100%" minWidth={0} width="100%">
          <BarChart data={points} margin={{ bottom: 0, left: -16, right: 8, top: 8 }}>
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
            <Bar dataKey="count" fill="var(--color-accent)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
