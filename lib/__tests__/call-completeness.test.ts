import { describe, expect, it } from "bun:test";

import { getCallCompleteness } from "@/lib/call-completeness";

describe("getCallCompleteness", () => {
  it("marks calls with session transcript messages complete", () => {
    const completeness = getCallCompleteness({
      sessionReport: {
        chat_history: {
          items: [
            {
              content: [{ transcript: "Hello" }],
              role: "user",
              type: "message",
            },
          ],
        },
      },
    });

    expect(completeness.status).toBe("complete");
    expect(completeness.hasTranscript).toBe(true);
  });

  it("marks calls with normalized turn text complete", () => {
    const completeness = getCallCompleteness({
      turns: [{ agentText: "How can I help?", callerText: null }],
    });

    expect(completeness.status).toBe("complete");
    expect(completeness.hasTranscript).toBe(true);
  });

  it("marks fallback-only calls as LiveKit recovered", () => {
    const completeness = getCallCompleteness({
      callId: "call_123",
      webhookFallback: {
        createdFromWebhook: true,
        runtimeFinalPayloadMissing: true,
      },
    });

    expect(completeness.status).toBe("livekit_recovered");
    expect(completeness.label).toBe("LiveKit recovered");
    expect(completeness.hasWebhookFallback).toBe(true);
  });

  it("marks missing runtime reports as transcript missing", () => {
    const completeness = getCallCompleteness({
      callId: "call_123",
      startedAt: "2026-07-08T21:04:57.000Z",
    });

    expect(completeness.status).toBe("missing_transcript");
    expect(completeness.label).toBe("Transcript missing");
  });

  it("keeps in-progress calls quiet", () => {
    const completeness = getCallCompleteness(null, { status: "IN_PROGRESS" });

    expect(completeness.status).toBe("in_progress");
    expect(completeness.label).toBeNull();
  });

  it("prioritizes linked webhook failures", () => {
    const completeness = getCallCompleteness(
      {
        sessionReport: {
          chat_history: {
            items: [
              {
                content: ["Hello"],
                role: "assistant",
                type: "message",
              },
            ],
          },
        },
      },
      { linkedWebhookFailed: true },
    );

    expect(completeness.status).toBe("webhook_error");
    expect(completeness.label).toBe("Webhook issue");
  });
});
