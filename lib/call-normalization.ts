import type {
  AgentCallStatusValue,
  AgentSessionUsage,
  CallSummaryData,
  ChatHistoryItem,
  CostLineEstimate,
  JudgeResult,
  LiveKitMetric,
  LiveKitWebhookPayload,
  LlmSummary,
  ModelUsageRecord,
  SessionReport,
  ToolCallRecord,
  ToolExecutionAnalytics,
  TurnMetricRecord,
  TurnRecord,
} from "@/lib/call-types";
import { estimateUsageCostLineItems } from "@/lib/pricing";
import { isSuccessfulToolAction } from "@/lib/tool-action-status";

const LLM_METRIC_TYPES = new Set(["llm_metrics", "realtime_model_metrics"]);
const FALLBACK_MODEL = "MiniMaxAI/MiniMax-M2.5";

type ToolActions = {
  bookedAppointment: boolean;
  cancelledAppointment: boolean;
  confirmedAppointment: boolean;
  transferred: boolean;
};

export type NormalizedPortalCall = {
  agentId: string | null;
  audioData: Uint8Array | null;
  avgTokensPerSec: number;
  cacheHitRate: number;
  cachedTokens: number;
  callId: string;
  callerPhone: string;
  costItems: CostLineEstimate[];
  dataPayload: unknown;
  durationSec: number;
  endedAt: Date | null;
  estimatedCostMicros: number;
  fallbackUsed: boolean;
  inputTokens: number;
  interruptionCount: number;
  latencyValues: {
    stt: number[];
    ttft: number[];
    ttsttfb: number[];
    totalLatency: number[];
    tokensPerSec: number[];
  };
  llmModel: string | null;
  needsReview: boolean;
  officePhone: string;
  outcomeSummary: string | null;
  outputTokens: number;
  peakContext: number;
  practiceId: string | null;
  reviewAverageScore: number | null;
  reviewResult: unknown;
  reviewStatus: string | null;
  startedAt: Date;
  status: AgentCallStatusValue;
  summary: CallSummaryData;
  toolActions: ToolActions;
  toolCalls: number;
  toolErrors: number;
  totalTurns: number;
  ttsChars: number;
  avgTtft: number;
  avgTtsttfb: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asDate(value: unknown, fallback: Date | null = null) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) {
      return date;
    }
  }

  return fallback;
}

function average(values: number[]) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function pushModel(set: Set<string>, value: unknown) {
  if (typeof value === "string" && value.trim()) {
    set.add(value.trim());
  }
}

function usageModelsFromArray(usage: unknown): string[] {
  const models = new Set<string>();
  if (!Array.isArray(usage)) {
    return [];
  }

  for (const entry of usage) {
    if (isRecord(entry) && entry.type === "llm_usage") {
      pushModel(models, entry.model);
    }
  }

  return [...models];
}

function usageModels(usage?: AgentSessionUsage, report?: SessionReport): string[] {
  return [
    ...usageModelsFromArray(usage?.modelUsage),
    ...usageModelsFromArray(report?.usage),
  ];
}

function metricModels(metrics?: LiveKitMetric[]): string[] {
  const models = new Set<string>();
  if (!Array.isArray(metrics)) {
    return [];
  }

  for (const metric of metrics) {
    if (!LLM_METRIC_TYPES.has(metric.type)) {
      continue;
    }

    const metadata = metric.metadata;
    if (isRecord(metadata)) {
      pushModel(models, metadata.modelName);
    }
  }

  return [...models];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function normalizedLlmSummary(value: unknown): LlmSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const modelsUsed = stringArray(value.modelsUsed);
  const summary: LlmSummary = {
    ...(typeof value.avgTtftMs === "number" ? { avgTtftMs: value.avgTtftMs } : {}),
    ...(typeof value.cacheHitRate === "number"
      ? { cacheHitRate: value.cacheHitRate }
      : {}),
    ...(typeof value.cachedPromptTokens === "number"
      ? { cachedPromptTokens: value.cachedPromptTokens }
      : {}),
    ...(typeof value.completionTokens === "number"
      ? { completionTokens: value.completionTokens }
      : {}),
    ...(typeof value.fallbackUsed === "boolean"
      ? { fallbackUsed: value.fallbackUsed }
      : {}),
    ...(modelsUsed.length > 0 ? { modelsUsed } : {}),
    ...(typeof value.peakPromptTokens === "number"
      ? { peakPromptTokens: value.peakPromptTokens }
      : {}),
    ...(typeof value.promptTokens === "number"
      ? { promptTokens: value.promptTokens }
      : {}),
  };

  return Object.keys(summary).length > 0 ? summary : null;
}

