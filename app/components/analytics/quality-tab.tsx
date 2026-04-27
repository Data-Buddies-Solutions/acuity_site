import type { AnalyticsData } from "@/lib/analytics";
import { formatPercent, inverseRateColor } from "@/lib/format";
import { StatCard } from "@/app/components/stat-card";
import { AnimatedValue } from "@/app/components/animated-value";
import { InterruptionRateTrendChart } from "@/app/components/charts/interruption-rate-trend-chart";
import { PeakTrafficHeatmap } from "@/app/components/charts/peak-traffic-heatmap";

export function QualityTab({ data }: { data: AnalyticsData }) {
  const transferRate =
    data.totalCalls > 0 ? ((data.transferCount / data.totalCalls) * 100).toFixed(1) : null;
  const toolFailureRate =
    data.totalToolCalls > 0
      ? ((data.totalToolErrors / data.totalToolCalls) * 100).toFixed(1)
      : null;
  const interruptionRate =
    data.totalCalls > 0 ? ((data.totalInterruptions / data.totalCalls)).toFixed(1) : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Total Calls"
          value={String(data.totalCalls)}
          size="hero"
        />
        <div className="group relative rounded-xl border border-white/60 bg-white/50 backdrop-blur-lg px-4 py-4 transition-all duration-300 hover:bg-white/80 hover:border-gray-200/60 hover:shadow-[0_0_24px_-4px_rgba(0,0,0,0.1)] hover:-translate-y-[1px] dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 dark:hover:border-white/20">
          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Appointments</p>
          <div className="mt-1 space-y-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-mono font-semibold leading-none tabular-nums tracking-tight text-gray-900 dark:text-gray-100">
                <AnimatedValue value={String(data.bookApptSuccesses)} />
              </span>
              <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">booked</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-mono font-semibold leading-none tabular-nums tracking-tight text-gray-900 dark:text-gray-100">
                <AnimatedValue value={String(data.confirmApptSuccesses)} />
              </span>
              <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">confirmed</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-mono font-semibold leading-none tabular-nums tracking-tight text-gray-900 dark:text-gray-100">
                <AnimatedValue value={String(data.cancelApptSuccesses)} />
              </span>
              <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">cancelled</span>
            </div>
          </div>
        </div>
        <StatCard
          label="Transfer Rate"
          value={transferRate != null ? `${transferRate}%` : "--"}
          sub={transferRate != null ? `${data.transferCount}/${data.totalCalls} calls` : undefined}
          size="hero"
        />
        <StatCard
          label="Tool Failure Rate"
          value={toolFailureRate != null ? `${toolFailureRate}%` : "--"}
          sub={
            data.totalToolErrors > 0
              ? `${data.totalToolErrors}/${data.totalToolCalls} tool calls`
              : undefined
          }
          size="hero"
          color={toolFailureRate != null ? inverseRateColor(Number(toolFailureRate), 0, 5) : undefined}
        />
        <StatCard
          label="Interruptions"
          value={interruptionRate != null ? `${interruptionRate}/call` : "--"}
          sub={`${data.totalInterruptions} total`}
          size="hero"
        />
      </div>

      <div className="grid grid-cols-1 gap-6">
        <InterruptionRateTrendChart data={data.interruptionRateTrendData} granularityLabel={data.trendGranularityLabel} />
        <PeakTrafficHeatmap data={data.peakTrafficData} />
      </div>
    </div>
  );
}
