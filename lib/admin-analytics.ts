import type { ToolCallRecord, TurnRecord } from "@/lib/call-types";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isSuccessfulToolAction } from "@/lib/tool-action-status";

type AgentStatus = "SETUP" | "ACTIVE" | "PAUSED" | "ERROR";
type CostCategory =
  | "LLM_INPUT"
  | "LLM_CACHED_INPUT"
  | "LLM_OUTPUT"
  | "SPEECH_TO_TEXT"
  | "TEXT_TO_SPEECH"
  | "TELEPHONY"
  | "REVIEW"
  | "OTHER";

export type AdminPracticeRange = "24h" | "7d" | "30d" | "all";

type CallMetric = {
  bookedAppointment: boolean;
  cancelledAppointment: boolean;
  confirmedAppointment: boolean;
  durationSec: number;
  estimatedCostMicros: number;
  needsReview: boolean;
  practiceId: string;
  startedAt: Date;
  status: string;
  transferred: boolean;
};

type AdminCallRecord = Awaited<ReturnType<typeof loadPracticeCalls>>[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEZONE = "America/New_York";
const RANGE_DAYS: Record<Exclude<AdminPracticeRange, "all">, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
};

const DURATION_BUCKETS = [
  { label: "0-30s", max: 30 },
  { label: "30-60s", max: 60 },
  { label: "1-2m", max: 120 },
  { label: "2-3m", max: 180 },
  { label: "3-5m", max: 300 },
  { label: "5-10m", max: 600 },
  { label: "10m+", max: Infinity },
];

type BucketGranularity = "hour" | "day" | "week";

interface BucketInfo {
  key: string;
  label: string;
  tooltipLabel: string;
  sort: number;
}

interface AnalyticsBucketStats {
  booked: number;
  cachedTokens: number;
  calls: number;
  cancelled: number;
  confirmed: number;
  durationSec: number;
  inputTokens: number;
  interruptions: number;
  outputTokens: number;
  peakContext: number;
  sttValues: number[];
  totalLatencyValues: number[];
  transfers: number;
  ttsValues: number[];
  ttftValues: number[];
}

type TrendDatum = {
  label: string;
  tooltipLabel: string;
};

export interface LatencyPercentiles {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

type PercentileTrendDatum = TrendDatum & {
  p50: number | null;
  p95: number | null;
};

export interface AdminPracticeDashboardData {
  avgCacheHitRate: number;
  avgDurationSec: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgPeakContext: number;
  avgTokensPerSec: number;
  avgTtsChars: number;
  bookApptSuccesses: number;
  cancelApptSuccesses: number;
  confirmApptSuccesses: number;
  toolCallCount: number;
  toolFailureCount: number;
  totalCachedTokens: number;
  totalCalls: number;
  totalDurationSec: number;
  totalInputTokens: number;
  totalInterruptions: number;
  totalLatencyPercentiles: LatencyPercentiles;
  totalOutputTokens: number;
  transferCount: number;
  ttftPercentiles: LatencyPercentiles;
  ttsttfbPercentiles: LatencyPercentiles;
}

export interface AdminPracticeAnalyticsData {
  actionTrendData: (TrendDatum & {
    booked: number;
    cancelled: number;
    confirmed: number;
  })[];
  avgCacheHitRate: number;
  avgDurationSec: number;
  avgTokensPerSec: number;
  bookApptSuccesses: number;
  cacheEfficiencyTrendData: (TrendDatum & {
    cached: number;
    input: number;
    rate: number;
  })[];
  callVolumeTrendData: (TrendDatum & { count: number })[];
  cancelApptSuccesses: number;
  confirmApptSuccesses: number;
  durationDistributionData: { bucket: string; count: number }[];
  interruptionRateTrendData: (TrendDatum & {
    calls: number;
    count: number;
    rate: number;
  })[];
  peakContextTrendData: (TrendDatum & { peak: number })[];
  peakTrafficData: { count: number; day: string; hour: number }[];
  pipelineP50: {
    llm: number | null;
    stt: number | null;
    total: number | null;
    tts: number | null;
  };
  sttLatencyTrendData: PercentileTrendDatum[];
  tokenTrendData: (TrendDatum & {
    cached: number;
    input: number;
    output: number;
  })[];
  toolDurationData: { avgMs: number; p95Ms: number; tool: string }[];
  toolErrorRateData: {
    errorRate: number;
    errors: number;
    tool: string;
    total: number;
  }[];
  toolUsageData: { count: number; tool: string }[];
  totalCachedTokens: number;
  totalCalls: number;
  totalDurationSec: number;
  totalInputTokens: number;
  totalInterruptions: number;
  totalLatencyTrendData: PercentileTrendDatum[];
  totalOutputTokens: number;
  totalTtsChars: number;
  totalToolCalls: number;
  totalToolErrors: number;
  transferCount: number;
  transferTrendData: (TrendDatum & {
    calls: number;
    rate: number;
    transfers: number;
  })[];
  trendGranularityLabel: "hourly" | "daily" | "weekly";
  ttsLatencyTrendData: PercentileTrendDatum[];
  ttftLatencyTrendData: PercentileTrendDatum[];
}

export interface AdminCallTableRow {
  apptActions: string[];
  avgTokensPerSec: number;
  cacheHitRate: number;
  callId: string;
  callerPhone: string;
  durationSec: number;
  fallbackUsed: boolean;
  hasAudio: boolean;
  id: string;
  interruptionCount: number;
  llmModel: string;
  officeName: string | null;
  officePhone: string;
  p50TotalLatency: number;
  p50Ttft: number;
  p50Ttsttfb: number;
  peakContext: number;
  reviewAverageScore: number | null;
  reviewNeedsAttention: boolean;
  reviewPassed: boolean | null;
  reviewStatus: "pending" | "completed" | "failed" | "not_created";
  startedAt: string;
  toolActions: string[];
  toolCalls: number;
  toolErrors: number;
  totalTurns: number;
  transcriptText: string;
  transferred: boolean;
}

export interface AdminPracticeOfficeFilterOption {
  id: string;
  label: string;
  phones: string[];
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  month: "2-digit",
  timeZone: TIMEZONE,
  year: "numeric",
});

const utcMonthDayFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const utcMonthDayYearFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

const utcHourFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  hour12: true,
  timeZone: "UTC",
});

const peakTrafficDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  weekday: "short",
});

const peakTrafficHourFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  hour12: false,
  timeZone: TIMEZONE,
});

function sinceDays(days: number) {
  return new Date(Date.now() - days * DAY_MS);
}

function getRangeStart(range: AdminPracticeRange) {
  return range === "all" ? null : sinceDays(RANGE_DAYS[range]);
}

