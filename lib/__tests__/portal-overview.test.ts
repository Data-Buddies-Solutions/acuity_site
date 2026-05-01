import { describe, expect, it } from "bun:test";

import { buildPortalCallTranscriptMessages } from "@/lib/portal-overview";

describe("portal transcript messages", () => {
  it("keeps only caller and agent text from session transcripts", () => {
    const messages = buildPortalCallTranscriptMessages({
      sessionItems: [
        {
          content: [{ transcript: "I need an appointment." }],
          createdAt: 1000,
          role: "user",
          type: "message",
        },
        {
          args: '{"patientName":"Jane"}',
          callId: "call-1",
          name: "book_appt",
          type: "function_call",
        },
        {
          callId: "call-1",
          name: "book_appt",
          output: '{"appointmentId":"abc"}',
          type: "function_call_output",
        },
        {
          content: ["You are booked for Tuesday."],
          createdAt: 2000,
          role: "assistant",
          type: "message",
        },
      ],
      turns: [],
    });

    expect(messages).toEqual([
      {
        role: "caller",
        text: "I need an appointment.",
        timestamp: 1000,
      },
      {
        role: "agent",
        text: "You are booked for Tuesday.",
        timestamp: 2000,
      },
    ]);
  });

  it("falls back to turn text when session messages are absent", () => {
    const messages = buildPortalCallTranscriptMessages({
      sessionItems: [],
      turns: [
        {
          cachedTokens: 0,
          callerText: "Hi.",
          completionTokens: 0,
          promptTokens: 0,
          sttLatencyMs: 0,
          agentText: "How can I help?",
          toolCalls: [
            {
              args: "{}",
              durationMs: 1,
              isError: false,
              name: "get_availability",
              result: "{}",
            },
          ],
          ttftMs: 0,
          ttsttfbMs: 0,
          turn: 1,
        },
      ],
    });

    expect(messages).toEqual([
      {
        role: "caller",
        text: "Hi.",
        timestamp: null,
      },
      {
        role: "agent",
        text: "How can I help?",
        timestamp: null,
      },
    ]);
  });
});
