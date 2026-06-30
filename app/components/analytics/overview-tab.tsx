import type { AnalyticsData } from "@/lib/analytics";
import { formatDuration, inverseRateColor } from "@/lib/format";
import { StatCard } from "@/app/components/stat-card";
import { CallVolumeTrendChart } from "@/app/components/charts/call-volume-trend-chart";
import { TransferRateTrendChart } from "@/app/components/charts/transfer-rate-trend-chart";
import { ActionTrendChart } from "@/app/components/charts/action-trend-chart";
import { DurationDistributionChart } from "@/app/components/charts/duration-distribution-chart";

export function OverviewTab({ data }: { data: AnalyticsData }) {
  const transferRate =
    data.totalCalls > 0
      ? ((data.transferCount / data.totalCalls) * 100).toFixed(1)
      : null;
  const totalActions = data.bookApptSuccesses + data.cancelApptSuccesses;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Calls"
          value={String(data.totalCalls)}
          sub={formatDuration(data.totalDurationSec)}
          size="hero"
        />
        <StatCard
          label="Avg Duration"
          value={formatDuration(data.avgDurationSec)}
          size="hero"
        />
        <StatCard
          label="Transfer Rate"
          value={transferRate != null ? `${transferRate}%` : "--"}
          sub={
            transferRate != null
              ? `${data.transferCount}/${data.totalCalls} calls`
              : undefined
          }
          size="hero"
        />
        <StatCard
          label="Actions"
          value={String(totalActions)}
          sub={`${data.bookApptSuccesses} booked / ${data.cancelApptSuccesses} cancelled`}
          size="hero"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <CallVolumeTrendChart
          data={data.callVolumeTrendData}
          granularityLabel={data.trendGranularityLabel}
        />
        <TransferRateTrendChart
          data={data.transferTrendData}
          granularityLabel={data.trendGranularityLabel}
        />
        <div className="md:col-span-2">
          <ActionTrendChart
            data={data.actionTrendData}
            granularityLabel={data.trendGranularityLabel}
          />
        </div>
        <DurationDistributionChart data={data.durationDistributionData} />
      </div>
    </div>
  );
}