function getGranularity(range: AdminPracticeRange): BucketGranularity {
  switch (range) {
    case "24h":
      return "hour";
    case "7d":
      return "day";
    case "30d":
    case "all":
      return "week";
  }
}

function getGranularityLabel(
  granularity: BucketGranularity,
): AdminPracticeAnalyticsData["trendGranularityLabel"] {
  switch (granularity) {
    case "hour":
      return "hourly";
    case "day":
      return "daily";
    case "week":
      return "weekly";
  }
}

function getTimeZoneParts(date: Date) {
  const parts = partsFormatter.formatToParts(date);

  return {
    day: Number(parts.find((part) => part.type === "day")?.value ?? 0),
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
    month: Number(parts.find((part) => part.type === "month")?.value ?? 0),
    year: Number(parts.find((part) => part.type === "year")?.value ?? 0),
  };
}

function createPseudoUtcDate(parts: {
  day: number;
  hour?: number;
  month: number;
  year: number;
}) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour ?? 0));
}

function getBucketStart(date: Date, granularity: BucketGranularity) {
  const parts = getTimeZoneParts(date);
  const base = createPseudoUtcDate(parts);

  if (granularity === "hour") {
    return createPseudoUtcDate(parts);
  }

  if (granularity === "day") {
    return createPseudoUtcDate({
      day: parts.day,
      month: parts.month,
      year: parts.year,
    });
  }

  const dayOfWeek = base.getUTCDay();
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  base.setUTCDate(base.getUTCDate() - offset);
  base.setUTCHours(0, 0, 0, 0);

  return base;
}

function getBucketInfoFromStart(start: Date, granularity: BucketGranularity): BucketInfo {
  const year = start.getUTCFullYear();
  const month = String(start.getUTCMonth() + 1).padStart(2, "0");
  const day = String(start.getUTCDate()).padStart(2, "0");
  const hour = String(start.getUTCHours()).padStart(2, "0");

  if (granularity === "hour") {
    return {
      key: `${year}-${month}-${day}-${hour}`,
      label: utcHourFormatter
        .format(start)
        .replace(" AM", "a")
        .replace(" PM", "p")
        .toLowerCase(),
      sort: start.getTime(),
      tooltipLabel: `${utcMonthDayYearFormatter.format(start)}, ${utcHourFormatter.format(start)} ET`,
    };
  }

  if (granularity === "day") {
    return {
      key: `${year}-${month}-${day}`,
      label: utcMonthDayFormatter.format(start),
      sort: start.getTime(),
      tooltipLabel: utcMonthDayYearFormatter.format(start),
    };
  }

  return {
    key: `${year}-${month}-${day}`,
    label: `Week of ${utcMonthDayFormatter.format(start)}`,
    sort: start.getTime(),
    tooltipLabel: `Week of ${utcMonthDayYearFormatter.format(start)}`,
  };
}

function listBuckets(
  since: Date,
  now: Date,
  granularity: BucketGranularity,
): BucketInfo[] {
  const buckets: BucketInfo[] = [];
  const cursor = getBucketStart(since, granularity);
  const end = getBucketStart(now, granularity);

  while (cursor.getTime() <= end.getTime()) {
    buckets.push(getBucketInfoFromStart(new Date(cursor.getTime()), granularity));

    if (granularity === "hour") {
      cursor.setUTCHours(cursor.getUTCHours() + 1);
    } else if (granularity === "day") {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  }

  return buckets;
}

function createEmptyAnalyticsBucket(): AnalyticsBucketStats {
  return {
    booked: 0,
    cachedTokens: 0,
    calls: 0,
    cancelled: 0,
    confirmed: 0,
    durationSec: 0,
    inputTokens: 0,
    interruptions: 0,
    outputTokens: 0,
    peakContext: 0,
    sttValues: [],
    totalLatencyValues: [],
    transfers: 0,
    ttsValues: [],
    ttftValues: [],
  };
}

function percentileDatum(bucket: BucketInfo, values: number[]): PercentileTrendDatum {
  if (values.length === 0) {
    return {
      label: bucket.label,
      p50: null,
      p95: null,
      tooltipLabel: bucket.tooltipLabel,
    };
  }

  return {
    label: bucket.label,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    tooltipLabel: bucket.tooltipLabel,
  };
}

function getAgentStatus(agents: Array<{ status: AgentStatus }>): AgentStatus {
  if (agents.some((agent) => agent.status === "ERROR")) {
    return "ERROR";
  }

  if (agents.some((agent) => agent.status === "ACTIVE")) {
    return "ACTIVE";
  }

  if (agents.some((agent) => agent.status === "PAUSED")) {
    return "PAUSED";
  }

  return "SETUP";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function addMapValue(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);

  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
}

function computePercentiles(values: number[]): LatencyPercentiles {
  return {
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
  };
}

function getTurns(data: unknown): TurnRecord[] {
  if (!isRecord(data) || !Array.isArray(data.turns)) {
    return [];
  }

  return data.turns.filter(isRecord) as TurnRecord[];
}

function getToolCalls(data: unknown): ToolCallRecord[] {
  return getTurns(data).flatMap((turn) =>
    Array.isArray(turn.toolCalls) ? turn.toolCalls : [],
  );
}

function getToolActionLabels(call: {
  bookedAppointment: boolean;
  cancelledAppointment: boolean;
  confirmedAppointment: boolean;
  data: unknown;
  transferred: boolean;
}) {
  const actions = new Set<string>();

  if (call.bookedAppointment) actions.add("Booked");
  if (call.confirmedAppointment) actions.add("Confirmed");
  if (call.cancelledAppointment) actions.add("Cancelled");
  if (call.transferred) actions.add("Transferred");

  for (const tool of getToolCalls(call.data)) {
    if (!isSuccessfulToolAction(tool)) {
      continue;
    }

    if (tool.name === "book_appt") actions.add("Booked");
    if (tool.name === "confirm_appt") actions.add("Confirmed");
    if (tool.name === "cancel_appt") actions.add("Cancelled");
    if (tool.name === "transfer_call") actions.add("Transferred");
  }

  return [...actions];
}

function getReviewSummary(call: { data: unknown; reviewResult: unknown }) {
  if (isRecord(call.reviewResult) && typeof call.reviewResult.summary === "string") {
    return call.reviewResult.summary;
  }

  if (isRecord(call.data) && isRecord(call.data.reviewResult)) {
    const summary = call.data.reviewResult.summary;
    return typeof summary === "string" ? summary : null;
  }

  return null;
}

function getReviewAverage(call: {
  reviewAverageScore: number | null;
  reviewResult: unknown;
}) {
  if (typeof call.reviewAverageScore === "number") {
    return call.reviewAverageScore;
  }

  const result = call.reviewResult;
  if (!isRecord(result) || !isRecord(result.scores)) {
    return null;
  }

  const values = Object.values(result.scores).filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );

  return values.length > 0 ? average(values) : null;
}

