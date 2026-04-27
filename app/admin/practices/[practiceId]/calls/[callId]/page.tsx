import Link from "next/link";
import { notFound } from "next/navigation";
import type React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Database,
  Headphones,
  PhoneCall,
  Timer,
  Wrench,
} from "lucide-react";

import { Badge } from "@/app/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { getAdminCallDetail } from "@/lib/admin-analytics";
import {
  formatAdminDateTime,
  formatCostMicros,
  formatDuration,
  formatLatencyMs,
  formatPhone,
  formatRate,
} from "@/lib/admin-format";
import type {
  CallSummaryData,
  ChatHistoryItem,
  JudgeResult,
  ToolCallRecord,
  TurnRecord,
} from "@/lib/call-types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type CallDetail = NonNullable<Awaited<ReturnType<typeof getAdminCallDetail>>>;

const REVIEW_SCORE_LABELS: Array<{ key: string; label: string }> = [
  { key: "grounding", label: "Grounding" },
  { key: "toolUseCorrectness", label: "Tool use" },
  { key: "workflowEfficiency", label: "Workflow" },
  { key: "intentHandling", label: "Intent" },
  { key: "resolutionQuality", label: "Resolution" },
  { key: "conversationQuality", label: "Conversation" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getSummary(call: CallDetail): CallSummaryData | null {
  if (!isRecord(call.data)) {
    return null;
  }

  if (Array.isArray(call.data.turns)) {
    return call.data as CallSummaryData;
  }

  return null;
}

function getTurns(summary: CallSummaryData | null) {
  return summary?.turns ?? [];
}

function getReviewResult(call: CallDetail) {
  if (isRecord(call.reviewResult)) {
    return call.reviewResult as JudgeResult;
  }

  if (isRecord(call.data) && isRecord(call.data.reviewResult)) {
    return call.data.reviewResult as JudgeResult;
  }

  return null;
}

function getReviewAverage(result: JudgeResult | null) {
  const scores = result?.scores;

  if (!scores) {
    return null;
  }

  const values = Object.values(scores).filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );

  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function getContentText(content?: ChatHistoryItem["content"]) {
  if (!content) {
    return "";
  }

  return content
    .map((item) => (typeof item === "string" ? item : item.transcript ?? ""))
    .join(" ")
    .trim();
}

function formatToolName(name: string) {
  const labels: Record<string, string> = {
    book_appt: "Book appointment",
    cancel_appt: "Cancel appointment",
    confirm_appt: "Confirm appointment",
    transfer_call: "Transfer call",
  };

  return labels[name] ?? name.replace(/_/g, " ");
}

function getToolCalls(turns: TurnRecord[]) {
  return turns.flatMap((turn) =>
    (turn.toolCalls ?? []).map((tool) => ({
      ...tool,
      turn: turn.turn,
    })),
  );
}

function getToolStats(tools: Array<ToolCallRecord & { turn: number }>) {
  const stats = new Map<string, { count: number; errors: number }>();

  for (const tool of tools) {
    const current = stats.get(tool.name) ?? { count: 0, errors: 0 };
    current.count++;
    if (tool.isError) {
      current.errors++;
    }
    stats.set(tool.name, current);
  }

  return [...stats.entries()].map(([name, value]) => ({
    name,
    ...value,
  }));
}

function parseJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function CallBadge({ status }: { status: string }) {
  const isBad = status === "FAILED" || status === "ABANDONED";
  const isEscalated = status === "ESCALATED";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        isBad
          ? "border-red-200 bg-red-50 text-red-700"
          : isEscalated
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-emerald-200 bg-emerald-50 text-emerald-700",
      )}
    >
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

function StatTile({
  icon: Icon,
  label,
  sub,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub?: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-black/6 bg-white px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#748588]">
          {label}
        </p>
        <Icon className="h-4 w-4 text-[#0d7377]" aria-hidden="true" />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#10272c]">
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-[#617477]">{sub}</p> : null}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-black/12 bg-[#f8fbfa] px-4 py-8 text-center text-sm text-[#617477]">
      {children}
    </div>
  );
}

function ReviewPanel({
  call,
  reviewResult,
}: {
  call: CallDetail;
  reviewResult: JudgeResult | null;
}) {
  const average = getReviewAverage(reviewResult);

  if (!reviewResult) {
    return (
      <Card className="rounded-xl border-black/8 bg-white">
        <CardHeader>
          <CardTitle className="text-lg">Review result</CardTitle>
          <CardDescription>The review worker result appears here once migrated into the portal.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#617477]">
            Status: {call.reviewStatus || (call.needsReview ? "needs_review" : "not_reviewed")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border-black/8 bg-white">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Review result</CardTitle>
            <CardDescription>Grounding, tool use, and outcome review.</CardDescription>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "w-fit",
              reviewResult.passed
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-red-200 bg-red-50 text-red-700",
            )}
          >
            {reviewResult.passed ? "Pass" : "Needs attention"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border border-black/6 bg-[#f8fbfa] px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#748588]">
            Summary
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[#10272c]">
            {reviewResult.summary}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {average ? <Badge variant="outline">Average {average.toFixed(1)}/5</Badge> : null}
          {reviewResult.labels?.hallucination ? (
            <Badge variant="outline">Hallucination {reviewResult.labels.hallucination}</Badge>
          ) : null}
          {reviewResult.labels?.toolPath ? (
            <Badge variant="outline">Tools {reviewResult.labels.toolPath}</Badge>
          ) : null}
          {reviewResult.labels?.resolutionPath ? (
            <Badge variant="outline">Path {reviewResult.labels.resolutionPath}</Badge>
          ) : null}
          {reviewResult.outcome ? (
            <Badge variant="outline">Outcome {reviewResult.outcome.replace(/_/g, " ")}</Badge>
          ) : null}
        </div>

        {reviewResult.scores ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {REVIEW_SCORE_LABELS.map((item) => {
              const score = reviewResult.scores?.[item.key];
              if (!score) {
                return null;
              }

              return (
                <div key={item.key} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[#10272c]">{item.label}</p>
                    <p className="font-mono text-sm text-[#617477]">{score}/5</p>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-[#eef5f3]">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        score >= 4 ? "bg-emerald-500" : score >= 3 ? "bg-amber-500" : "bg-red-500",
                      )}
                      style={{ width: `${(score / 5) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {reviewResult.findings && reviewResult.findings.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-[#10272c]">Findings</p>
            {reviewResult.findings.slice(0, 5).map((finding, index) => (
              <div key={`${finding.title}-${index}`} className="rounded-lg border border-black/6 bg-white px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {finding.severity ? (
                    <span className="rounded-full border border-black/8 px-2 py-0.5 text-xs font-semibold text-[#617477]">
                      {finding.severity}
                    </span>
                  ) : null}
                  <p className="font-semibold text-[#10272c]">{finding.title}</p>
                </div>
                {finding.whyItMatters ? (
                  <p className="mt-2 text-sm text-[#617477]">{finding.whyItMatters}</p>
                ) : null}
                {finding.evidence?.quote ? (
                  <p className="mt-2 rounded-md bg-[#f8fbfa] px-3 py-2 text-xs text-[#617477]">
                    {finding.evidence.quote}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ToolsPanel({ tools }: { tools: Array<ToolCallRecord & { turn: number }> }) {
  const stats = getToolStats(tools);

  return (
    <Card className="rounded-xl border-black/8 bg-white">
      <CardHeader>
        <CardTitle className="text-lg">Tools used</CardTitle>
        <CardDescription>Tool calls, durations, and failures captured from the session report.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {stats.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {stats.map((tool) => (
              <Badge
                key={tool.name}
                variant="outline"
                className={tool.errors > 0 ? "border-red-200 bg-red-50 text-red-700" : "bg-[#f8fbfa]"}
              >
                {formatToolName(tool.name)} {tool.count}
              </Badge>
            ))}
          </div>
        ) : (
          <EmptyState>No tools were called during this conversation.</EmptyState>
        )}

        {tools.length > 0 ? (
          <div className="space-y-2">
            {tools.map((tool, index) => (
              <details key={`${tool.name}-${tool.turn}-${index}`} className="rounded-lg border border-black/6 bg-[#f8fbfa] px-3 py-3">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm font-semibold text-[#10272c] [&::-webkit-details-marker]:hidden">
                  <Wrench className="h-4 w-4 text-[#0d7377]" aria-hidden="true" />
                  {formatToolName(tool.name)}
                  <span className="font-mono text-xs text-[#748588]">turn {tool.turn}</span>
                  {tool.durationMs > 0 ? (
                    <span className="rounded-full bg-white px-2 py-0.5 font-mono text-xs text-[#617477]">
                      {formatLatencyMs(tool.durationMs)}
                    </span>
                  ) : null}
                  {tool.isError ? (
                    <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700">
                      error
                    </span>
                  ) : null}
                </summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#748588]">
                      Input
                    </p>
                    <pre className="max-h-48 overflow-auto rounded-md bg-white p-3 text-xs text-[#10272c]">
                      {parseJson(tool.args || "{}")}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#748588]">
                      Output
                    </p>
                    <pre className="max-h-48 overflow-auto rounded-md bg-white p-3 text-xs text-[#10272c]">
                      {parseJson(tool.result || "")}
                    </pre>
                  </div>
                </div>
              </details>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TranscriptPanel({
  items,
  turns,
}: {
  items: ChatHistoryItem[];
  turns: TurnRecord[];
}) {
  const hasSessionItems = items.length > 0;

  return (
    <Card className="rounded-xl border-black/8 bg-white">
      <CardHeader>
        <CardTitle className="text-lg">Transcript</CardTitle>
        <CardDescription>Caller, agent, and tool events in call order.</CardDescription>
      </CardHeader>
      <CardContent>
        {hasSessionItems ? (
          <div className="space-y-3">
            {items.map((item, index) => {
              if (item.type === "message" && (item.role === "user" || item.role === "assistant")) {
                const text = getContentText(item.content);
                if (!text) {
                  return null;
                }

                const isUser = item.role === "user";
                const metrics = item.metrics as Record<string, number> | undefined;

                return (
                  <div key={item.id ?? index} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[88%] rounded-2xl px-4 py-3",
                        isUser
                          ? "rounded-br-md bg-[#0d7377] text-white"
                          : "rounded-bl-md bg-[#f2f6f5] text-[#10272c]",
                      )}
                    >
                      <p className={cn("text-xs font-semibold", isUser ? "text-white/70" : "text-[#617477]")}>
                        {isUser ? "Caller" : "Agent"}
                      </p>
                      <p className={cn("mt-1 text-sm leading-relaxed", isUser ? "text-white" : "text-[#10272c]")}>
                        {text}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.interrupted ? (
                          <span className={cn("rounded-full px-2 py-0.5 text-xs", isUser ? "bg-white/15 text-white" : "bg-white text-[#617477]")}>
                            interrupted
                          </span>
                        ) : null}
                        {metrics?.stt_latency ? (
                          <span className="rounded-full bg-white/80 px-2 py-0.5 font-mono text-xs text-[#617477]">
                            STT {formatLatencyMs(metrics.stt_latency)}
                          </span>
                        ) : null}
                        {metrics?.llm_node_ttft ? (
                          <span className="rounded-full bg-white px-2 py-0.5 font-mono text-xs text-[#617477]">
                            TTFT {formatLatencyMs(metrics.llm_node_ttft)}
                          </span>
                        ) : null}
                        {metrics?.tts_node_ttfb ? (
                          <span className="rounded-full bg-white px-2 py-0.5 font-mono text-xs text-[#617477]">
                            TTS {formatLatencyMs(metrics.tts_node_ttfb)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              }

              if (item.type === "function_call" || item.type === "function_call_output") {
                return (
                  <div key={item.id ?? index} className="max-w-[88%] rounded-lg border border-black/6 bg-[#f8fbfa] px-3 py-2 text-xs text-[#617477]">
                    <span className="font-semibold text-[#10272c]">
                      {item.type === "function_call" ? "Tool input" : "Tool output"}
                    </span>
                    {item.name ? ` · ${formatToolName(item.name)}` : null}
                  </div>
                );
              }

              return null;
            })}
          </div>
        ) : turns.length > 0 ? (
          <div className="space-y-3">
            {turns.map((turn) => (
              <div key={turn.turn} className="space-y-2">
                {turn.callerText ? (
                  <div className="flex justify-end">
                    <div className="max-w-[88%] rounded-2xl rounded-br-md bg-[#0d7377] px-4 py-3">
                      <p className="text-xs font-semibold text-white/70">Caller</p>
                      <p className="mt-1 text-sm text-white">{turn.callerText}</p>
                    </div>
                  </div>
                ) : null}
                {turn.agentText ? (
                  <div className="flex justify-start">
                    <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-[#f2f6f5] px-4 py-3">
                      <p className="text-xs font-semibold text-[#617477]">Agent</p>
                      <p className="mt-1 text-sm text-[#10272c]">{turn.agentText}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No transcript has been stored for this call.</EmptyState>
        )}
      </CardContent>
    </Card>
  );
}

export default async function AdminCallDetailPage({
  params,
}: {
  params: Promise<{ callId: string; practiceId: string }>;
}) {
  const { callId, practiceId } = await params;
  const call = await getAdminCallDetail(practiceId, callId);

  if (!call) {
    notFound();
  }

  const summary = getSummary(call);
  const turns = getTurns(summary);
  const sessionItems = summary?.sessionReport?.chat_history?.items ?? [];
  const tools = getToolCalls(turns);
  const reviewResult = getReviewResult(call);
  const audioSrc = `/api/admin/calls/${call.id}/audio`;
  const rawJson = JSON.stringify(call.data ?? {}, null, 2);
  const totalLatencyValues = isRecord(call.latencyValues) && Array.isArray(call.latencyValues.totalLatency)
    ? call.latencyValues.totalLatency.filter((value): value is number => typeof value === "number")
    : [];
  const averageTotalLatency =
    totalLatencyValues.length > 0
      ? totalLatencyValues.reduce((sum, value) => sum + value, 0) / totalLatencyValues.length
      : 0;

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <Link
          href={`/admin/practices/${practiceId}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#0d7377] hover:text-[#0a5c5f]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {call.practice.name}
        </Link>

        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#6a7b7e]">
              Call Detail
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
              {formatPhone(call.callerPhone)}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#617477]">
              {formatAdminDateTime(call.startedAt)} · {formatPhone(call.officePhone)}
              {call.location ? ` · ${call.location.name}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CallBadge status={call.status} />
            {call.needsReview ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                Needs review
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Clear
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatTile icon={PhoneCall} label="Duration" value={formatDuration(call.durationSec)} />
        <StatTile icon={Clock3} label="Turns" value={`${call.totalTurns}`} />
        <StatTile icon={Timer} label="Avg TTFT" value={formatLatencyMs(call.avgTtft)} />
        <StatTile icon={Headphones} label="Avg TTS" value={formatLatencyMs(call.avgTtsttfb)} />
        <StatTile icon={Timer} label="Total Latency" value={formatLatencyMs(averageTotalLatency)} />
        <StatTile icon={Database} label="Cost" value={formatCostMicros(call.estimatedCostMicros)} />
      </section>

      {call.audioData ? (
        <Card className="rounded-xl border-black/8 bg-white">
          <CardHeader>
            <CardTitle className="text-lg">Call recording</CardTitle>
            <CardDescription>Stored from the LiveKit session report when the recording is small enough to forward.</CardDescription>
          </CardHeader>
          <CardContent>
            <audio controls preload="metadata" className="w-full" src={audioSrc} />
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <TranscriptPanel items={sessionItems} turns={turns} />
        <div className="space-y-6">
          <ReviewPanel call={call} reviewResult={reviewResult} />
          <ToolsPanel tools={tools} />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card className="rounded-xl border-black/8 bg-white">
          <CardHeader>
            <CardTitle className="text-lg">Performance</CardTitle>
            <CardDescription>Technical latency and model usage for this call.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-black/6 bg-[#f8fbfa] px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#748588]">
                Model
              </p>
              <p className="mt-1 text-sm font-semibold text-[#10272c]">
                {call.llmModel || "Unknown"}
              </p>
            </div>
            <div className="rounded-lg border border-black/6 bg-[#f8fbfa] px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#748588]">
                Fallback
              </p>
              <p className="mt-1 text-sm font-semibold text-[#10272c]">
                {call.fallbackUsed ? "Used" : "Not used"}
              </p>
            </div>
            <div className="rounded-lg border border-black/6 bg-[#f8fbfa] px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#748588]">
                Tokens
              </p>
              <p className="mt-1 text-sm font-semibold text-[#10272c]">
                {call.inputTokens.toLocaleString()} in · {call.outputTokens.toLocaleString()} out
              </p>
            </div>
            <div className="rounded-lg border border-black/6 bg-[#f8fbfa] px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#748588]">
                Cache Hit
              </p>
              <p className="mt-1 text-sm font-semibold text-[#10272c]">
                {formatRate(call.cacheHitRate)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-black/8 bg-white">
          <CardHeader>
            <CardTitle className="text-lg">Cost line items</CardTitle>
            <CardDescription>Estimated provider costs until exact billing ingestion is connected.</CardDescription>
          </CardHeader>
          <CardContent>
            {call.costLineItems.length > 0 ? (
              <div className="space-y-2">
                {call.costLineItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-black/6 px-3 py-3">
                    <div>
                      <p className="text-sm font-semibold text-[#10272c]">
                        {item.category.replace(/_/g, " ").toLowerCase()}
                      </p>
                      <p className="text-xs text-[#617477]">
                        {item.quantity.toLocaleString()} {item.unit}
                      </p>
                    </div>
                    <p className="font-mono text-sm text-[#10272c]">
                      {formatCostMicros(item.costMicros)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState>No cost line items have been stored for this call.</EmptyState>
            )}
          </CardContent>
        </Card>
      </section>

      <details className="group rounded-xl border border-black/8 bg-white">
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-[#10272c] [&::-webkit-details-marker]:hidden">
          Raw payload diagnostics
        </summary>
        <div className="border-t border-black/6 p-5">
          <pre className="max-h-[520px] overflow-auto rounded-lg bg-[#10272c] p-4 text-xs leading-relaxed text-white">
            {rawJson}
          </pre>
        </div>
      </details>
    </div>
  );
}
