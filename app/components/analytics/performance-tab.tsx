import type { AnalyticsData } from "@/lib/analytics";
import { formatLatencyMs, latencyColor } from "@/lib/format";
import { StatCard } from "@/app/components/stat-card";
import { LatencyBandChart } from "@/app/components/charts/latency-band-chart";

export function PerformanceTab({ data }: { data: AnalyticsData }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="STT P50"
          value={data.pipelineP50.stt != null ? formatLatencyMs(data.pipelineP50.stt) : "--"}
          size="hero"
          color={data.pipelineP50.stt != null ? latencyColor(data.pipelineP50.stt) : undefined}
        />
        <StatCard
          label="LLM TTFT P50"
          value={data.pipelineP50.llm != null ? formatLatencyMs(data.pipelineP50.llm) : "--"}
          size="hero"
          color={data.pipelineP50.llm != null ? latencyColor(data.pipelineP50.llm) : undefined}
        />
        <StatCard
          label="TTS TTFB P50"
          value={data.pipelineP50.tts != null ? formatLatencyMs(data.pipelineP50.tts) : "--"}
          size="hero"
          color={data.pipelineP50.tts != null ? latencyColor(data.pipelineP50.tts) : undefined}
        />
        <StatCard
          label="Total Latency P50"
          value={data.pipelineP50.total != null ? formatLatencyMs(data.pipelineP50.total) : "--"}
          sub="STT + LLM + TTS"
          size="hero"
          color={data.pipelineP50.total != null ? latencyColor(data.pipelineP50.total) : undefined}
        />
        <StatCard
          label="Avg tok/s"
          value={data.avgTokensPerSec > 0 ? `${Math.round(data.avgTokensPerSec)}` : "--"}
          sub="LLM throughput"
          size="hero"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <LatencyBandChart
          data={data.totalLatencyTrendData}
          title="Total Latency"
          description={`${data.trendGranularityLabel[0].toUpperCase() + data.trendGranularityLabel.slice(1)} P50 and P95 end-to-end latency`}
        />
        <LatencyBandChart
          data={data.sttLatencyTrendData}
          title="STT Latency"
          description={`${data.trendGranularityLabel[0].toUpperCase() + data.trendGranularityLabel.slice(1)} transcription latency`}
        />
        <div className="md:col-span-2">
          <LatencyBandChart
            data={data.ttftLatencyTrendData}
            title="LLM TTFT"
            description={`${data.trendGranularityLabel[0].toUpperCase() + data.trendGranularityLabel.slice(1)} P50 and P95 time-to-first-token`}
          />
        </div>
        <div className="md:col-span-2">
          <LatencyBandChart
            data={data.ttsLatencyTrendData}
            title="TTS TTFB"
            description={`${data.trendGranularityLabel[0].toUpperCase() + data.trendGranularityLabel.slice(1)} P50 and P95 time-to-first-byte`}
          />
        </div>
      </div>
    </div>
  );
}
