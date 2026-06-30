import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, List, Star, ThumbsDown, X } from "lucide-react";

import { AudioPlayer } from "@/app/components/audio-player";
import { CopyButton } from "@/app/components/copy-button";
import { LatencyScatterCharts } from "@/app/components/latency-scatter";
import { StatCard } from "@/app/components/stat-card";
import { setCallEvaluationBucketAction } from "@/app/admin/practices/[practiceId]/calls/[callId]/actions";
import {
  SessionTranscriptTimeline,
  TranscriptTimeline,
} from "@/app/components/turn-bubble";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getAdminCallDetail,
  getAdminPracticeCallRows,
  type AdminPracticeRange,
} from "@/lib/admin-analytics";
import {
  getAppointmentActions,
  isResolvedAppointmentAction,
} from "@/lib/appointment-actions";
import {
  getCallListNavigation,
  getPageForCallIndex,
  parseCallTableState,
  searchParamRecordToURLSearchParams,
  writeCallTableStateToParams,
  type CallTableState,
} from "@/lib/admin-call-table-state";
import type {
  CallSummaryData,
  ChatHistoryItem,
  LlmSummary,
  SessionEventAnalytics,
  ToolCallRecord,
  ToolExecutionAnalytics,
  TurnRecord,
  VoiceLanguageTelemetry,
} from "@/lib/call-types";
import {
  computePercentiles,
  deriveTotalLatency,
  formatDuration,
  formatLatencyMs,
  formatPercent,
  formatPhone,
  inverseRateColor,
} from "@/lib/format";

interface ToolInfo {
  count: number;
  failures: number;
}

type CallDetail = NonNullable<Awaited<ReturnType<typeof getAdminCallDetail>>>;
type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

function parseRange(value: string | string[] | undefined): AdminPracticeRange {
  if (value === "24h" || value === "7d" || value === "30d" || value === "all") {
    return value;
  }

  return "24h";
}