function getReviewPassed(reviewResult: unknown) {
  return isRecord(reviewResult) && typeof reviewResult.passed === "boolean"
    ? reviewResult.passed
    : null;
}

function normalizeReviewStatus(status: string | null): AdminCallTableRow["reviewStatus"] {
  if (status === "pending" || status === "completed" || status === "failed") {
    return status;
  }

  return "not_created";
}

function formatToolAction(name: string) {
  switch (name) {
    case "book_appt":
      return "Book";
    case "confirm_appt":
      return "Confirm";
    case "cancel_appt":
      return "Cancel";
    default:
      return name.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function median(values: number[]) {
  return percentile(values, 50);
}

function extractTranscriptText(data: unknown) {
  if (!isRecord(data)) {
    return "";
  }

  const sessionReport = isRecord(data.sessionReport) ? data.sessionReport : null;
  const chatHistory = sessionReport?.chat_history;
  const items =
    isRecord(chatHistory) && Array.isArray(chatHistory.items) ? chatHistory.items : [];
  const sessionMessages = items
    .filter(isRecord)
    .map((item) => {
      const role = item.role;
      if (item.type !== "message" || (role !== "user" && role !== "assistant")) {
        return "";
      }

      const content = Array.isArray(item.content) ? item.content : [];
      return content
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }

          if (isRecord(entry) && typeof entry.transcript === "string") {
            return entry.transcript;
          }

          return "";
        })
        .join(" ");
    })
    .filter(Boolean);

  if (sessionMessages.length > 0) {
    return sessionMessages.join(" ").replace(/\s+/g, " ").trim();
  }

  return getTurns(data)
    .flatMap((turn) => [turn.callerText ?? "", turn.agentText ?? ""])
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLatencyArrays(call: {
  avgTtft: number;
  avgTtsttfb: number;
  data: unknown;
  latencyValues: unknown;
}) {
  const latency = isRecord(call.latencyValues) ? call.latencyValues : {};
  const fromJson = {
    stt: Array.isArray(latency.stt) ? latency.stt.filter(isFiniteNumber) : [],
    total: Array.isArray(latency.totalLatency)
      ? latency.totalLatency.filter(isFiniteNumber)
      : [],
    tts: Array.isArray(latency.ttsttfb) ? latency.ttsttfb.filter(isFiniteNumber) : [],
    ttft: Array.isArray(latency.ttft) ? latency.ttft.filter(isFiniteNumber) : [],
  };

  if (
    fromJson.stt.length ||
    fromJson.total.length ||
    fromJson.tts.length ||
    fromJson.ttft.length
  ) {
    return fromJson;
  }

  const stt: number[] = [];
  const total: number[] = [];
  const tts: number[] = [];
  const ttft: number[] = [];

  for (const turn of getTurns(call.data)) {
    const turnStt = asNumber(turn.sttLatencyMs);
    const turnTtft = asNumber(turn.ttftMs);
    const turnTts = asNumber(turn.ttsttfbMs);
    const turnTotal = asNumber(turn.totalLatencyMs) || turnStt + turnTtft + turnTts;

    if (turnStt > 0) stt.push(turnStt);
    if (turnTtft > 0) ttft.push(turnTtft);
    if (turnTts > 0) tts.push(turnTts);
    if (turnTotal > 0) total.push(turnTotal);
  }

  if (ttft.length === 0 && call.avgTtft > 0) ttft.push(call.avgTtft);
  if (tts.length === 0 && call.avgTtsttfb > 0) tts.push(call.avgTtsttfb);

  return { stt, total, tts, ttft };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getCallTotalTurns(call: { data: unknown; totalTurns: number }) {
  if (call.totalTurns > 0) {
    return call.totalTurns;
  }

  return getTurns(call.data).filter((turn) => turn.callerText).length;
}

function getCacheHitRate(call: {
  cachedTokens: number;
  cacheHitRate: number;
  data: unknown;
  inputTokens: number;
}) {
  if (call.cacheHitRate > 0) {
    return call.cacheHitRate;
  }

  if (isRecord(call.data) && isRecord(call.data.totals)) {
    const rate = asNumber(call.data.totals.cacheHitRate);
    if (rate > 0) {
      return rate;
    }
  }

  return call.inputTokens > 0 ? call.cachedTokens / call.inputTokens : 0;
}

function getPeakContext(call: { data: unknown; peakContext: number }) {
  if (call.peakContext > 0) {
    return call.peakContext;
  }

  if (isRecord(call.data) && isRecord(call.data.totals)) {
    return Math.max(0, Math.round(asNumber(call.data.totals.peakContextTokens)));
  }

  return 0;
}

function countCallsByPractice(calls: CallMetric[], since: Date) {
  const counts = new Map<string, number>();

  for (const call of calls) {
    if (call.startedAt >= since) {
      addMapValue(counts, call.practiceId, 1);
    }
  }

  return counts;
}

function sumCostByPractice(calls: CallMetric[], since: Date) {
  const costs = new Map<string, number>();

  for (const call of calls) {
    if (call.startedAt >= since) {
      addMapValue(costs, call.practiceId, call.estimatedCostMicros);
    }
  }

  return costs;
}

function needsReviewByPractice(calls: CallMetric[]) {
  const counts = new Map<string, number>();

  for (const call of calls) {
    if (call.needsReview) {
      addMapValue(counts, call.practiceId, 1);
    }
  }

  return counts;
}

function latestCallByPractice(calls: CallMetric[]) {
  const latest = new Map<string, CallMetric>();

  for (const call of calls) {
    const current = latest.get(call.practiceId);
    if (!current || call.startedAt > current.startedAt) {
      latest.set(call.practiceId, call);
    }
  }

  return latest;
}

function getBucketCount(range: AdminPracticeRange) {
  switch (range) {
    case "24h":
      return 24;
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "all":
      return 12;
  }
}

function bucketStartForRange(range: AdminPracticeRange, calls: AdminCallRecord[]) {
  const explicitStart = getRangeStart(range);
  if (explicitStart) {
    return explicitStart;
  }

  const earliest = calls.at(-1)?.startedAt;
  return earliest ? new Date(earliest) : sinceDays(30);
}

function buildTrendBuckets(calls: AdminCallRecord[], range: AdminPracticeRange) {
  const bucketCount = getBucketCount(range);
  const start = bucketStartForRange(range, calls);
  const end = new Date();
  const span = Math.max(end.getTime() - start.getTime(), DAY_MS);
  const bucketMs = range === "24h" ? 60 * 60 * 1000 : Math.ceil(span / bucketCount);

  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = new Date(start.getTime() + index * bucketMs);
    const bucketEnd = new Date(bucketStart.getTime() + bucketMs);
    return {
      appointments: 0,
      calls: 0,
      costMicros: 0,
      end: bucketEnd,
      needsReview: 0,
      start: bucketStart,
      transfers: 0,
    };
  });

  for (const call of calls) {
    const index = Math.min(
      Math.max(Math.floor((call.startedAt.getTime() - start.getTime()) / bucketMs), 0),
      buckets.length - 1,
    );
    const bucket = buckets[index];

    if (!bucket) {
      continue;
    }

    bucket.calls++;
    bucket.costMicros += call.estimatedCostMicros;
    if (call.transferred) bucket.transfers++;
    if (call.needsReview) bucket.needsReview++;
    if (
      call.bookedAppointment ||
      call.confirmedAppointment ||
      call.cancelledAppointment
    ) {
      bucket.appointments++;
    }
  }

  return buckets;
}

