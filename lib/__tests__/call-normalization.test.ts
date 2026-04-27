import { describe, expect, it } from "bun:test";

import { normalizeLiveKitCallPayload } from "@/lib/call-normalization";
import type { LiveKitWebhookPayload } from "@/lib/call-types";

describe("normalizeLiveKitCallPayload", () => {
  it("normalizes a raw LiveKit payload into portal call fields", () => {
    const payload: LiveKitWebhookPayload = {
      audioBase64: Buffer.from("audio").toString("base64"),
      callId: "call_123",
      callerPhone: "+15551234567",
      endedAt: "2026-04-27T16:01:00.000Z",
      metrics: [
        {
          metadata: { modelName: "zai-org/GLM-4.7" },
          promptCachedTokens: 40,
          promptTokens: 100,
          completionTokens: 20,
          speechId: "speech_1",
          tokensPerSecond: 18,
          ttftMs: 450,
          type: "llm_metrics",
        },
        {
          charactersCount: 120,
          ttfbMs: 180,
          type: "tts_metrics",
        },
        {
          transcriptionDelayMs: 210,
          type: "eou_metrics",
        },
      ],
      officePhone: "+15557654321",
      sessionReport: {
        chat_history: {
          items: [
            {
              content: [{ transcript: "I need an appointment" }],
              createdAt: 1,
              id: "user_1",
              role: "user",
              type: "message",
            },
            {
              args: JSON.stringify({ reason: "follow up" }),
              callId: "tool_1",
              createdAt: 2,
              id: "tool_call_1",
              name: "book_appt",
              type: "function_call",
            },
            {
              callId: "tool_1",
              createdAt: 502,
              id: "tool_output_1",
              isError: false,
              name: "book_appt",
              output: JSON.stringify({ ok: true }),
              type: "function_call_output",
            },
            {
              content: [{ transcript: "You're booked." }],
              createdAt: 600,
              id: "agent_1",
              role: "assistant",
              type: "message",
            },
          ],
        },
      },
      startedAt: "2026-04-27T16:00:00.000Z",
    };

    const normalized = normalizeLiveKitCallPayload(payload);

    expect(normalized.callId).toBe("call_123");
    expect(normalized.status).toBe("COMPLETED");
    expect(normalized.toolActions.bookedAppointment).toBe(true);
    expect(normalized.toolCalls).toBe(1);
    expect(normalized.inputTokens).toBe(100);
    expect(normalized.cachedTokens).toBe(40);
    expect(normalized.outputTokens).toBe(20);
    expect(normalized.avgTtft).toBe(450);
    expect(normalized.avgTtsttfb).toBe(180);
    expect(normalized.latencyValues.totalLatency).toEqual([840]);
    expect(normalized.audioData?.length).toBe(5);
    expect(JSON.stringify(normalized.dataPayload)).not.toContain("audioBase64");
  });

  it("marks failed review results as needing review", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_review",
      callerPhone: "+15551234567",
      durationSec: 20,
      endedAt: "2026-04-27T16:01:00.000Z",
      officePhone: "+15557654321",
      reviewResult: {
        labels: {
          hallucination: "none",
          resolutionPath: "failed",
          toolPath: "correct",
        },
        outcome: "unresolved",
        passed: false,
        scores: {
          grounding: 4,
          toolUseCorrectness: 4,
        },
        summary: "The call did not resolve.",
      },
      startedAt: "2026-04-27T16:00:40.000Z",
      totals: {
        toolCalls: 0,
        toolErrors: 0,
      },
      turns: [],
    });

    expect(normalized.needsReview).toBe(true);
    expect(normalized.reviewAverageScore).toBe(4);
    expect(normalized.outcomeSummary).toBe("The call did not resolve.");
  });
});