function parseOfficeFilter(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

function tableStateWithPage(state: CallTableState, page: number): CallTableState {
  return {
    ...state,
    page,
  };
}

function practiceCallsHref(
  practiceId: string,
  params: URLSearchParams,
  tableState: CallTableState,
) {
  const nextParams = new URLSearchParams(params.toString());
  writeCallTableStateToParams(nextParams, tableState);
  const query = nextParams.toString();
  return `/admin/practices/${practiceId}${query ? `?${query}` : ""}`;
}

function callDetailHref({
  callId,
  page,
  params,
  practiceId,
  tableState,
}: {
  callId: string;
  page: number;
  params: URLSearchParams;
  practiceId: string;
  tableState: CallTableState;
}) {
  const nextParams = new URLSearchParams(params.toString());
  writeCallTableStateToParams(nextParams, tableStateWithPage(tableState, page));
  const query = nextParams.toString();
  return `/admin/practices/${practiceId}/calls/${callId}${query ? `?${query}` : ""}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildToolMap(turns: { toolCalls: ToolCallRecord[] }[]): Map<string, ToolInfo> {
  const map = new Map<string, ToolInfo>();
  for (const turn of turns) {
    for (const toolCall of turn.toolCalls ?? []) {
      const info = map.get(toolCall.name) ?? { count: 0, failures: 0 };
      info.count++;
      if (toolCall.isError) info.failures++;
      map.set(toolCall.name, info);
    }
  }
  return map;
}

function formatToolLabel(name: string): string {
  switch (name) {
    case "book_appt":
    case "book_appointment":
      return "Book";
    case "reschedule_appt":
    case "reschedule_appointment":
      return "Reschedule";
    case "confirm_appt":
      return "Confirm";
    case "cancel_appt":
    case "cancel_appointment":
      return "Cancel";
    case "transfer_call":
      return "Transfer";
    default:
      return name.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function getSummary(call: CallDetail): CallSummaryData {
  if (isRecord(call.data)) {
    return call.data as CallSummaryData;
  }

  return {
    callId: call.callId,
    callerPhone: call.callerPhone,
    durationSec: call.durationSec,
    officePhone: call.officePhone,
    startedAt: call.startedAt.toISOString(),
    totalTurns: call.totalTurns,
    totals: {
      cacheHitRate: call.cacheHitRate,
      cachedTokens: call.cachedTokens,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      peakContextTokens: call.peakContext,
      toolCalls: call.toolCalls,
      toolErrors: call.toolErrors,
    },
    turns: [],
  };
}

function getToolCalls(turns: TurnRecord[]) {
  return turns.flatMap((turn) => turn.toolCalls ?? []);
}

function getPayloadRecord(data: CallSummaryData): Record<string, unknown> {
  return isRecord(data) ? data : {};
}

function getLanguageTelemetry(data: CallSummaryData): VoiceLanguageTelemetry | null {
  const language = getPayloadRecord(data).language;
  return isRecord(language) ? (language as VoiceLanguageTelemetry) : null;
}

function getSessionEvents(data: CallSummaryData): SessionEventAnalytics | null {
  const sessionEvents = getPayloadRecord(data).sessionEvents;
  return isRecord(sessionEvents) ? (sessionEvents as SessionEventAnalytics) : null;
}

function getToolExecutions(data: CallSummaryData): ToolExecutionAnalytics[] {
  const toolExecutions = getPayloadRecord(data).toolExecutions;
  return Array.isArray(toolExecutions)
    ? toolExecutions.filter(isRecord).map((tool) => ({
        ...(typeof tool.callId === "string" ? { callId: tool.callId } : {}),
        ...(typeof tool.createdAt === "string" ? { createdAt: tool.createdAt } : {}),
        ...(typeof tool.outputClass === "string"
          ? { outputClass: tool.outputClass }
          : {}),
        ...(tool.status === "success" || tool.status === "error"
          ? { status: tool.status }
          : {}),
        ...(typeof tool.toolName === "string" ? { toolName: tool.toolName } : {}),
      }))
    : [];
}

function getLlmSummary(data: CallSummaryData): LlmSummary | null {
  const llmSummary = getPayloadRecord(data).llmSummary;
  return isRecord(llmSummary) ? (llmSummary as LlmSummary) : null;
}

function formatLanguageLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.toUpperCase();
}

function hasTransfer(toolMap: Map<string, ToolInfo>, call: CallDetail) {
  return call.transferred || toolMap.has("transfer_call");
}

function getEvaluationLabel(call: CallDetail) {
  return (
    call.evaluationLabels.find((label) => label.bucket === "BAD") ??
    call.evaluationLabels.find((label) => label.bucket === "GOLDEN") ??
    null
  );
}

function CallEvaluationEditor({
  callId,
  currentBucket,
  currentComment,
  practiceId,
}: {
  callId: string;
  currentBucket: "BAD" | "GOLDEN" | null;
  currentComment: string | null;
  practiceId: string;
}) {
  return (
    <form action={setCallEvaluationBucketAction} className="w-full space-y-3">
      <input type="hidden" name="practiceId" value={practiceId} />
      <input type="hidden" name="callId" value={callId} />
      <div className="space-y-1.5">
        <label
          className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"
          htmlFor="evaluation-comment"
        >
          Reviewer comment
        </label>
        <textarea
          className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2"
          defaultValue={currentComment ?? ""}
          id="evaluation-comment"
          maxLength={2000}
          name="comment"
          placeholder="Why should this call be in this eval set?"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          name="bucket"
          type="submit"
          value="GOLDEN"
          variant={currentBucket === "GOLDEN" ? "secondary" : "outline"}
        >
          <Star className={currentBucket === "GOLDEN" ? "fill-current" : ""} />
          {currentBucket === "GOLDEN" ? "Save Golden" : "Golden"}
        </Button>
        <Button
          name="bucket"
          type="submit"
          value="BAD"
          variant={currentBucket === "BAD" ? "destructive" : "outline"}
        >
          <ThumbsDown />
          {currentBucket === "BAD" ? "Save Bad" : "Bad"}
        </Button>
        {currentBucket ? (
          <Button name="bucket" type="submit" value="CLEAR" variant="ghost">
            <X />
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export default async function AdminCallDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ callId: string; practiceId: string }>;
  searchParams?: SearchParamsInput;
}) {
  const [{ callId, practiceId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>),
  ]);
  const range = parseRange(resolvedSearchParams.range);
  const office = parseOfficeFilter(resolvedSearchParams.office);
  const tableState = parseCallTableState(resolvedSearchParams);
  const urlParams = searchParamRecordToURLSearchParams(resolvedSearchParams);
  const [call, callRowsResult] = await Promise.all([
    getAdminCallDetail(practiceId, callId),
    getAdminPracticeCallRows(practiceId, range, office),
  ]);

  if (!call) notFound();

  const callNavigation = callRowsResult
    ? getCallListNavigation(callRowsResult.callRows, tableState, call.id)
    : null;
  const currentPage = callNavigation?.currentPage ?? tableState.page;
  const backHref = practiceCallsHref(
    practiceId,
    urlParams,
    tableStateWithPage(tableState, currentPage),
  );
  const previousHref = callNavigation?.previousCall
    ? callDetailHref({
        callId: callNavigation.previousCall.id,
        page: getPageForCallIndex(callNavigation.currentIndex - 1),
        params: urlParams,
        practiceId,
        tableState,
      })
    : null;
  const nextHref = callNavigation?.nextCall
    ? callDetailHref({
        callId: callNavigation.nextCall.id,
        page: getPageForCallIndex(callNavigation.currentIndex + 1),
        params: urlParams,
        practiceId,
        tableState,
      })
    : null;

  const data = getSummary(call);
  const turns = data.turns ?? [];
  const totals = data.totals ?? {};
  const llm = {
    fallbackUsed: call.fallbackUsed || Boolean(data.llm?.fallbackUsed),
    model: call.llmModel || data.llm?.model || "Unknown",
    usedModels: data.llm?.usedModels ?? (call.llmModel ? [call.llmModel] : []),
  };
  const durationSec = data.durationSec ?? call.durationSec;
  const totalTurns = data.totalTurns ?? call.totalTurns;
  const inputTokens = totals.inputTokens ?? call.inputTokens;
  const outputTokens = totals.outputTokens ?? call.outputTokens;
  const cachedTokens = totals.cachedTokens ?? call.cachedTokens;
  const cacheHitRate =
    totals.cacheHitRate ??
    (inputTokens > 0 ? cachedTokens / inputTokens : call.cacheHitRate);
  const peakContextTokens = totals.peakContextTokens ?? call.peakContext;

  const ttftValues = turns.map((turn) => turn.ttftMs).filter((value) => value > 0);
  const ttsValues = turns.map((turn) => turn.ttsttfbMs).filter((value) => value > 0);
  const sttValues = turns
    .filter((turn) => turn.sttLatencyMeasured || (turn.sttLatencyMs ?? 0) > 0)
    .map((turn) => turn.sttLatencyMs ?? 0);
  const totalLatencyValues = turns
    .map((turn) => deriveTotalLatency(turn))
    .filter((value) => value > 0);
  const latencyFallback = isRecord(call.latencyValues)
    ? {
        stt: Array.isArray(call.latencyValues.stt)
          ? call.latencyValues.stt.filter(
              (value): value is number => typeof value === "number",
            )
          : [],
        total: Array.isArray(call.latencyValues.totalLatency)
          ? call.latencyValues.totalLatency.filter(
              (value): value is number => typeof value === "number",
            )
          : [],
        tts: Array.isArray(call.latencyValues.ttsttfb)
          ? call.latencyValues.ttsttfb.filter(
              (value): value is number => typeof value === "number",
            )
          : [],
        ttft: Array.isArray(call.latencyValues.ttft)
          ? call.latencyValues.ttft.filter(
              (value): value is number => typeof value === "number",
            )
          : [],
      }
    : { stt: [], total: [], tts: [], ttft: [] };

  const p50Ttft = computePercentiles(
    ttftValues.length ? ttftValues : latencyFallback.ttft,
  ).p50;
  const p50Tts = computePercentiles(
    ttsValues.length ? ttsValues : latencyFallback.tts,
  ).p50;
  const sttPercentileValues = sttValues.length ? sttValues : latencyFallback.stt;
  const p50Stt = computePercentiles(sttPercentileValues).p50;
  const p50Total = computePercentiles(
    totalLatencyValues.length ? totalLatencyValues : latencyFallback.total,
  ).p50;
  const toolMap = buildToolMap(turns);
  const totalFailures = [...toolMap.values()].reduce(
    (sum, info) => sum + info.failures,
    0,
  );
  const successfulActions = [...toolMap.entries()]
    .filter(([, info]) => info.count > info.failures)
    .map(([tool]) => formatToolLabel(tool))
    .filter((label) => label !== "Transfer");
  const failedTools = [...toolMap.entries()]
    .filter(([, info]) => info.failures > 0)
    .map(([tool, info]) => ({
      failures: info.failures,
      label: formatToolLabel(tool),
    }));
  const rawJson = JSON.stringify(data, null, 2);
  const sessionItems = data.sessionReport?.chat_history?.items ?? [];
  const languageTelemetry = getLanguageTelemetry(data);
  const sessionEvents = getSessionEvents(data);
  const toolExecutions = getToolExecutions(data);
  const appointmentActions = getAppointmentActions(data);
  const llmSummary = getLlmSummary(data);
  const runtimeErrors = Array.isArray(sessionEvents?.errors) ? sessionEvents.errors : [];
  const falseInterruptions = Array.isArray(sessionEvents?.falseInterruptions)
    ? sessionEvents.falseInterruptions
    : [];
  const overlappingSpeech = Array.isArray(sessionEvents?.overlappingSpeech)
    ? sessionEvents.overlappingSpeech
    : [];
  const acceptedLanguages = Array.isArray(languageTelemetry?.acceptedLanguages)
    ? languageTelemetry.acceptedLanguages
    : [];
  const evaluationLabel = getEvaluationLabel(call);
  const evaluationBucket = evaluationLabel?.bucket ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/80 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={backHref}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          <List className="h-4 w-4" />
          Back to calls
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            aria-disabled={!previousHref}
            className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium transition ${
              previousHref
                ? "text-foreground hover:bg-muted"
                : "pointer-events-none text-muted-foreground opacity-50"
            }`}
            href={previousHref ?? backHref}
          >
            <ArrowLeft className="h-4 w-4" />
            Previous call
          </Link>
          <Link
            aria-disabled={!nextHref}
            className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium transition ${
              nextHref
                ? "text-foreground hover:bg-muted"
                : "pointer-events-none text-muted-foreground opacity-50"
            }`}
            href={nextHref ?? backHref}
          >
            Next call
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Call Detail
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            {formatPhone(data.callerPhone || call.callerPhone)}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatPhone(data.callerPhone || call.callerPhone)} &middot;{" "}
          {new Date(data.startedAt || call.startedAt).toLocaleString("en-US", {
            timeZone: "America/New_York",
          })}
        </p>
        <div className="flex flex-wrap gap-2">
          {successfulActions.map((action) => (
            <Badge key={action} variant="secondary">
              {action}
            </Badge>
          ))}
          {hasTransfer(toolMap, call) && <Badge variant="outline">Transfer</Badge>}
          {llm.fallbackUsed && <Badge variant="destructive">Fallback used</Badge>}
          {languageTelemetry?.languageChanged && (
            <Badge variant="outline">
              Language: {formatLanguageLabel(languageTelemetry.currentLanguage)}
            </Badge>
          )}
          {runtimeErrors.length > 0 && (
            <Badge variant="destructive">
              {runtimeErrors.length} runtime error
              {runtimeErrors.length === 1 ? "" : "s"}
            </Badge>
          )}
          {totalFailures > 0 && (
            <Badge variant="destructive">
              {totalFailures} tool failure{totalFailures === 1 ? "" : "s"}
            </Badge>
          )}
          {evaluationBucket === "GOLDEN" && (
            <Badge variant="secondary" className="gap-1">
              <Star className="h-3.5 w-3.5 fill-current" />
              Golden
            </Badge>
          )}
          {evaluationBucket === "BAD" && (
            <Badge variant="destructive" className="gap-1">
              <ThumbsDown className="h-3.5 w-3.5" />
              Bad
            </Badge>
          )}
        </div>
      </div>

      <Card className="border-border/70 bg-card/80 shadow-sm">
        <CardHeader>
          <CardTitle>Eval Set</CardTitle>
          <CardDescription>Manual admin label for this call.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <CallEvaluationEditor
            callId={call.id}
            currentBucket={evaluationBucket}
            currentComment={evaluationLabel?.comment ?? null}
            practiceId={practiceId}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle>Call Snapshot</CardTitle>
            <CardDescription>
              What happened on this call and how expensive it was to process.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Duration" value={formatDuration(durationSec)} />
            <StatCard label="Turns" value={String(totalTurns)} />
            <StatCard label="Input Tokens" value={inputTokens.toLocaleString()} />
            <StatCard label="Output Tokens" value={outputTokens.toLocaleString()} />
            <StatCard label="Cache Efficiency" value={formatPercent(cacheHitRate)} />
            <StatCard
              label="Peak Context"
              value={peakContextTokens.toLocaleString()}
              sub="tokens"
            />
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle>Latency</CardTitle>
            <CardDescription>
              LiveKit per-turn response metrics from the session report.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatCard
              label="P50 STT Final"
              value={sttPercentileValues.length > 0 ? formatLatencyMs(p50Stt) : "--"}
            />
            <StatCard
              label="P50 TTFT"
              value={p50Ttft > 0 ? formatLatencyMs(p50Ttft) : "--"}
            />
            <StatCard
              label="P50 TTS TTFB"
              value={p50Tts > 0 ? formatLatencyMs(p50Tts) : "--"}
            />
            <StatCard
              label="P50 E2E"
              value={p50Total > 0 ? formatLatencyMs(p50Total) : "--"}
            />
            <StatCard
              label="Interruptions"
              value={String(call.interruptionCount)}
              sub={
                totalTurns > 0
                  ? `${formatPercent(call.interruptionCount / totalTurns)} of turns`
                  : undefined
              }
              color={inverseRateColor(
                totalTurns > 0 ? call.interruptionCount / totalTurns : 0,
                0.15,
                0.35,
              )}
            />
            {llm.fallbackUsed && (
              <StatCard label="Fallback" value="Yes" color="text-red-500" />
            )}
          </CardContent>
        </Card>
      </div>

      {(languageTelemetry ||
        sessionEvents ||
        llmSummary ||
        appointmentActions.length > 0 ||
        toolExecutions.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <Card className="border-border/70 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle>Runtime Signals</CardTitle>
              <CardDescription>
                Call-level events captured directly from the agent runtime.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatCard
                label="Language"
                value={
                  languageTelemetry?.languageChanged
                    ? "Changed"
                    : languageTelemetry
                      ? "No change"
                      : "--"
                }
                sub={
                  languageTelemetry
                    ? `Final ${formatLanguageLabel(languageTelemetry.currentLanguage)}`
                    : undefined
                }
              />
              <StatCard
                label="Accepted"
                value={
                  acceptedLanguages.length > 0
                    ? acceptedLanguages.map(formatLanguageLabel).join(" -> ")
                    : "--"
                }
              />
              <StatCard label="Runtime Errors" value={String(runtimeErrors.length)} />
              <StatCard
                label="False Interruptions"
                value={String(falseInterruptions.length)}
              />
              <StatCard
                label="Overlapping Speech"
                value={String(overlappingSpeech.length)}
              />
              <StatCard
                label="Close Reason"
                value={sessionEvents?.close?.reason ?? "--"}
              />
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle>Model And Tool Signals</CardTitle>
              <CardDescription>
                Sanitized execution data for dashboards and diagnostics.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {llmSummary ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <StatCard
                    label="Models Used"
                    value={String(llmSummary.modelsUsed?.length ?? 0)}
                    sub={llmSummary.modelsUsed?.join(", ") || undefined}
                  />
                  <StatCard
                    label="Fallback"
                    value={(llmSummary.fallbackUsed ?? llm.fallbackUsed) ? "Yes" : "No"}
                  />
                  <StatCard
                    label="Cache Hit"
                    value={formatPercent(llmSummary.cacheHitRate ?? cacheHitRate)}
                  />
                  <StatCard
                    label="Avg TTFT"
                    value={
                      llmSummary.avgTtftMs ? formatLatencyMs(llmSummary.avgTtftMs) : "--"
                    }
                  />
                </div>
              ) : null}

              {toolExecutions.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Tool Executions</p>
                  <div className="flex flex-wrap gap-2">
                    {toolExecutions.map((tool, index) => (
                      <Badge
                        key={`${tool.callId ?? tool.toolName}-${index}`}
                        variant={tool.status === "error" ? "destructive" : "outline"}
                      >
                        {formatToolLabel(tool.toolName ?? "unknown")}
                        {tool.outputClass ? ` · ${tool.outputClass}` : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No sanitized tool execution records were posted.
                </p>
              )}

              {appointmentActions.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    Appointment Actions
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {appointmentActions.map((action, index) => (
                      <Badge
                        key={`${action.action}-${action.createdAt ?? index}`}
                        variant={
                          action.status === "error"
                            ? "destructive"
                            : isResolvedAppointmentAction(action)
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {action.action}
                        {action.status ? ` · ${action.status}` : ""}
                        {action.toolName ? ` · ${formatToolLabel(action.toolName)}` : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      {(successfulActions.length > 0 || failedTools.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-border/70 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle>Actions Taken</CardTitle>
              <CardDescription>
                Successful tool actions completed during the call.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {successfulActions.length > 0 ? (
                successfulActions.map((action) => (
                  <Badge key={action} variant="secondary">
                    {action}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">
                  No successful actions.
                </span>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle>Tool Failures</CardTitle>
              <CardDescription>
                Only surfaced when something actually failed.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {failedTools.length > 0 ? (
                failedTools.map((tool) => (
                  <Badge key={tool.label} variant="destructive">
                    {tool.label}
                    {tool.failures > 1 ? ` ${tool.failures}` : ""}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">No tool failures.</span>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <AudioPlayer callId={call.id} />

      <details className="group rounded-xl border border-border/70 bg-card/60">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
          Diagnostics
        </summary>
        <div className="space-y-6 border-t px-4 py-4">
          {turns.length > 0 ? <LatencyScatterCharts turns={turns} /> : null}
        </div>
      </details>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Transcript</h2>
        {sessionItems.length > 0 ? (
          (() => {
            const chatItems = sessionItems as ChatHistoryItem[];
            if (turns.length > 0) {
              let turnIndex = -1;
              for (const item of chatItems) {
                if (item.type === "message" && item.role === "user") {
                  turnIndex++;
                  const turn = turns[turnIndex];
                  if (
                    turn &&
                    item.metrics?.stt_latency == null &&
                    (turn.sttLatencyMeasured || (turn.sttLatencyMs ?? 0) > 0)
                  ) {
                    item.metrics = {
                      ...(item.metrics ?? {}),
                      ...(turn.sttConfidence != null
                        ? { stt_confidence: turn.sttConfidence }
                        : {}),
                      stt_latency: turn.sttLatencyMs,
                    };
                  }
                }
                if (
                  item.type === "message" &&
                  item.role === "assistant" &&
                  turnIndex >= 0
                ) {
                  const turn = turns[turnIndex];
                  if (
                    turn &&
                    !item.metrics?.llm_node_ttft &&
                    !item.metrics?.tts_node_ttfb
                  ) {
                    item.metrics = {
                      ...(item.metrics ?? {}),
                      llm_node_ttft: turn.ttftMs,
                      tts_node_ttfb: turn.ttsttfbMs,
                    };
                  }
                }
              }
            }
            return <SessionTranscriptTimeline items={chatItems} />;
          })()
        ) : (
          <TranscriptTimeline turns={turns} />
        )}
      </section>

      <details className="group">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
          Raw JSON Payload
        </summary>
        <div className="mt-2 flex justify-end">
          <CopyButton text={rawJson} />
        </div>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg border bg-muted/50 p-4 text-xs">
          {rawJson}
        </pre>
      </details>
    </div>
  );
}