function normalizedToolExecutions(value: unknown): ToolExecutionAnalytics[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map((item) => ({
    ...(typeof item.callId === "string" ? { callId: item.callId } : {}),
    ...(typeof item.createdAt === "string" ? { createdAt: item.createdAt } : {}),
    ...(typeof item.outputClass === "string" ? { outputClass: item.outputClass } : {}),
    ...(item.status === "success" || item.status === "error"
      ? { status: item.status }
      : {}),
    ...(typeof item.toolName === "string" ? { toolName: item.toolName } : {}),
  }));
}

export function deriveLlmInfo(input: {
  llm?: Partial<{ model: string; fallbackUsed: boolean; usedModels: string[] }>;
  llmSummary?: unknown;
  metrics?: LiveKitMetric[];
  usage?: AgentSessionUsage;
  sessionReport?: SessionReport;
}) {
  const llmSummary = normalizedLlmSummary(input.llmSummary);
  if (llmSummary?.modelsUsed?.length) {
    return {
      fallbackUsed:
        typeof llmSummary.fallbackUsed === "boolean"
          ? llmSummary.fallbackUsed
          : Boolean(input.llm?.fallbackUsed),
      model: llmSummary.modelsUsed.at(-1) ?? llmSummary.modelsUsed[0] ?? "",
      usedModels: llmSummary.modelsUsed,
    };
  }

  const explicit = input.llm;
  if (
    explicit &&
    typeof explicit.model === "string" &&
    typeof explicit.fallbackUsed === "boolean" &&
    Array.isArray(explicit.usedModels)
  ) {
    return {
      fallbackUsed: explicit.fallbackUsed,
      model: explicit.model,
      usedModels: explicit.usedModels.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      ),
    };
  }

  const usedModels = [
    ...new Set([
      ...metricModels(input.metrics),
      ...usageModels(input.usage, input.sessionReport),
    ]),
  ];
  const fallbackUsed = usedModels.includes(FALLBACK_MODEL);
  const model = fallbackUsed ? FALLBACK_MODEL : (usedModels[0] ?? "");

  return { fallbackUsed, model, usedModels };
}

export function isLiveKitPayload(
  body: LiveKitWebhookPayload | CallSummaryData,
): body is LiveKitWebhookPayload {
  const payload = body as LiveKitWebhookPayload;
  const summary = body as CallSummaryData;

  return (
    !Array.isArray(summary.turns) &&
    (Array.isArray(payload.metrics) ||
      Array.isArray(payload.llmMetrics) ||
      Array.isArray(payload.turnMetrics) ||
      payload.usage !== undefined ||
      payload.language !== undefined ||
      payload.llmSummary !== undefined ||
      payload.sessionEvents !== undefined ||
      payload.toolExecutions !== undefined ||
      payload.sessionReport !== undefined)
  );
}

function payloadMetrics(body: LiveKitWebhookPayload): LiveKitMetric[] {
  if (body.metrics?.length) {
    return body.metrics;
  }

  return body.llmMetrics ?? [];
}

