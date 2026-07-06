import type {
  SessionEventAnalytics,
  ToolCallRecord,
  ToolExecutionAnalytics,
  TurnRecord,
  VoiceLanguageTelemetry,
} from "@/lib/call-types";
import type { AgentCallEvaluationBucket, Prisma } from "@/generated/prisma/client";
import {
  appointmentActionFromOutputClass,
  appointmentActionFromToolName,
  getAppointmentActions,
  isResolvedAppointmentAction,
} from "@/lib/appointment-actions";
import { phoneDigits, phoneLookupVariants } from "@/lib/phone";
import {
  extractBookedAppointment,
  summarizeBookingCategories,
  type PortalBookingCategorySummary,
} from "@/lib/portal-overview";
import {
  CALL_TABLE_PAGE_SIZE,
  DEFAULT_CALL_TABLE_STATE,
  clampCallTablePage,
  getCallTablePageCount,
  getCallTableToolActionLabels,
  normalizeCallSearchValue,
  type CallQuickFilter,
  type CallSortState,
  type CallTableState,
} from "@/lib/admin-call-table-state";
import { prisma } from "@/lib/prisma";
import { isSuccessfulToolAction } from "@/lib/tool-action-status";

type AgentStatus = "SETUP" | "ACTIVE" | "PAUSED" | "ERROR";

export type AdminPracticeRange = "24h" | "7d" | "30d" | "all";

type CallMetric = {
  durationSec: number;
  estimatedCostMicros: number;
  practiceId: string;
  startedAt: Date;
  status: string;
  transferred: boolean;
};

type AdminCallRecord = Awaited<ReturnType<typeof loadPracticeCalls>>[number];
export type AdminPracticeCallSet = "all" | "bad" | "golden";

export type AdminPracticeDetailOptions = {
  callSet?: AdminPracticeCallSet;
  includeAnalytics?: boolean;
  includeDashboard?: boolean;
  includeTable?: boolean;
  tableState?: CallTableState;
};

type AdminCallLiteRecord = {
  avgTokensPerSec: number;
  avgTtft: number;
  avgTtsttfb: number;
  bookedAppointment: boolean;
  cacheHitRate: number;
  cachedTokens: number;
  callId: string;
  callerPhone: string;
  cancelledAppointment: boolean;
  data?: unknown;
  durationSec: number;
  evaluationLabels?: Array<{
    bucket: AgentCallEvaluationBucket;
    comment: string | null;
  }>;
  fallbackUsed: boolean;
  id: string;
  inputTokens: number;
  interruptionCount: number;
  latencyValues: unknown;
  llmModel: string | null;
  location: { name: string } | null;
  officePhone: string;
  outcomeSummary: string | null;
  outputTokens: number;
  peakContext: number;
  startedAt: Date;
  toolCalls: number;
  toolErrors: number;
  totalTurns: number;
  transferred: boolean;
  ttsChars: number;
};

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

const HIDDEN_ADMIN_TOOL_NAMES = new Set(["confirm_appt"]);

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
  bookingCategories: PortalBookingCategorySummary;
  cancelApptSuccesses: number;
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
  evaluationBucket: AgentCallEvaluationBucket | null;
  evaluationComment: string | null;
  fallbackUsed: boolean;
  acceptedLanguages: string[];
  closeReason: string | null;
  currentLanguage: string | null;
  hasAudio: boolean;
  id: string;
  interruptionCount: number;
  falseInterruptionCount: number;
  languageChanged: boolean;
  llmModel: string;
  officeName: string | null;
  officePhone: string;
  overlappingSpeechCount: number;
  p50TotalLatency: number;
  p50Ttft: number;
  p50Ttsttfb: number;
  peakContext: number;
  startedAt: string;
  runtimeErrorCount: number;
  toolActions: string[];
  toolCalls: number;
  toolErrors: number;
  totalTurns: number;
  transferred: boolean;
}

export interface AdminCallTableResult {
  hasLanguageSignals: boolean;
  hasToolErrors: boolean;
  pageCount: number;
  rows: AdminCallTableRow[];
  state: CallTableState;
  totalCount: number;
}

