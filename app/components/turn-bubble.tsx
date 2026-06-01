import type { TurnRecord, ChatHistoryItem } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { formatLatencyMs } from "@/lib/format";
import { ToolTurnDetail } from "@/app/components/tool-turn-detail";
import { CopyButton } from "@/app/components/copy-button";

function AgentMetrics({ turn }: { turn: TurnRecord }) {
  const hasMetrics =
    turn.ttftMs > 0 || turn.promptTokens > 0 || turn.toolCalls.length > 0;
  if (!hasMetrics) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-1 max-w-[80%]">
      {turn.ttftMs > 0 && (
        <Badge variant="outline" className="text-[10px] font-mono">
          TTFT: {formatLatencyMs(turn.ttftMs)}
        </Badge>
      )}
      {turn.ttsttfbMs > 0 && (
        <Badge variant="outline" className="text-[10px] font-mono">
          TTS: {formatLatencyMs(turn.ttsttfbMs)}
        </Badge>
      )}
      {turn.promptTokens > 0 && (
        <Badge variant="outline" className="text-[10px] font-mono">
          {turn.promptTokens.toLocaleString()} in /{" "}
          {turn.completionTokens.toLocaleString()} out
        </Badge>
      )}
      {turn.cachedTokens > 0 && (
        <Badge variant="outline" className="text-[10px] font-mono">
          {turn.cachedTokens.toLocaleString()} cached
        </Badge>
      )}
    </div>
  );
}

type Message =
  | { kind: "agent"; text: string; turn: TurnRecord }
  | { kind: "user"; text: string; turn: TurnRecord };

function flattenTurns(turns: TurnRecord[]): Message[] {
  const messages: Message[] = [];
  for (const turn of turns) {
    if (turn.callerText) {
      messages.push({ kind: "user", text: turn.callerText, turn });
    }
    if (turn.agentText || turn.toolCalls.length > 0) {
      messages.push({ kind: "agent", text: turn.agentText ?? "", turn });
    }
  }
  return messages;
}

export function TranscriptTimeline({ turns }: { turns: TurnRecord[] }) {
  const messages = flattenTurns(turns);

  return (
    <div className="space-y-3">
      {messages.map((msg, i) =>
        msg.kind === "user" ? (
          <div key={i}>
            <div className="flex justify-end">
              <div className="max-w-full rounded-2xl rounded-br-md bg-primary px-4 py-2.5 sm:max-w-[80%]">
                <p className="text-[10px] font-medium text-primary-foreground/70 mb-1">
                  User
                </p>
                <p className="text-sm text-primary-foreground">{msg.text}</p>
              </div>
            </div>
            {(msg.turn.sttLatencyMeasured || (msg.turn.sttLatencyMs ?? 0) > 0) && (
              <div className="flex justify-end mt-1">
                <Badge variant="outline" className="text-[10px] font-mono">
                  STT: {formatLatencyMs(msg.turn.sttLatencyMs)}
                </Badge>
              </div>
            )}
            {msg.turn.sttConfidence != null && (
              <div className="flex justify-end mt-1">
                <Badge variant="outline" className="text-[10px] font-mono">
                  Confidence: {formatConfidence(msg.turn.sttConfidence)}
                </Badge>
              </div>
            )}
          </div>
        ) : (
          <div key={i}>
            {msg.text ? (
              <div className="flex justify-start">
                <div className="max-w-full rounded-2xl rounded-bl-md bg-muted px-4 py-2.5 sm:max-w-[80%]">
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">
                    Agent
                  </p>
                  <p className="text-sm text-foreground">{msg.text}</p>
                </div>
              </div>
            ) : null}
            <AgentMetrics turn={msg.turn} />
            <ToolTurnDetail toolCalls={msg.turn.toolCalls} />
          </div>
        ),
      )}
    </div>
  );
}

// --- Session Report Transcript ---

function extractText(content?: ChatHistoryItem["content"]): string {
  if (!content) return "";
  return content
    .map((c) => (typeof c === "string" ? c : (c.transcript ?? "")))
    .filter(Boolean)
    .join(" ");
}

function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatConfidence(value: number): string {
  const normalized = value > 1 && value <= 100 ? value / 100 : value;
  return `${Math.round(normalized * 100)}%`;
}