function toMilliseconds(
  value: unknown,
  unit: "seconds" | "milliseconds" | "auto" = "auto",
) {
  const numberValue = asNumber(value);

  if (numberValue <= 0) {
    return 0;
  }

  if (unit === "seconds") {
    return Math.round(numberValue * 1000);
  }

  if (unit === "milliseconds") {
    return Math.round(numberValue);
  }

  return Math.round(numberValue < 30 ? numberValue * 1000 : numberValue);
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function metricMsOrNull(
  metrics: Record<string, unknown> | undefined,
  fields: Array<{ key: string; unit?: "seconds" | "milliseconds" | "auto" }>,
) {
  if (!metrics) {
    return null;
  }

  for (const field of fields) {
    if (metrics[field.key] !== undefined) {
      return toMilliseconds(metrics[field.key], field.unit ?? "auto");
    }
  }

  return null;
}

function metricMs(
  metrics: Record<string, unknown> | undefined,
  fields: Array<{ key: string; unit?: "seconds" | "milliseconds" | "auto" }>,
) {
  if (!metrics) {
    return 0;
  }

  for (const field of fields) {
    const value = metrics[field.key];
    if (value !== undefined) {
      return toMilliseconds(value, field.unit ?? "auto");
    }
  }

  return 0;
}

type TurnMetricLookup = {
  byItemId: Map<string, TurnMetricRecord>;
  assistantTurns: TurnMetricRecord[];
  userTurns: TurnMetricRecord[];
};

function buildTurnMetricLookup(turnMetrics?: TurnMetricRecord[]): TurnMetricLookup {
  const byItemId = new Map<string, TurnMetricRecord>();
  const assistantTurns: TurnMetricRecord[] = [];
  const userTurns: TurnMetricRecord[] = [];

  for (const item of turnMetrics ?? []) {
    if (item.itemId && item.metrics) {
      byItemId.set(item.itemId, item);
    }

    const metrics = item.metrics;
    const hasUserTiming =
      metrics &&
      ("transcriptionDelay" in metrics ||
        "transcription_delay" in metrics ||
        "transcriptionDelayMs" in metrics ||
        "transcription_delay_ms" in metrics ||
        "stoppedSpeakingAt" in metrics);

    if ((item.role === "user" || hasUserTiming) && item.metrics) {
      userTurns.push(item);
    }

    if (item.role === "assistant" && item.metrics) {
      assistantTurns.push(item);
    }
  }

  return { assistantTurns, byItemId, userTurns };
}

function turnMetricForItem(
  item: ChatHistoryItem,
  lookup: TurnMetricLookup,
  fallbackIndex: number,
) {
  if (item.id) {
    const matched = lookup.byItemId.get(item.id);
    if (matched) {
      return matched;
    }
  }

  if (item.role === "user") {
    return lookup.userTurns[fallbackIndex];
  }

  if (item.role === "assistant") {
    return lookup.assistantTurns[fallbackIndex];
  }

  return undefined;
}

function metricsForItem(
  item: ChatHistoryItem,
  turnMetricRecord: TurnMetricRecord | undefined,
) {
  return turnMetricRecord?.metrics ?? item.metrics;
}

function timestampMs(value: unknown) {
  const numberValue = numberOrNull(value);
  if (numberValue == null) {
    return null;
  }

  return numberValue < 10_000_000_000 ? numberValue * 1000 : numberValue;
}

function transcriptConfidence(metrics: Record<string, unknown> | undefined) {
  const confidence =
    numberOrNull(metrics?.transcriptConfidence) ??
    numberOrNull(metrics?.transcriptionConfidence) ??
    numberOrNull(metrics?.transcript_confidence) ??
    numberOrNull(metrics?.transcription_confidence) ??
    numberOrNull(metrics?.confidence);

  if (confidence == null) {
    return null;
  }

  if (confidence > 1 && confidence <= 100) {
    return confidence / 100;
  }

  return confidence >= 0 && confidence <= 1 ? confidence : null;
}

function sttLatencyFromTurnMetrics(input: {
  item: ChatHistoryItem;
  metrics: Record<string, unknown> | undefined;
  turnMetric: TurnMetricRecord | undefined;
}) {
  const transcriptionDelayMs = metricMsOrNull(input.metrics, [
    { key: "transcriptionDelay", unit: "seconds" },
    { key: "transcription_delay", unit: "auto" },
    { key: "transcriptionDelayMs", unit: "milliseconds" },
    { key: "transcription_delay_ms", unit: "milliseconds" },
    { key: "stt_latency", unit: "milliseconds" },
  ]);

  if (transcriptionDelayMs != null) {
    return transcriptionDelayMs;
  }

  const createdAtMs = timestampMs(input.turnMetric?.createdAt ?? input.item.createdAt);
  const stoppedSpeakingAtMs = timestampMs(input.metrics?.stoppedSpeakingAt);

  if (createdAtMs != null && stoppedSpeakingAtMs != null) {
    return Math.max(0, Math.round(createdAtMs - stoppedSpeakingAtMs));
  }

  return null;
}

function modelUsageEntries(body: LiveKitWebhookPayload): ModelUsageRecord[] {
  const entries: ModelUsageRecord[] = [];

  if (Array.isArray(body.usage?.modelUsage)) {
    entries.push(...body.usage.modelUsage);
  }

  if (Array.isArray(body.sessionReport?.usage)) {
    entries.push(...(body.sessionReport.usage as ModelUsageRecord[]));
  }

  return entries;
}

function usageValue(entry: ModelUsageRecord, keys: string[]) {
  for (const key of keys) {
    const value = asNumber(entry[key]);
    if (value > 0) {
      return value;
    }
  }

  return 0;
}

function deriveUsageTotals(body: LiveKitWebhookPayload) {
  const totals = {
    cachedTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    ttsChars: 0,
  };

  for (const entry of modelUsageEntries(body)) {
    if (entry.type === "llm_usage") {
      totals.inputTokens += usageValue(entry, [
        "inputTokens",
        "input_tokens",
        "promptTokens",
        "prompt_tokens",
      ]);
      totals.outputTokens += usageValue(entry, [
        "outputTokens",
        "output_tokens",
        "completionTokens",
        "completion_tokens",
      ]);
      totals.cachedTokens += usageValue(entry, [
        "inputCachedTokens",
        "input_cached_tokens",
        "promptCachedTokens",
        "prompt_cached_tokens",
      ]);
    }

    if (entry.type === "tts_usage") {
      totals.ttsChars += usageValue(entry, ["charactersCount", "characters_count"]);
    }
  }

  return totals;
}

function extractText(content?: ChatHistoryItem["content"]): string {
  if (!content) {
    return "";
  }

  return content
    .map((item) => (typeof item === "string" ? item : (item.transcript ?? "")))
    .join("")
    .trim();
}

function deriveTotalLatency(turn: {
  sttLatencyMs?: number;
  totalLatencyMs?: number;
  ttftMs: number;
  ttsttfbMs?: number;
}) {
  if ((turn.totalLatencyMs ?? 0) > 0) {
    return turn.totalLatencyMs ?? 0;
  }

  if (turn.ttftMs <= 0) {
    return 0;
  }

  return (turn.sttLatencyMs ?? 0) + turn.ttftMs + (turn.ttsttfbMs ?? 0);
}

function outputByCallId(items: ChatHistoryItem[]) {
  const outputs = new Map<string, ChatHistoryItem>();

  for (const item of items) {
    if (item.type === "function_call_output" && item.callId) {
      outputs.set(item.callId, item);
    }
  }

  return outputs;
}

function groupedLlmMetrics(metrics: LiveKitMetric[]) {
  const groups: LiveKitMetric[][] = [];
  let pendingGroup: LiveKitMetric[] = [];
  let groupSpeechId: string | undefined;

  for (const metric of metrics) {
    const speechId = typeof metric.speechId === "string" ? metric.speechId : undefined;

    if (pendingGroup.length > 0 && speechId !== groupSpeechId) {
      groups.push(pendingGroup);
      pendingGroup = [];
    }

    pendingGroup.push(metric);
    groupSpeechId = speechId;

    if (!speechId) {
      groups.push(pendingGroup);
      pendingGroup = [];
    }
  }

  if (pendingGroup.length > 0) {
    groups.push(pendingGroup);
  }

  return groups;
}

export function deriveCallSummary(body: LiveKitWebhookPayload): CallSummaryData {
  const metrics = payloadMetrics(body);
  const items = body.sessionReport?.chat_history?.items ?? [];
  const llmSummary = normalizedLlmSummary(body.llmSummary);
  const toolExecutions = normalizedToolExecutions(body.toolExecutions);
  const llm = deriveLlmInfo({ ...body, llmSummary: body.llmSummary, metrics });
  const usageTotals = deriveUsageTotals(body);
  const hasTokenUsageTotals =
    usageTotals.inputTokens > 0 ||
    usageTotals.outputTokens > 0 ||
    usageTotals.cachedTokens > 0;
  const hasTtsUsageTotals = usageTotals.ttsChars > 0;
  const turnMetricLookup = buildTurnMetricLookup(body.turnMetrics);
  const hasSummaryPromptTokens = typeof llmSummary?.promptTokens === "number";
  const hasSummaryCompletionTokens = typeof llmSummary?.completionTokens === "number";
  const hasSummaryCachedPromptTokens = typeof llmSummary?.cachedPromptTokens === "number";
  const hasSummaryPeakPromptTokens = typeof llmSummary?.peakPromptTokens === "number";

  let totalInputTokens = llmSummary?.promptTokens ?? usageTotals.inputTokens;
  let totalOutputTokens = llmSummary?.completionTokens ?? usageTotals.outputTokens;
  let totalCachedTokens = llmSummary?.cachedPromptTokens ?? usageTotals.cachedTokens;
  let peakContextTokens = llmSummary?.peakPromptTokens ?? 0;
  let ttsChars = usageTotals.ttsChars;

  for (const metric of metrics) {
    if (LLM_METRIC_TYPES.has(metric.type)) {
      const prompt = asNumber(metric.promptTokens);
      const completion = asNumber(metric.completionTokens);
      const cached = asNumber(metric.promptCachedTokens);

      if (!hasTokenUsageTotals) {
        if (!hasSummaryPromptTokens) totalInputTokens += prompt;
        if (!hasSummaryCompletionTokens) totalOutputTokens += completion;
        if (!hasSummaryCachedPromptTokens) totalCachedTokens += cached;
      }

      if (!hasSummaryPeakPromptTokens && prompt > peakContextTokens) {
        peakContextTokens = prompt;
      }
    }

    if (metric.type === "tts_metrics" && !hasTtsUsageTotals) {
      ttsChars += asNumber(metric.charactersCount);
    }
  }

  const turns: TurnRecord[] = [];
  const llmGroups = groupedLlmMetrics(
    metrics.filter((metric) => LLM_METRIC_TYPES.has(metric.type)),
  );
  const ttsMetrics = metrics.filter((metric) => metric.type === "tts_metrics");
  const sttMetrics = metrics.filter((metric) => metric.type === "eou_metrics");
  const outputs = outputByCallId(items);

  let currentTurn: TurnRecord | null = null;
  let llmGroupIndex = 0;
  let ttsIndex = 0;
  let sttIndex = 0;
  let turnNumber = 0;
  let userTurnMetricIndex = 0;
  let assistantTurnMetricIndex = 0;

  const emptyTurn = (): TurnRecord => ({
    agentText: null,
    cachedTokens: 0,
    callerText: null,
    completionTokens: 0,
    promptTokens: 0,
    sttLatencyMs: 0,
    toolCalls: [],
    ttftMs: 0,
    ttsttfbMs: 0,
    turn: ++turnNumber,
  });

  for (const item of items) {
    if (item.type === "message" && item.role === "user") {
      if (currentTurn) {
        turns.push(currentTurn);
      }

      currentTurn = emptyTurn();
      currentTurn.callerText = extractText(item.content) || null;

      const sttMetric = sttMetrics[sttIndex++];
      const ttsMetric = ttsMetrics[ttsIndex++];
      const llmGroup = llmGroups[llmGroupIndex++] ?? [];
      const firstLlm = llmGroup[0];
      const turnMetric = turnMetricForItem(item, turnMetricLookup, userTurnMetricIndex++);
      const itemMetrics = metricsForItem(item, turnMetric);
      const sttLatencyMs = sttLatencyFromTurnMetrics({
        item,
        metrics: itemMetrics,
        turnMetric,
      });

      currentTurn.ttftMs = asNumber(firstLlm?.ttftMs);
      currentTurn.ttsttfbMs = asNumber(ttsMetric?.ttfbMs);
      currentTurn.sttConfidence = transcriptConfidence(itemMetrics);
      currentTurn.sttLatencyMeasured = sttLatencyMs != null;
      currentTurn.sttLatencyMs =
        sttLatencyMs ?? Math.round(asNumber(sttMetric?.transcriptionDelayMs));

      for (const llmMetric of llmGroup) {
        currentTurn.promptTokens += asNumber(llmMetric.promptTokens);
        currentTurn.completionTokens += asNumber(llmMetric.completionTokens);
        currentTurn.cachedTokens += asNumber(llmMetric.promptCachedTokens);
      }

      currentTurn.totalLatencyMs = deriveTotalLatency(currentTurn);
      if (currentTurn.sttLatencyMeasured) {
        item.metrics = {
          ...(item.metrics ?? {}),
          ...(currentTurn.sttConfidence != null
            ? { stt_confidence: currentTurn.sttConfidence }
            : {}),
          stt_latency: currentTurn.sttLatencyMs,
        };
      }
    }

    if (item.type === "message" && item.role === "assistant") {
      currentTurn ??= emptyTurn();
      currentTurn.agentText = extractText(item.content) || null;
      const turnMetric = turnMetricForItem(
        item,
        turnMetricLookup,
        assistantTurnMetricIndex++,
      );
      const itemMetrics = metricsForItem(item, turnMetric);
      if (currentTurn.ttftMs <= 0) {
        currentTurn.ttftMs = metricMs(itemMetrics, [
          { key: "llmNodeTtft", unit: "seconds" },
          { key: "llm_node_ttft", unit: "auto" },
          { key: "ttftMs", unit: "milliseconds" },
          { key: "ttft_ms", unit: "milliseconds" },
        ]);
      }

      if (currentTurn.ttsttfbMs <= 0) {
        currentTurn.ttsttfbMs = metricMs(itemMetrics, [
          { key: "ttsNodeTtfb", unit: "seconds" },
          { key: "tts_node_ttfb", unit: "auto" },
          { key: "ttfbMs", unit: "milliseconds" },
          { key: "ttfb_ms", unit: "milliseconds" },
        ]);
      }

      const e2eLatencyMs = metricMs(itemMetrics, [
        { key: "e2eLatency", unit: "seconds" },
        { key: "e2e_latency", unit: "auto" },
        { key: "totalLatencyMs", unit: "milliseconds" },
        { key: "total_latency_ms", unit: "milliseconds" },
      ]);

      if (e2eLatencyMs > 0) {
        currentTurn.totalLatencyMs = e2eLatencyMs;
      } else {
        currentTurn.totalLatencyMs = deriveTotalLatency(currentTurn);
      }

      item.metrics = {
        ...(item.metrics ?? {}),
        llm_node_ttft: currentTurn.ttftMs,
        tts_node_ttfb: currentTurn.ttsttfbMs,
        ...(currentTurn.totalLatencyMs
          ? { e2e_latency: currentTurn.totalLatencyMs }
          : {}),
      };
    }

    if (item.type === "function_call") {
      currentTurn ??= emptyTurn();
      const output = item.callId ? outputs.get(item.callId) : undefined;
      const durationMs =
        output?.createdAt && item.createdAt ? output.createdAt - item.createdAt : 0;
      currentTurn.toolCalls.push({
        args: item.args ?? "",
        durationMs,
        isError: output?.isError ?? false,
        name: item.name ?? "unknown",
        result: output?.output ?? "",
      });
    }
  }

  if (currentTurn) {
    turns.push(currentTurn);
  }

  let totalToolCalls = 0;
  let totalToolErrors = 0;
  for (const turn of turns) {
    for (const toolCall of turn.toolCalls) {
      totalToolCalls++;
      if (toolCall.isError) {
        totalToolErrors++;
      }
    }
  }

  const ttftValues = turns.map((turn) => turn.ttftMs).filter((value) => value > 0);
  const metricTtftValues = metrics
    .filter((metric) => LLM_METRIC_TYPES.has(metric.type))
    .map((metric) => asNumber(metric.ttftMs))
    .filter((value) => value > 0);
  const ttsttfbValues = turns.map((turn) => turn.ttsttfbMs).filter((value) => value > 0);
  const totalLatencyValues = turns
    .map((turn) => deriveTotalLatency(turn))
    .filter((value) => value > 0);

  return {
    callId: body.callId,
    callerPhone: body.callerPhone ?? "",
    durationSec: body.durationSec ?? 0,
    endedAt: body.endedAt,
    llm,
    officePhone: body.officePhone,
    sessionReport: body.sessionReport,
    startedAt: body.startedAt ?? new Date().toISOString(),
    totalTurns: turns.filter((turn) => turn.callerText !== null).length,
    totals: {
      avgASR: 0,
      avgTTFT: Math.round(
        llmSummary?.avgTtftMs ??
          average(ttftValues.length > 0 ? ttftValues : metricTtftValues),
      ),
      avgTTSttfb: Math.round(average(ttsttfbValues)),
      avgTotalLatency: Math.round(average(totalLatencyValues)),
      cacheHitRate:
        llmSummary?.cacheHitRate ??
        (totalInputTokens > 0 ? totalCachedTokens / totalInputTokens : 0),
      cachedTokens: totalCachedTokens,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      peakContextTokens,
      ttsChars,
      toolCalls: toolExecutions.length > 0 ? toolExecutions.length : totalToolCalls,
      toolErrors:
        toolExecutions.length > 0
          ? toolExecutions.filter((tool) => tool.status === "error").length
          : totalToolErrors,
    },
    turns,
  };
}

export function getToolActions(
  turns: Array<{ toolCalls?: ToolCallRecord[] }>,
  toolExecutions: ToolExecutionAnalytics[] = [],
): ToolActions {
  const actions: ToolActions = {
    bookedAppointment: false,
    cancelledAppointment: false,
    confirmedAppointment: false,
    transferred: false,
  };

  for (const tool of toolExecutions) {
    if (tool.status !== "success") {
      continue;
    }

    if (tool.outputClass === "appointment_booked") {
      actions.bookedAppointment = true;
    }

    if (tool.outputClass === "appointment_rescheduled") {
      actions.bookedAppointment = true;
      actions.cancelledAppointment = true;
    }

    if (tool.outputClass === "appointment_cancelled") {
      actions.cancelledAppointment = true;
    }

    if (tool.outputClass === "appointment_confirmed") {
      actions.confirmedAppointment = true;
    }

    if (tool.outputClass === "transfer_started") {
      actions.transferred = true;
    }
  }

  for (const turn of turns) {
    for (const tool of turn.toolCalls ?? []) {
      if (!isSuccessfulToolAction(tool)) {
        continue;
      }

      if (tool.name === "book_appt") {
        actions.bookedAppointment = true;
      }

      if (tool.name === "reschedule_appt") {
        actions.bookedAppointment = true;
        actions.cancelledAppointment = true;
      }

      if (tool.name === "cancel_appt") {
        actions.cancelledAppointment = true;
      }

      if (tool.name === "confirm_appt") {
        actions.confirmedAppointment = true;
      }

      if (tool.name === "transfer_call") {
        actions.transferred = true;
      }
    }
  }

  return actions;
}

export function getReviewAverageScore(result: unknown) {
  if (!isRecord(result) || !isRecord(result.scores)) {
    return null;
  }

  const values = Object.values(result.scores).filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );

  return values.length > 0 ? average(values) : null;
}

