import type { AnalyticsData } from "@/lib/analytics";
import { formatPercent, cacheColor } from "@/lib/format";
import { StatCard } from "@/app/components/stat-card";
import { TokenMixTrendChart } from "@/app/components/charts/token-mix-trend-chart";
import { CacheEfficiencyTrendChart } from "@/app/components/charts/cache-efficiency-trend-chart";
import { PeakContextTrendChart } from "@/app/components/charts/peak-context-trend-chart";

export function TokensTab({ data }: { data: AnalyticsData }) {
  const totalTokens = data.totalInputTokens + data.totalOutputTokens;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Total Tokens"
          value={totalTokens > 0 ? totalTokens.toLocaleString() : "--"}
          sub={
            totalTokens > 0
              ? `${data.totalInputTokens.toLocaleString()} in / ${data.totalOutputTokens.toLocaleString()} out`
              : undefined
          }
          size="hero"
        />
        <StatCard
          label="Cached Tokens"
          value={
            data.totalCachedTokens > 0
              ? data.totalCachedTokens.toLocaleString()
              : "--"
          }
          sub="discounted input"
          size="hero"
        />
        <StatCard
          label="Cache Hit Rate"
          value={data.avgCacheHitRate > 0 ? formatPercent(data.avgCacheHitRate) : "--"}
          size="hero"
          color={data.avgCacheHitRate > 0 ? cacheColor(data.avgCacheHitRate) : undefined}
        />
        <StatCard
          label="Avg Input Tokens"
          value={data.totalCalls > 0 ? Math.round(data.totalInputTokens / data.totalCalls).toLocaleString() : "--"}
          sub="per call"
          size="hero"
        />
        <StatCard
          label="Avg Output Tokens"
          value={data.totalCalls > 0 ? Math.round(data.totalOutputTokens / data.totalCalls).toLocaleString() : "--"}
          sub="per call"
          size="hero"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <TokenMixTrendChart data={data.tokenTrendData} granularityLabel={data.trendGranularityLabel} />
        <CacheEfficiencyTrendChart data={data.cacheEfficiencyTrendData} granularityLabel={data.trendGranularityLabel} />
        <div className="md:col-span-2">
          <PeakContextTrendChart data={data.peakContextTrendData} granularityLabel={data.trendGranularityLabel} />
        </div>
      </div>
    </div>
  );
}