function buildPeakTraffic(calls: AdminCallRecord[]) {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const grid = labels.flatMap((day) =>
    Array.from({ length: 24 }, (_, hour) => ({ calls: 0, day, hour })),
  );

  for (const call of calls) {
    const dayIndex = (call.startedAt.getDay() + 6) % 7;
    const hour = call.startedAt.getHours();
    const cell = grid.find((item) => item.day === labels[dayIndex] && item.hour === hour);

    if (cell) {
      cell.calls++;
    }
  }

  return grid;
}

function buildToolStats(calls: AdminCallRecord[]) {
  const stats = new Map<string, { count: number; errors: number; durations: number[] }>();

  for (const call of calls) {
    for (const tool of getToolCalls(call.data)) {
      const current = stats.get(tool.name) ?? { count: 0, durations: [], errors: 0 };
      current.count++;
      if (tool.isError) current.errors++;
      if (tool.durationMs > 0) current.durations.push(tool.durationMs);
      stats.set(tool.name, current);
    }
  }

  return [...stats.entries()]
    .map(([name, value]) => ({
      avgMs: average(value.durations),
      count: value.count,
      errorRate: value.count > 0 ? value.errors / value.count : 0,
      errors: value.errors,
      name,
      p95Ms: percentile(value.durations, 95),
    }))
    .sort((a, b) => b.count - a.count);
}

