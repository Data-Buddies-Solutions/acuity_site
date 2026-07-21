import type { AdminPracticeAnalyticsData } from "@/lib/admin-analytics";
import { inverseRateColor } from "@/lib/format";
import { StatCard } from "@/app/components/stat-card";
import { ToolUsageChart } from "@/app/components/charts/tool-usage-chart";
import { ToolErrorRateChart } from "@/app/components/charts/tool-error-rate-chart";
import { ToolP95DurationChart } from "@/app/components/charts/tool-p95-duration-chart";

export function ToolsTab({ data }: { data: AdminPracticeAnalyticsData }) {
  const failureRate =
    data.totalToolCalls > 0
      ? ((data.totalToolErrors / data.totalToolCalls) * 100).toFixed(1)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Tool Calls"
          value={data.totalToolCalls.toLocaleString()}
          size="hero"
        />
        <StatCard
          label="Failure Rate"
          value={failureRate != null ? `${failureRate}%` : "--"}
          sub={
            data.totalToolErrors > 0
              ? `${data.totalToolErrors}/${data.totalToolCalls} tool calls`
              : undefined
          }
          size="hero"
          color={
            failureRate != null ? inverseRateColor(Number(failureRate), 0, 5) : undefined
          }
        />
        <StatCard
          label="Avg Calls/Event"
          value={
            data.totalCalls > 0
              ? (data.totalToolCalls / data.totalCalls).toFixed(1)
              : "--"
          }
          size="hero"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ToolUsageChart data={data.toolUsageData} />
        <ToolErrorRateChart data={data.toolErrorRateData} />
        <div className="md:col-span-2">
          <ToolP95DurationChart data={data.toolDurationData} />
        </div>
      </div>
    </div>
  );
}