export function callNeedsReview(call: {
  reviewResult?: unknown;
  reviewStatus?: string | null;
  toolErrors: number;
}) {
  if (call.toolErrors > 0 || call.reviewStatus === "failed") {
    return true;
  }

  const result = call.reviewResult;
  if (!isRecord(result)) {
    return false;
  }

  const labels = isRecord(result.labels) ? result.labels : {};

  return Boolean(
    result.passed === false ||
    labels.hallucination !== "none" ||
    labels.toolPath === "incorrect" ||
    labels.resolutionPath === "failed",
  );
}

export function estimateCostLineItems(call: {
  cachedTokens: number;
  durationSec: number;
  inputTokens: number;
  llmModel: string | null;
  outputTokens: number;
  ttsChars: number;
}): CostLineEstimate[] {
  return estimateUsageCostLineItems(call);
}

export function toJsonCompatible(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}

export function decodeAudioBase64(audioBase64: unknown) {
  if (typeof audioBase64 !== "string" || !audioBase64) {
    return null;
  }

  const buffer = Buffer.from(audioBase64, "base64");
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function buildLatencyValues(summary: CallSummaryData, body: LiveKitWebhookPayload) {
  const stt: number[] = [];
  const ttft: number[] = [];
  const ttsttfb: number[] = [];
  const totalLatency: number[] = [];
  const tokensPerSec: number[] = [];

  for (const turn of summary.turns ?? []) {
    if (turn.sttLatencyMeasured || (turn.sttLatencyMs ?? 0) > 0) {
      stt.push(turn.sttLatencyMs);
    }
    if (turn.ttftMs > 0) {
      ttft.push(turn.ttftMs);
    }
    if (turn.ttsttfbMs > 0) {
      ttsttfb.push(turn.ttsttfbMs);
    }

    const derivedTotal = deriveTotalLatency(turn);
    if (derivedTotal > 0) {
      totalLatency.push(derivedTotal);
    }
  }

  for (const metric of payloadMetrics(body)) {
    if (LLM_METRIC_TYPES.has(metric.type)) {
      const tokens = asNumber(metric.tokensPerSecond);
      if (tokens > 0) {
        tokensPerSec.push(tokens);
      }
    }
  }

  return { stt, ttft, ttsttfb, totalLatency, tokensPerSec };
}

function getTtsChars(summary: CallSummaryData, body: LiveKitWebhookPayload) {
  const summaryTtsChars = asNumber(summary.totals?.ttsChars);
  if (summaryTtsChars > 0) {
    return summaryTtsChars;
  }

  let ttsChars = 0;

  for (const metric of payloadMetrics(body)) {
    if (metric.type === "tts_metrics") {
      ttsChars += asNumber(metric.charactersCount);
    }
  }

  if (ttsChars > 0) {
    return ttsChars;
  }

  for (const turn of summary.turns ?? []) {
    ttsChars += turn.agentText?.length ?? 0;
  }

  return ttsChars;
}

function getInterruptionCount(summary: CallSummaryData, body: LiveKitWebhookPayload) {
  let interruptionCount = 0;

  for (const metric of payloadMetrics(body)) {
    if (metric.type === "interruption_metrics") {
      interruptionCount += asNumber(metric.numInterruptions);
    }
  }

  const chatItems =
    body.sessionReport?.chat_history?.items ??
    summary.sessionReport?.chat_history?.items ??
    [];

  for (const item of chatItems) {
    if (item.interrupted) {
      interruptionCount++;
    }
  }

  if (isRecord(body.sessionEvents)) {
    if (Array.isArray(body.sessionEvents.falseInterruptions)) {
      interruptionCount += body.sessionEvents.falseInterruptions.length;
    }

    if (Array.isArray(body.sessionEvents.overlappingSpeech)) {
      interruptionCount += body.sessionEvents.overlappingSpeech.filter(
        (event) => isRecord(event) && event.isInterruption === true,
      ).length;
    }
  }

  return interruptionCount;
}

function getReviewResult(body: LiveKitWebhookPayload) {
  if ("reviewResult" in body) {
    return body.reviewResult ?? null;
  }

  const data = body.data;
  if (isRecord(data) && "reviewResult" in data) {
    return data.reviewResult ?? null;
  }

  return null;
}

function normalizedStatus(input: {
  endedAt: Date | null;
  explicitStatus?: string;
  transferred: boolean;
}) {
  const explicit = input.explicitStatus?.toUpperCase();
  if (
    explicit === "IN_PROGRESS" ||
    explicit === "COMPLETED" ||
    explicit === "ESCALATED" ||
    explicit === "FAILED" ||
    explicit === "ABANDONED"
  ) {
    return explicit;
  }

  if (!input.endedAt) {
    return "IN_PROGRESS";
  }

  return input.transferred ? "ESCALATED" : "COMPLETED";
}

function stripAudioPayload(body: LiveKitWebhookPayload) {
  const { audioBase64: _audioBase64, ...withoutAudio } = body;
  return withoutAudio;
}

export function normalizeLiveKitCallPayload(
  body: LiveKitWebhookPayload | CallSummaryData,
): NormalizedPortalCall {
  const webhookBody = body as LiveKitWebhookPayload;
  const liveKitPayload = isLiveKitPayload(body);
  const summary = liveKitPayload
    ? deriveCallSummary(webhookBody)
    : (body as CallSummaryData);
  const normalizedBody: LiveKitWebhookPayload = {
    ...webhookBody,
    callId: summary.callId,
    callerPhone: summary.callerPhone,
    durationSec: summary.durationSec,
    endedAt: summary.endedAt,
    officePhone: summary.officePhone,
    startedAt: summary.startedAt,
  };
  const toolExecutions = normalizedToolExecutions(normalizedBody.toolExecutions);
  const llmSummary = normalizedLlmSummary(normalizedBody.llmSummary);
  const latencyValues = buildLatencyValues(summary, normalizedBody);
  const llm = deriveLlmInfo({
    llm: summary.llm,
    llmSummary,
    metrics: payloadMetrics(normalizedBody),
    usage: summary.usage ?? normalizedBody.usage,
    sessionReport: summary.sessionReport ?? normalizedBody.sessionReport,
  });
  const reviewResult = getReviewResult(normalizedBody);
  const reviewAverageScore = getReviewAverageScore(reviewResult);
  const toolActions = getToolActions(summary.turns ?? [], toolExecutions);
  const ttsChars = getTtsChars(summary, normalizedBody);
  const interruptionCount = getInterruptionCount(summary, normalizedBody);
  const startedAt = asDate(summary.startedAt, new Date()) ?? new Date();
  const endedAt = asDate(summary.endedAt, null);
  const durationSec =
    asNumber(summary.durationSec) ||
    (endedAt
      ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
      : 0);
  const inputTokens = Math.max(
    0,
    Math.round(asNumber(llmSummary?.promptTokens ?? summary.totals?.inputTokens)),
  );
  const outputTokens = Math.max(
    0,
    Math.round(asNumber(llmSummary?.completionTokens ?? summary.totals?.outputTokens)),
  );
  const cachedTokens = Math.max(
    0,
    Math.round(asNumber(llmSummary?.cachedPromptTokens ?? summary.totals?.cachedTokens)),
  );
  const toolCalls = Math.max(0, Math.round(asNumber(summary.totals?.toolCalls)));
  const toolErrors = Math.max(0, Math.round(asNumber(summary.totals?.toolErrors)));
  const llmModel = llm.model || null;
  const costItems = estimateCostLineItems({
    cachedTokens,
    durationSec,
    inputTokens,
    llmModel,
    outputTokens,
    ttsChars,
  });
  const reviewStatus = normalizedBody.reviewStatus ?? null;
  const needsReview = callNeedsReview({
    reviewResult,
    reviewStatus,
    toolErrors,
  });
  const strippedBody = stripAudioPayload(normalizedBody);
  const observabilityPayload = {
    ...(normalizedBody.llmSummary !== undefined ? { llmSummary: llmSummary ?? {} } : {}),
    ...(normalizedBody.toolExecutions !== undefined ? { toolExecutions } : {}),
  };
  const dataPayload = liveKitPayload
    ? toJsonCompatible({ ...strippedBody, ...summary, ...observabilityPayload })
    : toJsonCompatible(strippedBody);

  return {
    agentId: asString(normalizedBody.agentId) || null,
    audioData: decodeAudioBase64(normalizedBody.audioBase64),
    avgTokensPerSec: average(latencyValues.tokensPerSec),
    avgTtft: asNumber(llmSummary?.avgTtftMs ?? summary.totals?.avgTTFT),
    avgTtsttfb: asNumber(summary.totals?.avgTTSttfb),
    cacheHitRate: asNumber(llmSummary?.cacheHitRate ?? summary.totals?.cacheHitRate),
    cachedTokens,
    callId: summary.callId,
    callerPhone: summary.callerPhone ?? "",
    costItems,
    dataPayload,
    durationSec,
    endedAt,
    estimatedCostMicros: costItems.reduce((sum, item) => sum + item.costMicros, 0),
    fallbackUsed: llm.fallbackUsed,
    inputTokens,
    interruptionCount,
    latencyValues,
    llmModel,
    needsReview,
    officePhone: summary.officePhone ?? "",
    outcomeSummary:
      asString(normalizedBody.outcomeSummary) ||
      asString((reviewResult as JudgeResult | null)?.summary) ||
      null,
    outputTokens,
    peakContext: Math.max(
      0,
      Math.round(
        asNumber(llmSummary?.peakPromptTokens ?? summary.totals?.peakContextTokens),
      ),
    ),
    practiceId: asString(normalizedBody.practiceId) || null,
    reviewAverageScore,
    reviewResult,
    reviewStatus,
    startedAt,
    status: normalizedStatus({
      endedAt,
      explicitStatus: normalizedBody.status,
      transferred: toolActions.transferred,
    }),
    summary,
    toolActions,
    toolCalls,
    toolErrors,
    totalTurns: Math.max(0, Math.round(asNumber(summary.totalTurns))),
    ttsChars,
  };
}