function buildPracticeAnalyticsData(
  calls: AdminCallRecord[],
  range: AdminPracticeRange,
): AdminPracticeAnalyticsData {
  const now = new Date();
  const since = getRangeStart(range) ?? calls.at(-1)?.startedAt ?? sinceDays(30);
  const granularity = getGranularity(range);
  const bucketInfos = listBuckets(since, now, granularity);
  const buckets = new Map(
    bucketInfos.map((bucket) => [bucket.key, createEmptyAnalyticsBucket()]),
  );

  const toolCounts = new Map<string, number>();
  const toolErrors = new Map<string, number>();
  const toolDurations = new Map<string, number[]>();
  const peakTrafficMap = new Map<string, number>();
  const bucketCounts = new Array(DURATION_BUCKETS.length).fill(0) as number[];

  let totalDurationSec = 0;
  let transferCount = 0;
  let totalToolCalls = 0;
  let totalToolErrors = 0;
  let bookApptSuccesses = 0;
  let confirmApptSuccesses = 0;
  let cancelApptSuccesses = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let totalTtsChars = 0;
  let totalInterruptions = 0;

  const allSttValues: number[] = [];
  const allTtftValues: number[] = [];
  const allTtsValues: number[] = [];
  const allTotalLatencyValues: number[] = [];
  const allTokensPerSec: number[] = [];

  for (const call of calls) {
    const bucketInfo = getBucketInfoFromStart(
      getBucketStart(call.startedAt, granularity),
      granularity,
    );
    const bucket = buckets.get(bucketInfo.key);

    if (!bucket) {
      continue;
    }

    const toolCalls = getToolCalls(call.data);
    const callToolCalls = toolCalls.length > 0 ? toolCalls.length : call.toolCalls;
    const callToolErrors =
      toolCalls.length > 0
        ? toolCalls.filter((tool) => tool.isError).length
        : call.toolErrors;
    const latencyValues = getLatencyArrays(call);
    const peakContext = getPeakContext(call);

    let booked = call.bookedAppointment ? 1 : 0;
    let confirmed = call.confirmedAppointment ? 1 : 0;
    let cancelled = call.cancelledAppointment ? 1 : 0;
    let transferred = call.transferred;

    bucket.calls++;
    bucket.durationSec += call.durationSec;
    bucket.inputTokens += call.inputTokens;
    bucket.outputTokens += call.outputTokens;
    bucket.cachedTokens += call.cachedTokens;
    bucket.interruptions += call.interruptionCount;
    bucket.peakContext = Math.max(bucket.peakContext, peakContext);
    bucket.sttValues.push(...latencyValues.stt);
    bucket.ttftValues.push(...latencyValues.ttft);
    bucket.ttsValues.push(...latencyValues.tts);
    bucket.totalLatencyValues.push(...latencyValues.total);

    totalDurationSec += call.durationSec;
    totalInputTokens += call.inputTokens;
    totalOutputTokens += call.outputTokens;
    totalCachedTokens += call.cachedTokens;
    totalTtsChars += call.ttsChars;
    totalInterruptions += call.interruptionCount;
    totalToolCalls += callToolCalls;
    totalToolErrors += callToolErrors;

    if (call.avgTokensPerSec > 0) {
      allTokensPerSec.push(call.avgTokensPerSec);
    }

    allSttValues.push(...latencyValues.stt);
    allTtftValues.push(...latencyValues.ttft);
    allTtsValues.push(...latencyValues.tts);
    allTotalLatencyValues.push(...latencyValues.total);

    for (let index = 0; index < DURATION_BUCKETS.length; index++) {
      const durationBucket = DURATION_BUCKETS[index];

      if (
        call.durationSec <= durationBucket.max ||
        index === DURATION_BUCKETS.length - 1
      ) {
        bucketCounts[index]++;
        break;
      }
    }

    const day = peakTrafficDayFormatter.format(call.startedAt);
    const hour = Number(peakTrafficHourFormatter.format(call.startedAt)) % 24;
    const trafficKey = `${day}-${hour}`;
    peakTrafficMap.set(trafficKey, (peakTrafficMap.get(trafficKey) ?? 0) + 1);

    for (const tool of toolCalls) {
      toolCounts.set(tool.name, (toolCounts.get(tool.name) ?? 0) + 1);

      const durations = toolDurations.get(tool.name) ?? [];
      if (Number.isFinite(tool.durationMs)) {
        durations.push(tool.durationMs);
      }
      toolDurations.set(tool.name, durations);

      if (tool.isError) {
        toolErrors.set(tool.name, (toolErrors.get(tool.name) ?? 0) + 1);
        continue;
      }
      if (!isSuccessfulToolAction(tool)) {
        continue;
      }

      if (tool.name === "transfer_call") transferred = true;
      if (tool.name === "book_appt") booked = Math.max(booked, 1);
      if (tool.name === "confirm_appt") confirmed = Math.max(confirmed, 1);
      if (tool.name === "cancel_appt") cancelled = Math.max(cancelled, 1);
    }

    if (transferred) {
      transferCount++;
      bucket.transfers++;
    }

    bookApptSuccesses += booked;
    confirmApptSuccesses += confirmed;
    cancelApptSuccesses += cancelled;
    bucket.booked += booked;
    bucket.confirmed += confirmed;
    bucket.cancelled += cancelled;
  }

  const sortedBuckets = [...bucketInfos].sort((a, b) => a.sort - b.sort);
  const callVolumeTrendData = sortedBuckets.map((bucket) => ({
    count: buckets.get(bucket.key)?.calls ?? 0,
    label: bucket.label,
    tooltipLabel: bucket.tooltipLabel,
  }));
  const transferTrendData = sortedBuckets.map((bucket) => {
    const data = buckets.get(bucket.key) ?? createEmptyAnalyticsBucket();

    return {
      calls: data.calls,
      label: bucket.label,
      rate: data.calls > 0 ? (data.transfers / data.calls) * 100 : 0,
      tooltipLabel: bucket.tooltipLabel,
      transfers: data.transfers,
    };
  });
  const actionTrendData = sortedBuckets.map((bucket) => {
    const data = buckets.get(bucket.key) ?? createEmptyAnalyticsBucket();

    return {
      booked: data.booked,
      cancelled: data.cancelled,
      confirmed: data.confirmed,
      label: bucket.label,
      tooltipLabel: bucket.tooltipLabel,
    };
  });
  const interruptionRateTrendData = sortedBuckets.map((bucket) => {
    const data = buckets.get(bucket.key) ?? createEmptyAnalyticsBucket();

    return {
      calls: data.calls,
      count: data.interruptions,
      label: bucket.label,
      rate: data.calls > 0 ? (data.interruptions / data.calls) * 100 : 0,
      tooltipLabel: bucket.tooltipLabel,
    };
  });
  const tokenTrendData = sortedBuckets.map((bucket) => {
    const data = buckets.get(bucket.key) ?? createEmptyAnalyticsBucket();

    return {
      cached: data.cachedTokens,
      input: data.inputTokens,
      label: bucket.label,
      output: data.outputTokens,
      tooltipLabel: bucket.tooltipLabel,
    };
  });
  const cacheEfficiencyTrendData = sortedBuckets.map((bucket) => {
    const data = buckets.get(bucket.key) ?? createEmptyAnalyticsBucket();

    return {
      cached: data.cachedTokens,
      input: data.inputTokens,
      label: bucket.label,
      rate: data.inputTokens > 0 ? (data.cachedTokens / data.inputTokens) * 100 : 0,
      tooltipLabel: bucket.tooltipLabel,
    };
  });
  const peakContextTrendData = sortedBuckets.map((bucket) => ({
    label: bucket.label,
    peak: buckets.get(bucket.key)?.peakContext ?? 0,
    tooltipLabel: bucket.tooltipLabel,
  }));
  const peakTrafficData: AdminPracticeAnalyticsData["peakTrafficData"] = [];

  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    for (let hour = 0; hour < 24; hour++) {
      const count = peakTrafficMap.get(`${day}-${hour}`) ?? 0;
      if (count > 0) {
        peakTrafficData.push({ count, day, hour });
      }
    }
  }

  const toolUsageData = [...toolCounts.entries()]
    .map(([tool, count]) => ({ count, tool }))
    .sort((a, b) => b.count - a.count);
  const toolErrorRateData = [...toolCounts.entries()]
    .map(([tool, total]) => {
      const errors = toolErrors.get(tool) ?? 0;

      return {
        errorRate: total > 0 ? (errors / total) * 100 : 0,
        errors,
        tool,
        total,
      };
    })
    .sort((a, b) => {
      const rateDiff = b.errorRate - a.errorRate;
      return Math.abs(rateDiff) > 0.001 ? rateDiff : b.errors - a.errors;
    });
  const toolDurationData = [...toolDurations.entries()]
    .map(([tool, values]) => ({
      avgMs: average(values),
      p95Ms: percentile(values, 95),
      tool,
    }))
    .sort((a, b) => b.p95Ms - a.p95Ms);

  return {
    actionTrendData,
    avgCacheHitRate: totalInputTokens > 0 ? totalCachedTokens / totalInputTokens : 0,
    avgDurationSec: calls.length > 0 ? totalDurationSec / calls.length : 0,
    avgTokensPerSec: average(allTokensPerSec),
    bookApptSuccesses,
    cacheEfficiencyTrendData,
    callVolumeTrendData,
    cancelApptSuccesses,
    confirmApptSuccesses,
    durationDistributionData: DURATION_BUCKETS.map((bucket, index) => ({
      bucket: bucket.label,
      count: bucketCounts[index] ?? 0,
    })),
    interruptionRateTrendData,
    peakContextTrendData,
    peakTrafficData,
    pipelineP50: {
      llm: allTtftValues.length > 0 ? percentile(allTtftValues, 50) : null,
      stt: allSttValues.length > 0 ? percentile(allSttValues, 50) : null,
      total:
        allTotalLatencyValues.length > 0 ? percentile(allTotalLatencyValues, 50) : null,
      tts: allTtsValues.length > 0 ? percentile(allTtsValues, 50) : null,
    },
    sttLatencyTrendData: sortedBuckets.map((bucket) =>
      percentileDatum(bucket, buckets.get(bucket.key)?.sttValues ?? []),
    ),
    tokenTrendData,
    toolDurationData,
    toolErrorRateData,
    toolUsageData,
    totalCachedTokens,
    totalCalls: calls.length,
    totalDurationSec,
    totalInputTokens,
    totalInterruptions,
    totalLatencyTrendData: sortedBuckets.map((bucket) =>
      percentileDatum(bucket, buckets.get(bucket.key)?.totalLatencyValues ?? []),
    ),
    totalOutputTokens,
    totalTtsChars,
    totalToolCalls,
    totalToolErrors,
    transferCount,
    transferTrendData,
    trendGranularityLabel: getGranularityLabel(granularity),
    ttsLatencyTrendData: sortedBuckets.map((bucket) =>
      percentileDatum(bucket, buckets.get(bucket.key)?.ttsValues ?? []),
    ),
    ttftLatencyTrendData: sortedBuckets.map((bucket) =>
      percentileDatum(bucket, buckets.get(bucket.key)?.ttftValues ?? []),
    ),
  };
}

