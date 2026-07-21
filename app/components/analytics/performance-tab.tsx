import type { AdminPracticeAnalyticsData } from "@/lib/admin-analytics";
import { formatLatencyMs, latencyColor } from "@/lib/format";
import { StatCard } from "@/app/components/stat-card";
import { LatencyDistributionChart } from "@/app/components/charts/latency-distribution-chart";

export function PerformanceTab({ data }: { data: AdminPracticeAnalyticsData }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="STT Final P50"
          value={
            data.pipelineP50.stt != null ? formatLatencyMs(data.pipelineP50.stt) : "--"
          }
          size="hero"
          color={
            data.pipelineP50.stt != null ? latencyColor(data.pipelineP50.stt) : undefined
          }
        />
        <StatCard
          label="LLM TTFT P50"
          value={
            data.pipelineP50.llm != null ? formatLatencyMs(data.pipelineP50.llm) : "--"
          }
          size="hero"
          color={
            data.pipelineP50.llm != null ? latencyColor(data.pipelineP50.llm) : undefined
          }
        />
        <StatCard
          label="TTS TTFB P50"
          value={
            data.pipelineP50.tts != null ? formatLatencyMs(data.pipelineP50.tts) : "--"
          }
          size="hero"
          color={
            data.pipelineP50.tts != null ? latencyColor(data.pipelineP50.tts) : undefined
          }
        />
        <StatCard
          label="E2E Response P50"
          value={
            data.pipelineP50.total != null
              ? formatLatencyMs(data.pipelineP50.total)
              : "--"
          }
          sub="User stop to agent start"
          size="hero"
          color={
            data.pipelineP50.total != null
              ? latencyColor(data.pipelineP50.total)
              : undefined
          }
        />
        <StatCard
          label="Avg tok/s"
          value={data.avgTokensPerSec > 0 ? `${Math.round(data.avgTokensPerSec)}` : "--"}
          sub="LLM throughput"
          size="hero"
        />
      </div>

      <div className="flex flex-col gap-6">
        <LatencyDistributionChart
          data={data.latencyDistributions.total}
          title="E2E Response Latency"
          description="All measured response turns, bucketed by latency with the ranked right tail exposed."
        />
        <LatencyDistributionChart
          data={data.latencyDistributions.stt}
          title="STT Final Transcript"
          description="Distribution of final transcript delay from measured user turns."
        />
        <LatencyDistributionChart
          data={data.latencyDistributions.llm}
          title="LLM TTFT"
          description="Distribution of time to first token across measured assistant turns."
        />
        <LatencyDistributionChart
          data={data.latencyDistributions.tts}
          title="TTS TTFB"
          description="Distribution of text-to-speech time to first byte across measured turns."
        />
      </div>
    </div>
  );
}