function formatTimestamp(ms?: number): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function SessionTranscriptTimeline({ items }: { items: ChatHistoryItem[] }) {
  // Build lookup for tool exec duration: function_call_output by callId
  const outputsByCallId = new Map<string, ChatHistoryItem>();
  for (const item of items) {
    if (item.type === "function_call_output" && item.callId) {
      outputsByCallId.set(item.callId, item);
    }
  }

  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const ts = formatTimestamp(item.createdAt);

        if (item.type === "message" && item.role === "user") {
          const text = extractText(item.content);
          if (!text) return null;
          return (
            <div key={item.id ?? i}>
              <div className="flex justify-end">
                <div className="max-w-full rounded-2xl rounded-br-md bg-primary px-4 py-2.5 sm:max-w-[80%]">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-[10px] font-medium text-primary-foreground/70">
                      User
                    </p>
                    {ts && (
                      <p className="text-[9px] text-primary-foreground/50 font-mono">
                        {ts}
                      </p>
                    )}
                  </div>
                  <p className="text-sm text-primary-foreground">{text}</p>
                  {item.interrupted && (
                    <Badge
                      variant="outline"
                      className="mt-1 text-[9px] border-primary-foreground/30 text-primary-foreground/60"
                    >
                      interrupted
                    </Badge>
                  )}
                </div>
              </div>
              {(() => {
                const metrics = item.metrics as Record<string, number> | undefined;
                const sttMs = metrics?.stt_latency;
                const confidence = metrics?.stt_confidence;
                if (sttMs == null && confidence == null) return null;
                return (
                  <div className="flex justify-end mt-1 gap-1.5">
                    {sttMs != null && sttMs >= 0 && (
                      <Badge variant="outline" className="text-[10px] font-mono">
                        STT: {formatLatencyMs(sttMs)}
                      </Badge>
                    )}
                    {confidence != null && (
                      <Badge variant="outline" className="text-[10px] font-mono">
                        Confidence: {formatConfidence(confidence)}
                      </Badge>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        }

        if (item.type === "message" && item.role === "assistant") {
          const text = extractText(item.content);
          if (!text) return null;
          const metrics = item.metrics as Record<string, number> | undefined;
          return (
            <div key={item.id ?? i}>
              <div className="flex justify-start">
                <div className="max-w-full rounded-2xl rounded-bl-md bg-muted px-4 py-2.5 sm:max-w-[80%]">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <p className="text-[10px] font-medium text-muted-foreground">Agent</p>
                    {ts && (
                      <p className="text-[9px] text-muted-foreground/50 font-mono">
                        {ts}
                      </p>
                    )}
                  </div>
                  <p
                    className={`text-sm text-foreground ${item.interrupted ? "line-through opacity-60" : ""}`}
                  >
                    {text}
                  </p>
                  {item.interrupted && (
                    <Badge variant="outline" className="mt-1 text-[9px]">
                      interrupted
                    </Badge>
                  )}
                </div>
              </div>
              {metrics && (
                <div className="flex flex-wrap gap-1.5 mt-1 max-w-[80%]">
                  {metrics.llm_node_ttft != null && metrics.llm_node_ttft > 0 && (
                    <Badge variant="outline" className="text-[10px] font-mono">
                      TTFT: {formatLatencyMs(metrics.llm_node_ttft)}
                    </Badge>
                  )}
                  {metrics.tts_node_ttfb != null && metrics.tts_node_ttfb > 0 && (
                    <Badge variant="outline" className="text-[10px] font-mono">
                      TTS: {formatLatencyMs(metrics.tts_node_ttfb)}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          );
        }

        if (item.type === "function_call") {
          const output = item.callId ? outputsByCallId.get(item.callId) : undefined;
          const execMs =
            output?.createdAt && item.createdAt ? output.createdAt - item.createdAt : 0;
          return (
            <details
              key={item.id ?? i}
              className="my-1 max-w-full rounded-md bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 px-3 py-2 group sm:max-w-[80%]"
            >
              <summary className="flex flex-wrap items-center gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <span className="text-[10px] text-muted-foreground/50 transition-transform group-open:rotate-90">
                  &#9654;
                </span>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {item.name}
                </span>
                {ts && (
                  <span className="text-[9px] text-muted-foreground/50 font-mono">
                    {ts}
                  </span>
                )}
                {execMs > 0 && (
                  <span className="rounded border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400 font-mono">
                    Exec {formatLatencyMs(execMs)}
                  </span>
                )}
                <span className="text-[9px] text-muted-foreground/40 sm:ml-auto">
                  input
                </span>
              </summary>
              {item.args && (
                <>
                  <div className="mt-2 flex justify-end">
                    <CopyButton text={formatJson(item.args)} />
                  </div>
                  <pre className="mt-1 text-[11px] font-mono text-muted-foreground overflow-auto max-h-48 whitespace-pre-wrap break-all">
                    {formatJson(item.args)}
                  </pre>
                </>
              )}
            </details>
          );
        }

        if (item.type === "function_call_output") {
          return (
            <details
              key={item.id ?? i}
              className="my-1 max-w-full rounded-md bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 px-3 py-2 group sm:max-w-[80%]"
            >
              <summary className="flex flex-wrap items-center gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <span className="text-[10px] text-muted-foreground/50 transition-transform group-open:rotate-90">
                  &#9654;
                </span>
                <span
                  className={`text-xs font-semibold ${item.isError ? "text-red-600 dark:text-red-400" : "text-gray-700 dark:text-gray-300"}`}
                >
                  {item.isError ? "\u2717" : "\u2713"} {item.name ?? "tool result"}
                </span>
                <span className="text-[9px] text-muted-foreground/40 sm:ml-auto">
                  output
                </span>
              </summary>
              {item.output && (
                <>
                  <div className="mt-2 flex justify-end">
                    <CopyButton text={formatJson(item.output)} />
                  </div>
                  <pre className="mt-1 text-[11px] font-mono text-muted-foreground overflow-auto max-h-48 whitespace-pre-wrap break-all">
                    {formatJson(item.output)}
                  </pre>
                </>
              )}
            </details>
          );
        }

        // System messages or unknown types
        if (item.type === "message" && item.role === "system") {
          return null; // Don't display system prompts
        }

        return null;
      })}
    </div>
  );
}