function buildPracticeDashboardData(
  calls: AdminCallRecord[],
): AdminPracticeDashboardData {
  let totalDurationSec = 0;
  let totalPeakContext = 0;
  let totalCacheHitRate = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let totalTtsChars = 0;
  let totalInterruptions = 0;
  let bookApptSuccesses = 0;
  let confirmApptSuccesses = 0;
  let cancelApptSuccesses = 0;
  let toolCallCount = 0;
  let toolFailureCount = 0;
  let transferCount = 0;

  const allTtftValues: number[] = [];
  const allTtsValues: number[] = [];
  const allTotalLatencyValues: number[] = [];
  const allTokensPerSec: number[] = [];

  for (const call of calls) {
    const tools = getToolCalls(call.data);
    const latency = getLatencyArrays(call);
    const callToolCalls = tools.length > 0 ? tools.length : call.toolCalls;
    const callToolErrors =
      tools.length > 0 ? tools.filter((tool) => tool.isError).length : call.toolErrors;
    let booked = call.bookedAppointment ? 1 : 0;
    let confirmed = call.confirmedAppointment ? 1 : 0;
    let cancelled = call.cancelledAppointment ? 1 : 0;
    let transferred = call.transferred;

    for (const tool of tools) {
      if (tool.isError) {
        continue;
      }
      if (!isSuccessfulToolAction(tool)) {
        continue;
      }

      if (tool.name === "book_appt") booked = Math.max(booked, 1);
      if (tool.name === "confirm_appt") confirmed = Math.max(confirmed, 1);
      if (tool.name === "cancel_appt") cancelled = Math.max(cancelled, 1);
      if (tool.name === "transfer_call") transferred = true;
    }

    totalDurationSec += call.durationSec;
    totalPeakContext += getPeakContext(call);
    totalCacheHitRate += getCacheHitRate(call);
    totalInputTokens += call.inputTokens;
    totalOutputTokens += call.outputTokens;
    totalCachedTokens += call.cachedTokens;
    totalTtsChars += call.ttsChars;
    totalInterruptions += call.interruptionCount;
    bookApptSuccesses += booked;
    confirmApptSuccesses += confirmed;
    cancelApptSuccesses += cancelled;
    toolCallCount += callToolCalls;
    toolFailureCount += callToolErrors;
    transferCount += transferred ? 1 : 0;

    if (call.avgTokensPerSec > 0) {
      allTokensPerSec.push(call.avgTokensPerSec);
    }

    allTtftValues.push(...latency.ttft);
    allTtsValues.push(...latency.tts);
    allTotalLatencyValues.push(...latency.total);
  }

  return {
    avgCacheHitRate: calls.length > 0 ? totalCacheHitRate / calls.length : 0,
    avgDurationSec: calls.length > 0 ? totalDurationSec / calls.length : 0,
    avgInputTokens: calls.length > 0 ? totalInputTokens / calls.length : 0,
    avgOutputTokens: calls.length > 0 ? totalOutputTokens / calls.length : 0,
    avgPeakContext: calls.length > 0 ? totalPeakContext / calls.length : 0,
    avgTokensPerSec: average(allTokensPerSec),
    avgTtsChars: calls.length > 0 ? totalTtsChars / calls.length : 0,
    bookApptSuccesses,
    cancelApptSuccesses,
    confirmApptSuccesses,
    toolCallCount,
    toolFailureCount,
    totalCachedTokens,
    totalCalls: calls.length,
    totalDurationSec,
    totalInputTokens,
    totalInterruptions,
    totalLatencyPercentiles: computePercentiles(allTotalLatencyValues),
    totalOutputTokens,
    transferCount,
    ttftPercentiles: computePercentiles(allTtftValues),
    ttsttfbPercentiles: computePercentiles(allTtsValues),
  };
}

function buildRecentCall(call: AdminCallRecord) {
  return {
    actions: getToolActionLabels(call),
    cacheHitRate: getCacheHitRate(call),
    callerPhone: call.callerPhone,
    durationSec: call.durationSec,
    estimatedCostMicros: call.estimatedCostMicros,
    fallbackUsed: call.fallbackUsed,
    id: call.id,
    llmModel: call.llmModel,
    needsReview: call.needsReview,
    officePhone: call.officePhone,
    outcomeSummary: call.outcomeSummary,
    reviewAverageScore: getReviewAverage(call),
    reviewStatus: call.reviewStatus,
    startedAt: call.startedAt,
    status: call.status,
    toolCalls: call.toolCalls || getToolCalls(call.data).length,
    toolErrors: call.toolErrors,
    totalTurns: getCallTotalTurns(call),
    transferred: call.transferred,
  };
}

function normalizePhoneKey(phone: string | null | undefined) {
  return phone?.replace(/\D/g, "") ?? "";
}

function phoneLookupVariants(phone: string | null | undefined) {
  const variants = new Set<string>();
  const trimmed = phone?.trim() ?? "";
  const digits = normalizePhoneKey(trimmed);

  if (trimmed) variants.add(trimmed);

  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
  }

  if (digits.length === 10) {
    variants.add(`+1${digits}`);
    variants.add(`1${digits}`);
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    variants.add(digits.slice(1));
  }

  return [...variants].filter(Boolean);
}

