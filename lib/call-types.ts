export type AgentCallStatusValue =
  | "IN_PROGRESS"
  | "COMPLETED"
  | "ESCALATED"
  | "FAILED"
  | "ABANDONED";

export type CostCategoryValue =
  | "LLM_INPUT"
  | "LLM_CACHED_INPUT"
  | "LLM_OUTPUT"
  | "SPEECH_TO_TEXT"
  | "TEXT_TO_SPEECH"
  | "TELEPHONY"
  | "REVIEW"
  | "OTHER";

export type ToolCallRecord = {
  name: string;
  args: string;
  result: string;
  durationMs: number;
  isError: boolean;
};

export type TurnRecord = {
  turn: number;
  callerText: string | null;
  agentText: string | null;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  sttLatencyMs: number;
  ttftMs: number;
  ttsttfbMs: number;
  totalLatencyMs?: number;
  toolCalls: ToolCallRecord[];
};

export type CallSummaryData = {
  callId: string;
  callerPhone: string;
  officePhone?: string;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  totalTurns?: number;
  totals?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    ttsChars?: number;
    cacheHitRate?: number;
    peakContextTokens?: number;
    avgASR?: number;
    toolCalls?: number;
    toolErrors?: number;
    avgTTFT?: number;
    avgTTSttfb?: number;
    avgTotalLatency?: number;
  };
  turns?: TurnRecord[];
  llm?: {
    model: string;
    fallbackUsed: boolean;
    usedModels: string[];
  };
  sessionReport?: SessionReport;
  audioBase64?: string;
  usage?: AgentSessionUsage;
};

export type LiveKitMetric = {
  type: string;
  timestamp?: number;
  [key: string]: unknown;
};

export type ChatHistoryItem = {
  id?: string;
  type: string;
  role?: string;
  content?: (string | { type?: string; transcript?: string })[];
  interrupted?: boolean;
  createdAt?: number;
  metrics?: Record<string, unknown>;
  name?: string;
  callId?: string;
  args?: string;
  output?: string;
  isError?: boolean;
};

export type SessionReport = {
  chat_history?: { items?: ChatHistoryItem[] };
  events?: unknown[];
  usage?: unknown[];
  [key: string]: unknown;
};

export type ModelUsageRecord = {
  type?: string;
  provider?: string;
  model?: string;
  [key: string]: unknown;
};

export type AgentSessionUsage = {
  modelUsage?: ModelUsageRecord[];
  [key: string]: unknown;
};

export type VoiceLanguageTelemetry = {
  acceptedLanguages?: string[];
  currentLanguage?: string;
  initialLanguage?: string;
  languageChanged?: boolean;
  languageSwitches?: number;
  observedLanguages?: string[];
  switchEvents?: Array<{
    createdAt?: string;
    detectedLanguage?: string;
    from?: string;
    languageConfidence?: number;
    reason?: string;
    to?: string;
  }>;
};

export type ToolExecutionAnalytics = {
  callId?: string;
  createdAt?: string;
  outputClass?: string;
  status?: "success" | "error";
  toolName?: string;
};

export type SessionEventAnalytics = {
  close?: {
    createdAt?: string;
    reason?: string;
  };
  errors?: Array<{
    code?: string;
    createdAt?: string;
    messageClass?: string;
    name?: string;
    source?: string;
  }>;
  falseInterruptions?: Array<{
    createdAt?: string;
    resumed?: boolean;
  }>;
  overlappingSpeech?: Array<{
    createdAt?: string;
    durationMs?: number;
    isInterruption?: boolean;
  }>;
};

export type LlmSummary = {
  avgTtftMs?: number;
  cacheHitRate?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
  fallbackUsed?: boolean;
  modelsUsed?: string[];
  peakPromptTokens?: number;
  promptTokens?: number;
};

export type TurnMetricRecord = {
  itemId?: string;
  role?: string;
  type?: string;
  createdAt?: number;
  interrupted?: boolean;
  metrics?: Record<string, unknown>;
};

export type LiveKitWebhookPayload = {
  callId: string;
  callerPhone?: string;
  officePhone?: string;
  practiceId?: string;
  agentId?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  durationSec?: number;
  language?: VoiceLanguageTelemetry;
  llmSummary?: LlmSummary;
  metrics?: LiveKitMetric[];
  llmMetrics?: LiveKitMetric[];
  usage?: AgentSessionUsage;
  sessionEvents?: SessionEventAnalytics;
  turnMetrics?: TurnMetricRecord[];
  toolExecutions?: ToolExecutionAnalytics[];
  sessionReport?: SessionReport;
  audioBase64?: string;
  reviewStatus?: string;
  reviewResult?: unknown;
  outcomeSummary?: string;
  [key: string]: unknown;
};

export type ReviewEvidence = {
  turns?: number[] | null;
  quote?: string | null;
  toolName?: string | null;
};

export type JudgeResult = {
  summary: string;
  passed: boolean;
  outcome: string;
  labels?: {
    hallucination?: string;
    toolPath?: string;
    resolutionPath?: string;
  };
  scores?: Record<string, number>;
  topIssue?: {
    type?: string;
    title?: string;
  } | null;
  findings?: Array<{
    type?: string;
    severity?: string;
    title: string;
    whyItMatters?: string;
    evidence?: ReviewEvidence;
  }>;
  nearMisses?: string[];
  recommendedActions?: Array<{
    owner?: string;
    priority?: string;
    action: string;
  }> | null;
};

export type CostLineEstimate = {
  category: CostCategoryValue;
  provider: string;
  model: string | null;
  quantity: number;
  unit: string;
  costMicros: number;
};