export interface AdminCallNavigation {
  nextCall: { id: string } | null;
  previousCall: { id: string } | null;
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

function getToolExecutions(data: unknown): ToolExecutionAnalytics[] {
  if (!isRecord(data) || !Array.isArray(data.toolExecutions)) {
    return [];
  }

  return data.toolExecutions.filter(isRecord).map((tool) => ({
    ...(typeof tool.callId === "string" ? { callId: tool.callId } : {}),
    ...(typeof tool.createdAt === "string" ? { createdAt: tool.createdAt } : {}),
    ...(typeof tool.outputClass === "string" ? { outputClass: tool.outputClass } : {}),
    ...(tool.status === "success" || tool.status === "error"
      ? { status: tool.status }
      : {}),
    ...(typeof tool.toolName === "string" ? { toolName: tool.toolName } : {}),
  }));
}

function getLanguageTelemetry(data: unknown): VoiceLanguageTelemetry | null {
  if (!isRecord(data) || !isRecord(data.language)) {
    return null;
  }

  return data.language as VoiceLanguageTelemetry;
}

function getSessionEvents(data: unknown): SessionEventAnalytics | null {
  if (!isRecord(data) || !isRecord(data.sessionEvents)) {
    return null;
  }

  return data.sessionEvents as SessionEventAnalytics;
}

function getObservabilitySignals(data: unknown) {
  const language = getLanguageTelemetry(data);
  const sessionEvents = getSessionEvents(data);
  const errors = Array.isArray(sessionEvents?.errors) ? sessionEvents.errors : [];
  const falseInterruptions = Array.isArray(sessionEvents?.falseInterruptions)
    ? sessionEvents.falseInterruptions
    : [];
  const overlappingSpeech = Array.isArray(sessionEvents?.overlappingSpeech)
    ? sessionEvents.overlappingSpeech
    : [];

  return {
    acceptedLanguages: Array.isArray(language?.acceptedLanguages)
      ? language.acceptedLanguages.filter(
          (item): item is string => typeof item === "string" && item.length > 0,
        )
      : [],
    closeReason:
      typeof sessionEvents?.close?.reason === "string"
        ? sessionEvents.close.reason
        : null,
    currentLanguage:
      typeof language?.currentLanguage === "string" ? language.currentLanguage : null,
    falseInterruptionCount: falseInterruptions.length,
    languageChanged: language?.languageChanged === true,
    overlappingSpeechCount: overlappingSpeech.length,
    runtimeErrorCount: errors.length,
  };
}

function addAppointmentActionLabel(
  labels: Set<string>,
  action: "booked" | "rescheduled" | "cancelled",
) {
  if (action === "booked") labels.add("Booked");
  if (action === "rescheduled") {
    labels.add("Booked");
    labels.add("Cancelled");
    labels.add("Rescheduled");
  }
  if (action === "cancelled") labels.add("Cancelled");
}

function getToolActionLabels(call: {
  bookedAppointment: boolean;
  cancelledAppointment: boolean;
  data?: unknown;
  transferred: boolean;
}) {
  const actions = new Set<string>();

  if (call.bookedAppointment) actions.add("Booked");
  if (call.cancelledAppointment) actions.add("Cancelled");
  if (call.transferred) actions.add("Transferred");

  for (const action of getAppointmentActions(call.data)) {
    if (isResolvedAppointmentAction(action)) {
      addAppointmentActionLabel(actions, action.action);
    }
  }

  for (const tool of getToolCalls(call.data)) {
    if (!isSuccessfulToolAction(tool)) {
      continue;
    }

    const appointmentAction = appointmentActionFromToolName(tool.name);
    if (appointmentAction) addAppointmentActionLabel(actions, appointmentAction);
    if (tool.name === "transfer_call") actions.add("Transferred");
  }

  for (const tool of getToolExecutions(call.data)) {
    if (tool.status !== "success") {
      continue;
    }

    const appointmentAction = appointmentActionFromOutputClass(tool.outputClass);
    if (appointmentAction) addAppointmentActionLabel(actions, appointmentAction);
    if (tool.outputClass === "transfer_started") actions.add("Transferred");
  }

  return [...actions];
}

function isAdminVisibleToolName(name: string | null | undefined) {
  return Boolean(name && !HIDDEN_ADMIN_TOOL_NAMES.has(name));
}

function median(values: number[]) {
  return percentile(values, 50);
}

function getLatencyArrays(call: {
  avgTtft: number;
  avgTtsttfb: number;
  data?: unknown;
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
    const turnEou = asNumber(turn.endOfTurnDelayMs);
    const turnTtft = asNumber(turn.ttftMs);
    const turnTts = asNumber(turn.ttsttfbMs);
    const turnTotal =
      asNumber(turn.totalLatencyMs) ||
      (turnEou > 0 && turnTtft > 0 ? turnEou + turnTtft + turnTts : 0);

    if (turn.sttLatencyMeasured || turnStt > 0) stt.push(turnStt);
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

function getCallTotalTurns(call: { data?: unknown; totalTurns: number }) {
  if (call.totalTurns > 0) {
    return call.totalTurns;
  }

  return getTurns(call.data).filter((turn) => turn.callerText).length;
}

function getCacheHitRate(call: {
  cachedTokens: number;
  cacheHitRate: number;
  data?: unknown;
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

function getPeakContext(call: { data?: unknown; peakContext: number }) {
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

    const toolExecutions = getToolExecutions(call.data);
    const toolCalls = getToolCalls(call.data);
    const visibleToolExecutions = toolExecutions.filter((tool) =>
      isAdminVisibleToolName(tool.toolName),
    );
    const visibleToolCalls = toolCalls.filter((tool) =>
      isAdminVisibleToolName(tool.name),
    );
    const callToolCalls =
      toolExecutions.length > 0
        ? visibleToolExecutions.length
        : toolCalls.length > 0
          ? visibleToolCalls.length
          : call.toolCalls;
    const callToolErrors =
      toolExecutions.length > 0
        ? visibleToolExecutions.filter((tool) => tool.status === "error").length
        : toolCalls.length > 0
          ? visibleToolCalls.filter((tool) => tool.isError).length
          : call.toolErrors;
    const latencyValues = getLatencyArrays(call);
    const peakContext = getPeakContext(call);

    let booked = call.bookedAppointment ? 1 : 0;
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

    for (const tool of visibleToolCalls) {
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

      const appointmentAction = appointmentActionFromToolName(tool.name);
      if (tool.name === "transfer_call") transferred = true;
      if (appointmentAction === "booked") booked = Math.max(booked, 1);
      if (appointmentAction === "rescheduled") {
        booked = Math.max(booked, 1);
        cancelled = Math.max(cancelled, 1);
      }
      if (appointmentAction === "cancelled") cancelled = Math.max(cancelled, 1);
    }

    if (transferred) {
      transferCount++;
      bucket.transfers++;
    }

    bookApptSuccesses += booked;
    cancelApptSuccesses += cancelled;
    bucket.booked += booked;
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
  calls: AdminCallLiteRecord[],
  bookingCategories?: PortalBookingCategorySummary,
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
  let cancelApptSuccesses = 0;
  let toolCallCount = 0;
  let toolFailureCount = 0;
  let transferCount = 0;

  const allTtftValues: number[] = [];
  const allTtsValues: number[] = [];
  const allTotalLatencyValues: number[] = [];
  const allTokensPerSec: number[] = [];

  for (const call of calls) {
    const toolExecutions = getToolExecutions(call.data);
    const tools = getToolCalls(call.data);
    const visibleToolExecutions = toolExecutions.filter((tool) =>
      isAdminVisibleToolName(tool.toolName),
    );
    const visibleTools = tools.filter((tool) => isAdminVisibleToolName(tool.name));
    const latency = getLatencyArrays(call);
    const callToolCalls =
      toolExecutions.length > 0
        ? visibleToolExecutions.length
        : tools.length > 0
          ? visibleTools.length
          : call.toolCalls;
    const callToolErrors =
      toolExecutions.length > 0
        ? visibleToolExecutions.filter((tool) => tool.status === "error").length
        : tools.length > 0
          ? visibleTools.filter((tool) => tool.isError).length
          : call.toolErrors;
    let booked = call.bookedAppointment ? 1 : 0;
    let cancelled = call.cancelledAppointment ? 1 : 0;
    let transferred = call.transferred;

    for (const tool of visibleTools) {
      if (tool.isError) {
        continue;
      }
      if (!isSuccessfulToolAction(tool)) {
        continue;
      }

      const appointmentAction = appointmentActionFromToolName(tool.name);
      if (appointmentAction === "booked") booked = Math.max(booked, 1);
      if (appointmentAction === "rescheduled") {
        booked = Math.max(booked, 1);
        cancelled = Math.max(cancelled, 1);
      }
      if (appointmentAction === "cancelled") cancelled = Math.max(cancelled, 1);
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
    bookingCategories:
      bookingCategories ??
      summarizeBookingCategories(
        calls
          .filter((call) => call.bookedAppointment)
          .map((call) =>
            extractBookedAppointment({
              callerPhone: call.callerPhone,
              data: call.data,
              id: call.id,
              outcomeSummary: call.outcomeSummary,
              startedAt: call.startedAt,
            }),
          ),
      ),
    cancelApptSuccesses,
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
    const key = phoneDigits(phone.phoneNumber);

    if (!key) {
      continue;
    }

    const id = phone.locationId ? `location:${phone.locationId}` : `phone:${key}`;
    const existing = optionsById.get(id);

    if (existing) {
      if (!existing.phones.some((item) => phoneDigits(item) === key)) {
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
  const key = phoneDigits(officeFilter);

  if (!officeFilter) {
    return null;
  }

  return (
    options.find(
      (option) =>
        option.id === officeFilter ||
        (key && option.phones.some((phone) => phoneDigits(phone) === key)),
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
    const key = phoneDigits(phone.phoneNumber);
    const name = phone.location?.name ?? phone.label;

    if (key && name) {
      officeNameByPhone.set(key, name);
    }
  }

  return officeNameByPhone;
}

function hasWhereClause(where: Prisma.AgentCallWhereInput) {
  return Object.keys(where).length > 0;
}

function andAgentCallWhere(
  ...clauses: Array<Prisma.AgentCallWhereInput | null | undefined>
): Prisma.AgentCallWhereInput {
  const activeClauses = clauses.filter((clause): clause is Prisma.AgentCallWhereInput =>
    Boolean(clause && hasWhereClause(clause)),
  );

  if (activeClauses.length === 0) {
    return {};
  }

  if (activeClauses.length === 1) {
    return activeClauses[0] ?? {};
  }

  return { AND: activeClauses };
}

function buildCallSetWhere(callSet: AdminPracticeCallSet): Prisma.AgentCallWhereInput {
  if (callSet === "bad") {
    return {
      evaluationLabels: {
        some: {
          bucket: "BAD",
        },
      },
    };
  }

  if (callSet === "golden") {
    return {
      evaluationLabels: {
        some: {
          bucket: "GOLDEN",
        },
      },
    };
  }

  return {};
}

function buildLanguageSignalWhere(): Prisma.AgentCallWhereInput {
  return {
    OR: [
      {
        data: {
          equals: true,
          path: ["language", "languageChanged"],
        },
      },
      {
        data: {
          mode: "insensitive",
          not: "en",
          path: ["language", "currentLanguage"],
          string_contains: "",
        },
      },
      {
        AND: [
          {
            data: {
              array_contains: [],
              path: ["language", "acceptedLanguages"],
            },
          },
          {
            NOT: [
              {
                data: {
                  equals: [],
                  path: ["language", "acceptedLanguages"],
                },
              },
              {
                data: {
                  equals: ["en"],
                  path: ["language", "acceptedLanguages"],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildCallQuickFilterWhere(
  quickFilter: CallQuickFilter,
): Prisma.AgentCallWhereInput {
  switch (quickFilter) {
    case "booking":
      return { bookedAppointment: true };
    case "errors":
      return { toolErrors: { gt: 0 } };
    case "fallback":
      return { fallbackUsed: true };
    case "language":
      return buildLanguageSignalWhere();
    case "transfers":
      return { transferred: true };
    case "all":
    case "runtime":
      return {};
  }
}

function buildCallSearchWhere(searchQuery: string): Prisma.AgentCallWhereInput {
  const query = normalizeCallSearchValue(searchQuery);

  if (!query) {
    return {};
  }

  const phoneQuery = phoneDigits(query);
  const textSearch = {
    contains: query,
    mode: "insensitive" as const,
  };
  const clauses: Prisma.AgentCallWhereInput[] = [
    { callId: textSearch },
    { callerPhone: textSearch },
    { officePhone: textSearch },
    { llmModel: textSearch },
    { outcomeSummary: textSearch },
    {
      location: {
        is: {
          name: textSearch,
        },
      },
    },
    {
      evaluationLabels: {
        some: {
          comment: textSearch,
        },
      },
    },
  ];

  if (phoneQuery) {
    clauses.push(
      { callerPhone: { contains: phoneQuery } },
      { officePhone: { contains: phoneQuery } },
    );
  }

  return { OR: clauses };
}

function buildPracticeCallWhere({
  callSet,
  officeFilter,
  practiceId,
  quickFilter = "all",
  range,
  searchQuery = "",
}: {
  callSet: AdminPracticeCallSet;
  officeFilter?: AdminPracticeOfficeFilterOption | null;
  practiceId: string;
  quickFilter?: CallQuickFilter;
  range: AdminPracticeRange;
  searchQuery?: string;
}): Prisma.AgentCallWhereInput {
  const rangeStart = getRangeStart(range);

  return andAgentCallWhere(
    { practiceId },
    rangeStart ? { startedAt: { gte: rangeStart } } : null,
    buildOfficeAgentCallWhere(officeFilter),
    buildCallSetWhere(callSet),
    buildCallQuickFilterWhere(quickFilter),
    buildCallSearchWhere(searchQuery),
  );
}

function getCallTableOrderBy(
  sortState: CallSortState,
): Prisma.AgentCallOrderByWithRelationInput[] {
  const direction = sortState.direction;
  const stableRecentTieBreakers: Prisma.AgentCallOrderByWithRelationInput[] = [
    { startedAt: "desc" },
    { id: "asc" },
  ];

  switch (sortState.key) {
    case "actions":
      return [{ toolCalls: direction }, ...stableRecentTieBreakers];
    case "durationSec":
      return [{ durationSec: direction }, ...stableRecentTieBreakers];
    case "office":
      return [{ officePhone: direction }, ...stableRecentTieBreakers];
    case "transferred":
      return [{ transferred: direction }, ...stableRecentTieBreakers];
    case "startedAt":
      return [{ startedAt: direction }, { id: "asc" }];
  }
}

const adminCallLiteSelect = {
  avgTokensPerSec: true,
  avgTtft: true,
  avgTtsttfb: true,
  bookedAppointment: true,
  cacheHitRate: true,
  cachedTokens: true,
  callId: true,
  callerPhone: true,
  cancelledAppointment: true,
  data: true,
  durationSec: true,
  evaluationLabels: {
    select: {
      bucket: true,
      comment: true,
    },
  },
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
  officePhone: true,
  outcomeSummary: true,
  outputTokens: true,
  peakContext: true,
  startedAt: true,
  toolCalls: true,
  toolErrors: true,
  totalTurns: true,
  transferred: true,
  ttsChars: true,
} satisfies Prisma.AgentCallSelect;

function getEvaluationLabel(
  labels: Array<{ bucket: AgentCallEvaluationBucket; comment: string | null }>,
) {
  return (
    labels.find((label) => label.bucket === "BAD") ??
    labels.find((label) => label.bucket === "GOLDEN") ??
    null
  );
}

function buildCallTableRow(
  call: AdminCallLiteRecord,
  officeNameByPhone: Map<string, string>,
): AdminCallTableRow {
  const latency = getLatencyArrays(call);
  const tools = getToolCalls(call.data);
  const toolExecutions = getToolExecutions(call.data);
  const observability = getObservabilitySignals(call.data);
  const fallbackToolActions: string[] = [];
  const toolCallCount = Math.max(call.toolCalls, tools.length, toolExecutions.length);
  const toolErrorCount = Math.max(
    call.toolErrors,
    tools.filter((tool) => tool.isError).length,
    toolExecutions.filter((tool) => tool.status === "error").length,
  );

  if (call.bookedAppointment) fallbackToolActions.push("Book");
  if (call.cancelledAppointment) fallbackToolActions.push("Cancel");
  if (call.transferred) fallbackToolActions.push("Transfer");

  const apptActions = getToolActionLabels(call);
  const toolActions = getCallTableToolActionLabels({
    fallbackActions: fallbackToolActions,
    toolCalls: tools,
    toolExecutions,
  });
  const evaluationLabel = getEvaluationLabel(call.evaluationLabels ?? []);

  return {
    apptActions,
    acceptedLanguages: observability.acceptedLanguages,
    avgTokensPerSec: call.avgTokensPerSec,
    cacheHitRate: getCacheHitRate(call),
    callId: call.callId,
    callerPhone: call.callerPhone,
    closeReason: observability.closeReason,
    currentLanguage: observability.currentLanguage,
    durationSec: call.durationSec,
    evaluationBucket: evaluationLabel?.bucket ?? null,
    evaluationComment: evaluationLabel?.comment ?? null,
    fallbackUsed: call.fallbackUsed,
    falseInterruptionCount: observability.falseInterruptionCount,
    hasAudio: false,
    id: call.id,
    interruptionCount: call.interruptionCount,
    languageChanged: observability.languageChanged,
    llmModel: call.llmModel ?? "",
    officeName:
      call.location?.name ?? officeNameByPhone.get(phoneDigits(call.officePhone)) ?? null,
    officePhone: call.officePhone,
    overlappingSpeechCount: observability.overlappingSpeechCount,
    p50TotalLatency: median(latency.total),
    p50Ttft: median(latency.ttft),
    p50Ttsttfb: median(latency.tts),
    peakContext: getPeakContext(call),
    runtimeErrorCount: observability.runtimeErrorCount,
    startedAt: call.startedAt.toISOString(),
    toolActions,
    toolCalls: toolCallCount,
    toolErrors: toolErrorCount,
    totalTurns: getCallTotalTurns(call),
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
      data: true,
      durationSec: true,
      estimatedCostMicros: true,
      evaluationLabels: {
        select: {
          bucket: true,
          comment: true,
        },
      },
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
      officePhone: true,
      outcomeSummary: true,
      outputTokens: true,
      peakContext: true,
      practiceId: true,
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

async function loadPracticeLiteCalls(
  practiceId: string,
  range: AdminPracticeRange,
  officeFilter?: AdminPracticeOfficeFilterOption | null,
) {
  return prisma.agentCall.findMany({
    orderBy: {
      startedAt: "desc",
    },
    select: adminCallLiteSelect,
    where: buildPracticeCallWhere({
      callSet: "all",
      officeFilter,
      practiceId,
      range,
    }),
  });
}

async function loadBookedCategoryCalls(
  practiceId: string,
  range: AdminPracticeRange,
  officeFilter?: AdminPracticeOfficeFilterOption | null,
) {
  return prisma.agentCall.findMany({
    orderBy: {
      startedAt: "desc",
    },
    select: {
      callerPhone: true,
      data: true,
      id: true,
      outcomeSummary: true,
      startedAt: true,
    },
    where: andAgentCallWhere(
      buildPracticeCallWhere({
        callSet: "all",
        officeFilter,
        practiceId,
        range,
      }),
      { bookedAppointment: true },
    ),
  });
}

function buildBookingCategories(
  calls: Awaited<ReturnType<typeof loadBookedCategoryCalls>>,
) {
  return summarizeBookingCategories(
    calls.map((call) =>
      extractBookedAppointment({
        callerPhone: call.callerPhone,
        data: call.data,
        id: call.id,
        outcomeSummary: call.outcomeSummary,
        startedAt: call.startedAt,
      }),
    ),
  );
}

async function loadPracticeCallTable({
  callSet,
  officeFilter,
  officeNameByPhone,
  practiceId,
  range,
  state = DEFAULT_CALL_TABLE_STATE,
}: {
  callSet: AdminPracticeCallSet;
  officeFilter?: AdminPracticeOfficeFilterOption | null;
  officeNameByPhone: Map<string, string>;
  practiceId: string;
  range: AdminPracticeRange;
  state?: CallTableState;
}): Promise<AdminCallTableResult> {
  const matchingWhere = buildPracticeCallWhere({
    callSet,
    officeFilter,
    practiceId,
    quickFilter: state.quickFilter,
    range,
    searchQuery: state.searchQuery,
  });
  const filterOptionWhere = buildPracticeCallWhere({
    callSet,
    officeFilter,
    practiceId,
    range,
    searchQuery: state.searchQuery,
  });
  const [totalCount, errorCount, languageCount] = await Promise.all([
    prisma.agentCall.count({ where: matchingWhere }),
    prisma.agentCall.count({
      where: andAgentCallWhere(filterOptionWhere, { toolErrors: { gt: 0 } }),
    }),
    prisma.agentCall.count({
      where: andAgentCallWhere(filterOptionWhere, buildLanguageSignalWhere()),
    }),
  ]);
  const pageCount = getCallTablePageCount(totalCount);
  const activePage = clampCallTablePage(state.page, pageCount);
  const calls =
    totalCount > 0
      ? await prisma.agentCall.findMany({
          orderBy: getCallTableOrderBy(state.sortState),
          select: adminCallLiteSelect,
          skip: (activePage - 1) * CALL_TABLE_PAGE_SIZE,
          take: CALL_TABLE_PAGE_SIZE,
          where: matchingWhere,
        })
      : [];

  return {
    hasLanguageSignals: languageCount > 0 || state.quickFilter === "language",
    hasToolErrors: errorCount > 0 || state.quickFilter === "errors",
    pageCount,
    rows: calls.map((call) => buildCallTableRow(call, officeNameByPhone)),
    state: {
      ...state,
      page: activePage,
    },
    totalCount,
  };
}

export async function getAdminCallNavigation({
  callId,
  callSet,
  office,
  practiceId,
  range,
  state = DEFAULT_CALL_TABLE_STATE,
}: {
  callId: string;
  callSet: AdminPracticeCallSet;
  office?: string | null;
  practiceId: string;
  range: AdminPracticeRange;
  state?: CallTableState;
}): Promise<AdminCallNavigation> {
  const practice = await prisma.practice.findUnique({
    select: {
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
    return {
      nextCall: null,
      previousCall: null,
    };
  }

  const officeFilters = buildOfficeFilterOptions(practice.phoneNumbers);
  const selectedOffice = resolveOfficeFilter(office, officeFilters);
  const where = buildPracticeCallWhere({
    callSet,
    officeFilter: selectedOffice,
    practiceId,
    quickFilter: state.quickFilter,
    range,
    searchQuery: state.searchQuery,
  });
  const currentCall = await prisma.agentCall.findFirst({
    select: {
      id: true,
    },
    where: andAgentCallWhere(where, {
      OR: [{ id: callId }, { callId }],
    }),
  });

  if (!currentCall) {
    return {
      nextCall: null,
      previousCall: null,
    };
  }

  const orderBy = getCallTableOrderBy(state.sortState);
  const [previousRows, nextRows] = await Promise.all([
    prisma.agentCall.findMany({
      cursor: { id: currentCall.id },
      orderBy,
      select: { id: true },
      skip: 1,
      take: -1,
      where,
    }),
    prisma.agentCall.findMany({
      cursor: { id: currentCall.id },
      orderBy,
      select: { id: true },
      skip: 1,
      take: 1,
      where,
    }),
  ]);

  return {
    nextCall: nextRows[0] ?? null,
    previousCall: previousRows[0] ?? null,
  };
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
        durationSec: true,
        estimatedCostMicros: true,
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
  options: AdminPracticeDetailOptions = {},
) {
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
  const officeNameByPhone = buildOfficeNameByPhone(practice.phoneNumbers);
  const includeAnalytics = options.includeAnalytics === true;
  const includeDashboard = options.includeDashboard === true;
  const includeTable = options.includeTable === true;
  const [analyticsCalls, dashboardCalls, bookedCategoryCalls, callTable] =
    await Promise.all([
      includeAnalytics
        ? loadPracticeCalls(practiceId, range, selectedOffice)
        : Promise.resolve(null),
      includeDashboard
        ? loadPracticeLiteCalls(practiceId, range, selectedOffice)
        : Promise.resolve(null),
      includeDashboard
        ? loadBookedCategoryCalls(practiceId, range, selectedOffice)
        : Promise.resolve(null),
      includeTable
        ? loadPracticeCallTable({
            callSet: options.callSet ?? "all",
            officeFilter: selectedOffice,
            officeNameByPhone,
            practiceId,
            range,
            state: options.tableState,
          })
        : Promise.resolve(null),
    ]);

  return {
    agentStatus: getAgentStatus(practice.agents),
    analyticsData: analyticsCalls
      ? buildPracticeAnalyticsData(analyticsCalls, range)
      : null,
    callRows: callTable?.rows ?? [],
    callTable,
    dashboardData: dashboardCalls
      ? buildPracticeDashboardData(
          dashboardCalls,
          buildBookingCategories(bookedCategoryCalls ?? []),
        )
      : null,
    officeFilters,
    practice,
    range,
    selectedOfficeId: selectedOffice?.id ?? null,
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
      evaluationLabels: {
        orderBy: {
          createdAt: "desc",
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