function buildOfficeFilterOptions(
  phoneNumbers: Array<{
    label: string | null;
    locationId: string | null;
    location: { name: string } | null;
    phoneNumber: string;
  }>,
): AdminPracticeOfficeFilterOption[] {
  const optionsById = new Map<string, AdminPracticeOfficeFilterOption>();

  for (const phone of phoneNumbers) {
    const key = normalizePhoneKey(phone.phoneNumber);

    if (!key) {
      continue;
    }

    const id = phone.locationId ? `location:${phone.locationId}` : `phone:${key}`;
    const existing = optionsById.get(id);

    if (existing) {
      if (!existing.phones.some((item) => normalizePhoneKey(item) === key)) {
        existing.phones.push(phone.phoneNumber);
      }

      continue;
    }

    optionsById.set(id, {
      id,
      label: phone.location?.name ?? phone.label ?? phone.phoneNumber,
      phones: [phone.phoneNumber],
    });
  }

  return [...optionsById.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function resolveOfficeFilter(
  officeFilter: string | null | undefined,
  options: AdminPracticeOfficeFilterOption[],
) {
  const key = normalizePhoneKey(officeFilter);

  if (!officeFilter) {
    return null;
  }

  return (
    options.find(
      (option) =>
        option.id === officeFilter ||
        (key && option.phones.some((phone) => normalizePhoneKey(phone) === key)),
    ) ?? null
  );
}

function buildOfficeAgentCallWhere(
  officeFilter?: AdminPracticeOfficeFilterOption | null,
): Prisma.AgentCallWhereInput {
  const officeLocationId = officeFilter?.id.startsWith("location:")
    ? officeFilter.id.replace("location:", "")
    : null;
  const officePhoneVariants = [
    ...new Set((officeFilter?.phones ?? []).flatMap(phoneLookupVariants)),
  ];

  if (!officeLocationId && officePhoneVariants.length === 0) {
    return {};
  }

  return {
    OR: [
      ...(officeLocationId ? [{ locationId: officeLocationId }] : []),
      ...(officePhoneVariants.length > 0
        ? [{ officePhone: { in: officePhoneVariants } }]
        : []),
    ],
  };
}

function buildOfficeNameByPhone(
  phoneNumbers: Array<{
    label: string | null;
    location: { name: string } | null;
    phoneNumber: string;
  }>,
) {
  const officeNameByPhone = new Map<string, string>();

  for (const phone of phoneNumbers) {
    const key = normalizePhoneKey(phone.phoneNumber);
    const name = phone.location?.name ?? phone.label;

    if (key && name) {
      officeNameByPhone.set(key, name);
    }
  }

  return officeNameByPhone;
}

function buildCallTableRow(
  call: AdminCallRecord,
  officeNameByPhone: Map<string, string>,
): AdminCallTableRow {
  const latency = getLatencyArrays(call);
  const tools = getToolCalls(call.data);
  const toolActions = new Set<string>();

  for (const tool of tools) {
    toolActions.add(formatToolAction(tool.name));
  }

  const apptActions = getToolActionLabels(call);
  const reviewStatus = normalizeReviewStatus(call.reviewStatus);
  const reviewPassed = getReviewPassed(call.reviewResult);
  const reviewAverageScore = getReviewAverage(call);

  return {
    apptActions,
    avgTokensPerSec: call.avgTokensPerSec,
    cacheHitRate: getCacheHitRate(call),
    callId: call.callId,
    callerPhone: call.callerPhone,
    durationSec: call.durationSec,
    fallbackUsed: call.fallbackUsed,
    hasAudio: false,
    id: call.id,
    interruptionCount: call.interruptionCount,
    llmModel: call.llmModel ?? "",
    officeName:
      call.location?.name ??
      officeNameByPhone.get(normalizePhoneKey(call.officePhone)) ??
      null,
    officePhone: call.officePhone,
    p50TotalLatency: median(latency.total),
    p50Ttft: median(latency.ttft),
    p50Ttsttfb: median(latency.tts),
    peakContext: getPeakContext(call),
    reviewAverageScore,
    reviewNeedsAttention:
      call.needsReview ||
      reviewStatus === "failed" ||
      (reviewStatus === "completed" && reviewPassed === false),
    reviewPassed,
    reviewStatus,
    startedAt: call.startedAt.toISOString(),
    toolActions: [...toolActions],
    toolCalls: call.toolCalls || tools.length,
    toolErrors:
      tools.length > 0 ? tools.filter((tool) => tool.isError).length : call.toolErrors,
    totalTurns: getCallTotalTurns(call),
    transcriptText: extractTranscriptText(call.data),
    transferred: call.transferred || apptActions.includes("Transferred"),
  };
}

async function loadPracticeCalls(
  practiceId: string,
  range: AdminPracticeRange,
  officeFilter?: AdminPracticeOfficeFilterOption | null,
) {
  const rangeStart = getRangeStart(range);
  const officeWhere = buildOfficeAgentCallWhere(officeFilter);

  return prisma.agentCall.findMany({
    orderBy: {
      startedAt: "desc",
    },
    select: {
      avgTokensPerSec: true,
      avgTtft: true,
      avgTtsttfb: true,
      bookedAppointment: true,
      cacheHitRate: true,
      cachedTokens: true,
      callId: true,
      callerPhone: true,
      cancelledAppointment: true,
      confirmedAppointment: true,
      data: true,
      durationSec: true,
      estimatedCostMicros: true,
      fallbackUsed: true,
      id: true,
      inputTokens: true,
      interruptionCount: true,
      latencyValues: true,
      llmModel: true,
      location: {
        select: {
          name: true,
        },
      },
      needsReview: true,
      officePhone: true,
      outcomeSummary: true,
      outputTokens: true,
      peakContext: true,
      practiceId: true,
      reviewAverageScore: true,
      reviewResult: true,
      reviewStatus: true,
      startedAt: true,
      status: true,
      toolCalls: true,
      toolErrors: true,
      ttsChars: true,
      totalTurns: true,
      transferred: true,
    },
    where: {
      practiceId,
      ...(rangeStart ? { startedAt: { gte: rangeStart } } : {}),
      ...officeWhere,
    },
  });
}

export async function getAdminPracticeSummaries() {
  const since30 = sinceDays(30);
  const since7 = sinceDays(7);
  const since1 = sinceDays(1);

  const [practices, calls] = await Promise.all([
    prisma.practice.findMany({
      include: {
        agents: {
          orderBy: {
            createdAt: "desc",
          },
        },
        phoneNumbers: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
      },
      orderBy: {
        name: "asc",
      },
    }),
    prisma.agentCall.findMany({
      orderBy: {
        startedAt: "desc",
      },
      select: {
        bookedAppointment: true,
        cancelledAppointment: true,
        confirmedAppointment: true,
        durationSec: true,
        estimatedCostMicros: true,
        needsReview: true,
        practiceId: true,
        startedAt: true,
        status: true,
        transferred: true,
      },
      where: {
        startedAt: {
          gte: since30,
        },
      },
    }),
  ]);

  const calls24 = countCallsByPractice(calls, since1);
  const calls7 = countCallsByPractice(calls, since7);
  const costs7 = sumCostByPractice(calls, since7);
  const reviewCounts = needsReviewByPractice(calls);
  const latestCalls = latestCallByPractice(calls);

  return practices.map((practice) => {
    const agentStatus = getAgentStatus(practice.agents);
    const primaryPhone =
      practice.phoneNumbers.find((phone) => phone.isPrimary) ?? practice.phoneNumbers[0];
    const lastCall = latestCalls.get(practice.id);

    return {
      agentCount: practice.agents.length,
      agentStatus,
      calls24h: calls24.get(practice.id) ?? 0,
      calls7d: calls7.get(practice.id) ?? 0,
      cost7dMicros: costs7.get(practice.id) ?? 0,
      id: practice.id,
      lastCallAt: lastCall?.startedAt ?? null,
      launchedAt: practice.launchedAt,
      needsReviewCount: reviewCounts.get(practice.id) ?? 0,
      onboardingStatus: practice.onboardingStatus,
      phoneNumber: primaryPhone?.phoneNumber ?? null,
      practiceType: practice.practiceType,
      name: practice.name,
    };
  });
}

export async function getAdminPracticeDetail(
  practiceId: string,
  range: AdminPracticeRange = "7d",
  office?: string | null,
) {
  const rangeStart = getRangeStart(range);

  const practice = await prisma.practice.findUnique({
    include: {
      agents: {
        orderBy: {
          createdAt: "desc",
        },
      },
      locations: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
      memberships: {
        include: {
          user: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
      phoneNumbers: {
        include: {
          location: true,
        },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    },
    where: {
      id: practiceId,
    },
  });

  if (!practice) {
    return null;
  }

  const officeFilters = buildOfficeFilterOptions(practice.phoneNumbers);
  const selectedOffice = resolveOfficeFilter(office, officeFilters);
  const officeWhere = buildOfficeAgentCallWhere(selectedOffice);
  const costOfficeWhere: Prisma.UsageCostLineItemWhereInput = selectedOffice
    ? {
        agentCall: {
          is: {
            practiceId,
            ...officeWhere,
          },
        },
      }
    : {};

  const [calls, costLineItems] = await Promise.all([
    loadPracticeCalls(practiceId, range, selectedOffice),
    prisma.usageCostLineItem.findMany({
      orderBy: {
        occurredAt: "desc",
      },
      select: {
        category: true,
        costMicros: true,
        occurredAt: true,
      },
      where: {
        ...(rangeStart ? { occurredAt: { gte: rangeStart } } : {}),
        ...costOfficeWhere,
        practiceId,
      },
    }),
  ]);

  const costByCategory = new Map<CostCategory, number>();
  const latency = {
    stt: [] as number[],
    total: [] as number[],
    tts: [] as number[],
    ttft: [] as number[],
  };
  const reviewScores: number[] = [];
  let bookedAppointments = 0;
  let cancelledAppointments = 0;
  let confirmedAppointments = 0;
  let totalDurationSec = 0;
  let totalToolCalls = 0;
  let totalToolErrors = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let totalInterruptions = 0;
  let fallbackCalls = 0;
  let totalCacheHitRate = 0;
  let maxPeakContext = 0;

  for (const item of costLineItems) {
    addMapValue(costByCategory, item.category, item.costMicros);
  }

  for (const call of calls) {
    const callLatency = getLatencyArrays(call);
    latency.stt.push(...callLatency.stt);
    latency.total.push(...callLatency.total);
    latency.tts.push(...callLatency.tts);
    latency.ttft.push(...callLatency.ttft);

    const reviewAverage = getReviewAverage(call);
    if (typeof reviewAverage === "number") {
      reviewScores.push(reviewAverage);
    }

    bookedAppointments += call.bookedAppointment ? 1 : 0;
    confirmedAppointments += call.confirmedAppointment ? 1 : 0;
    cancelledAppointments += call.cancelledAppointment ? 1 : 0;
    totalDurationSec += call.durationSec;
    totalToolCalls += call.toolCalls || getToolCalls(call.data).length;
    totalToolErrors += call.toolErrors;
    totalInputTokens += call.inputTokens;
    totalOutputTokens += call.outputTokens;
    totalCachedTokens += call.cachedTokens;
    totalInterruptions += call.interruptionCount;
    fallbackCalls += call.fallbackUsed ? 1 : 0;
    totalCacheHitRate += getCacheHitRate(call);
    maxPeakContext = Math.max(maxPeakContext, getPeakContext(call));
  }

  const transfers = calls.filter((call) => call.transferred).length;
  const needsReview = calls.filter((call) => call.needsReview);
  const failedCalls = calls.filter((call) => call.status === "FAILED");
  const estimatedCostMicros = calls.reduce(
    (sum, call) => sum + call.estimatedCostMicros,
    0,
  );
  const appointments = bookedAppointments + confirmedAppointments + cancelledAppointments;
  const officeNameByPhone = buildOfficeNameByPhone(practice.phoneNumbers);

  return {
    agentStatus: getAgentStatus(practice.agents),
    analytics: {
      costByCategory: [...costByCategory.entries()]
        .map(([category, costMicros]) => ({ category, costMicros }))
        .sort((a, b) => b.costMicros - a.costMicros),
      latency: {
        sttP50: percentile(latency.stt, 50),
        sttP95: percentile(latency.stt, 95),
        totalP50: percentile(latency.total, 50),
        totalP95: percentile(latency.total, 95),
        ttsP50: percentile(latency.tts, 50),
        ttsP95: percentile(latency.tts, 95),
        ttftP50: percentile(latency.ttft, 50),
        ttftP95: percentile(latency.ttft, 95),
      },
      peakTraffic: buildPeakTraffic(calls),
      reviewQueue: calls
        .filter((call) => call.needsReview || call.reviewStatus === "failed")
        .slice(0, 12)
        .map((call) => ({
          ...buildRecentCall(call),
          reviewSummary: getReviewSummary(call),
        })),
      toolStats: buildToolStats(calls),
      trendBuckets: buildTrendBuckets(calls, range),
    },
    analyticsData: buildPracticeAnalyticsData(calls, range),
    callRows: calls.map((call) => buildCallTableRow(call, officeNameByPhone)),
    dashboardData: buildPracticeDashboardData(calls),
    officeFilters,
    practice,
    range,
    recentCalls: calls.slice(0, 30).map(buildRecentCall),
    selectedOfficeId: selectedOffice?.id ?? null,
    stats: {
      appointments,
      avgCacheHitRate: calls.length > 0 ? totalCacheHitRate / calls.length : 0,
      avgDurationSec: calls.length > 0 ? totalDurationSec / calls.length : 0,
      avgReviewScore: average(reviewScores),
      bookedAppointments,
      cancelledAppointments,
      calls: calls.length,
      confirmedAppointments,
      costPerCallMicros: calls.length > 0 ? estimatedCostMicros / calls.length : 0,
      estimatedCostMicros,
      failedCalls: failedCalls.length,
      fallbackCalls,
      maxPeakContext,
      needsReview: needsReview.length,
      reviewCompleted: reviewScores.length,
      totalCachedTokens,
      totalDurationSec,
      totalInputTokens,
      totalInterruptions,
      totalOutputTokens,
      totalToolCalls,
      totalToolErrors,
      transferRate: calls.length > 0 ? transfers / calls.length : 0,
      transfers,
    },
  };
}

export async function getAdminCallDetail(practiceId: string, callId: string) {
  return prisma.agentCall.findFirst({
    include: {
      agent: true,
      costLineItems: {
        orderBy: {
          costMicros: "desc",
        },
      },
      location: true,
      practice: true,
    },
    where: {
      practiceId,
      OR: [{ id: callId }, { callId }],
    },
  });
}
