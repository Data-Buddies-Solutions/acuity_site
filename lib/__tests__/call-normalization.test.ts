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
          endOfUtteranceDelayMs: 210,
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

  it("normalizes the current LiveKit observability payload shape", () => {
    const payload: LiveKitWebhookPayload = {
      callId: "call_observability",
      callerPhone: "+15551234567",
      durationSec: 60,
      endedAt: "2026-04-27T16:01:00.000Z",
      llmMetrics: [
        {
          metadata: { modelName: "zai-org/GLM-4.7" },
          promptCachedTokens: 60,
          promptTokens: 300,
          completionTokens: 45,
          speechId: "speech_1",
          tokensPerSecond: 21,
          ttftMs: 420,
          type: "llm_metrics",
        },
        {
          transcriptionDelayMs: 990,
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
              args: JSON.stringify({ startDatetime: "2026-05-01T14:00:00" }),
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
              output: JSON.stringify({ appointmentId: "appt_123" }),
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
      turnMetrics: [
        {
          itemId: "user_1",
          metrics: {
            confidence: 0.82,
            transcriptionDelay: 0.23,
          },
        },
        {
          itemId: "agent_1",
          metrics: {
            e2eLatency: 1.05,
            ttsNodeTtfb: 0.18,
          },
        },
      ],
      usage: {
        modelUsage: [
          {
            inputCachedTokens: 100,
            inputTokens: 500,
            model: "zai-org/GLM-4.7",
            outputTokens: 80,
            type: "llm_usage",
          },
          {
            charactersCount: 200,
            type: "tts_usage",
          },
        ],
      },
    };

    const normalized = normalizeLiveKitCallPayload(payload);
    const data = normalized.dataPayload as { totals?: unknown; turns?: unknown[] };

    expect(normalized.callId).toBe("call_observability");
    expect(normalized.status).toBe("COMPLETED");
    expect(normalized.toolActions.bookedAppointment).toBe(true);
    expect(normalized.toolCalls).toBe(1);
    expect(normalized.inputTokens).toBe(500);
    expect(normalized.outputTokens).toBe(80);
    expect(normalized.cachedTokens).toBe(100);
    expect(normalized.ttsChars).toBe(200);
    expect(normalized.avgTtft).toBe(420);
    expect(normalized.avgTtsttfb).toBe(180);
    expect(normalized.avgTokensPerSec).toBe(21);
    expect(normalized.estimatedCostMicros).toBe(31990);
    expect(normalized.costItems.map((item) => item.provider)).toEqual([
      "livekit",
      "telnyx",
      "assemblyai",
      "baseten",
      "baseten",
      "baseten",
      "rime",
    ]);
    expect(normalized.latencyValues.stt).toEqual([230]);
    expect(normalized.latencyValues.totalLatency).toEqual([1050]);
    expect(normalized.summary.turns?.[0]?.sttConfidence).toBe(0.82);
    expect(normalized.summary.turns?.[0]?.sttLatencyMeasured).toBe(true);
    expect(normalized.summary.turns?.[0]?.toolCalls[0]?.durationMs).toBe(500);
    expect(data.turns?.length).toBe(1);
    expect(JSON.stringify(normalized.dataPayload)).not.toContain("audioBase64");
  });

  it("prefers LiveKit ChatMessage metrics over plugin metric arrays", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_chat_message_metrics",
      metrics: [
        {
          metadata: { modelName: "zai-org/GLM-4.7" },
          promptTokens: 100,
          completionTokens: 20,
          ttftMs: 900,
          type: "llm_metrics",
        },
        {
          ttfbMs: 800,
          type: "tts_metrics",
        },
        {
          endOfUtteranceDelayMs: 700,
          transcriptionDelayMs: 200,
          type: "eou_metrics",
        },
      ],
      sessionReport: {
        chat_history: {
          items: [
            {
              content: [{ transcript: "I need an appointment" }],
              createdAt: 1,
              id: "user_metrics",
              metrics: {
                endOfTurnDelay: 0.7,
                transcriptionDelay: 0.2,
              },
              role: "user",
              type: "message",
            },
            {
              content: [{ transcript: "I can help with that." }],
              createdAt: 2,
              id: "agent_metrics",
              metrics: {
                e2eLatency: 0.95,
                llmNodeTtft: 0.3,
                ttsNodeTtfb: 0.1,
              },
              role: "assistant",
              type: "message",
            },
          ],
        },
      },
    });

    const turn = normalized.summary.turns?.[0];

    expect(turn?.sttLatencyMs).toBe(200);
    expect(turn?.endOfTurnDelayMs).toBe(700);
    expect(turn?.ttftMs).toBe(300);
    expect(turn?.ttsttfbMs).toBe(100);
    expect(turn?.totalLatencyMs).toBe(950);
    expect(normalized.avgTtft).toBe(300);
    expect(normalized.avgTtsttfb).toBe(100);
    expect(normalized.latencyValues.totalLatency).toEqual([950]);
  });

  it("falls back to EOU plus LLM plus TTS instead of STT plus LLM plus TTS", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_eou_total_fallback",
      sessionReport: {
        chat_history: {
          items: [
            {
              content: [{ transcript: "I need an appointment" }],
              createdAt: 1,
              id: "user_eou",
              metrics: {
                endOfTurnDelay: 0.7,
                transcriptionDelay: 0.2,
              },
              role: "user",
              type: "message",
            },
            {
              content: [{ transcript: "I can help with that." }],
              createdAt: 2,
              id: "agent_eou",
              metrics: {
                llmNodeTtft: 0.3,
                ttsNodeTtfb: 0.1,
              },
              role: "assistant",
              type: "message",
            },
          ],
        },
      },
    });

    const turn = normalized.summary.turns?.[0];

    expect(turn?.sttLatencyMs).toBe(200);
    expect(turn?.endOfTurnDelayMs).toBe(700);
    expect(turn?.totalLatencyMs).toBe(1100);
    expect(normalized.latencyValues.totalLatency).toEqual([1100]);
  });

  it("derives user STT latency from turnMetrics stoppedSpeakingAt fallback", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_stt_fallback",
      sessionReport: {
        chat_history: {
          items: [
            {
              content: [{ transcript: "Okay, perfect" }],
              createdAt: 1780333267569,
              id: "user_final",
              role: "user",
              type: "message",
            },
          ],
        },
      },
      turnMetrics: [
        {
          createdAt: 1780333267569,
          itemId: "user_final",
          metrics: {
            stoppedSpeakingAt: 1780333267.013,
          },
          role: "user",
        },
      ],
    });

    expect(normalized.summary.turns?.[0]?.sttLatencyMs).toBe(556);
    expect(normalized.latencyValues.stt).toEqual([556]);
  });

  it("keeps zero transcriptionDelay as a measured STT latency", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_zero_stt",
      sessionReport: {
        chat_history: {
          items: [
            {
              content: [{ transcript: "Hi" }],
              createdAt: 1780333267000,
              id: "user_zero",
              role: "user",
              type: "message",
            },
          ],
        },
      },
      turnMetrics: [
        {
          createdAt: 1780333267000,
          itemId: "user_zero",
          metrics: {
            transcriptionDelay: 0,
          },
          role: "user",
        },
      ],
    });

    expect(normalized.summary.turns?.[0]?.sttLatencyMeasured).toBe(true);
    expect(normalized.summary.turns?.[0]?.sttLatencyMs).toBe(0);
    expect(normalized.latencyValues.stt).toEqual([0]);
  });

  it("does not mark failed booking tool responses as booked appointments", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_failed_booking",
      callerPhone: "+15551234567",
      durationSec: 30,
      sessionReport: {
        chat_history: {
          items: [
            {
              args: JSON.stringify({ startDatetime: "2026-05-01T14:00:00" }),
              callId: "tool_1",
              createdAt: 1,
              id: "tool_call_1",
              name: "book_appt",
              type: "function_call",
            },
            {
              callId: "tool_1",
              createdAt: 2,
              id: "tool_output_1",
              isError: false,
              name: "book_appt",
              output: JSON.stringify({
                message: "This time slot is no longer available.",
                status: "error",
              }),
              type: "function_call_output",
            },
          ],
        },
      },
      startedAt: "2026-04-27T16:00:00.000Z",
    });

    expect(normalized.toolActions.bookedAppointment).toBe(false);
  });

  it("normalizes new call observability payload fields", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_observability_v2",
      callerPhone: "+15551234567",
      durationSec: 45,
      endedAt: "2026-05-20T14:01:00.000Z",
      language: {
        acceptedLanguages: ["en", "es"],
        currentLanguage: "es",
        initialLanguage: "en",
        languageChanged: true,
        languageSwitches: 1,
        observedLanguages: ["en", "es"],
        switchEvents: [
          {
            createdAt: "2026-05-20T14:00:20.000Z",
            from: "en",
            reason: "explicit_request",
            to: "es",
          },
        ],
      },
      llmSummary: {
        avgTtftMs: 500,
        cachedPromptTokens: 120,
        cacheHitRate: 0.4,
        completionTokens: 30,
        fallbackUsed: true,
        modelsUsed: ["zai-org/GLM-4.7", "MiniMaxAI/MiniMax-M2.5"],
        peakPromptTokens: 300,
        promptTokens: 300,
      },
      officePhone: "+15557654321",
      sessionEvents: {
        close: {
          createdAt: "2026-05-20T14:01:00.000Z",
          reason: "participant_disconnected",
        },
        errors: [
          {
            code: "ETIMEDOUT",
            createdAt: "2026-05-20T14:00:30.000Z",
            messageClass: "code:ETIMEDOUT",
            name: "Error",
          },
        ],
        falseInterruptions: [
          {
            createdAt: "2026-05-20T14:00:40.000Z",
            resumed: true,
          },
        ],
        overlappingSpeech: [
          {
            createdAt: "2026-05-20T14:00:41.000Z",
            durationMs: 1200,
            isInterruption: true,
          },
        ],
      },
      startedAt: "2026-05-20T14:00:15.000Z",
      toolExecutions: [
        {
          callId: "tool_1",
          createdAt: "2026-05-20T14:00:25.000Z",
          outputClass: "appointment_booked",
          status: "success",
          toolName: "book_appt",
        },
        {
          callId: "tool_2",
          createdAt: "2026-05-20T14:00:35.000Z",
          outputClass: "middleware_error",
          status: "error",
          toolName: "check_insurance",
        },
      ],
      voiceExperiment: {
        assignment: "sticky_caller_phone_hash",
        assignmentHash: "abcdef1234567890",
        experimentId: "sweetwater_rime_cartesia_2026_06",
        provider: "rime",
        scope: "sweetwater",
        speaker: "luz",
        variant: "rime",
      },
    });
    const data = normalized.dataPayload as {
      language?: unknown;
      llmSummary?: unknown;
      sessionEvents?: unknown;
      toolExecutions?: unknown[];
      voiceExperiment?: unknown;
    };

    expect(normalized.fallbackUsed).toBe(true);
    expect(normalized.llmModel).toBe("MiniMaxAI/MiniMax-M2.5");
    expect(normalized.inputTokens).toBe(300);
    expect(normalized.outputTokens).toBe(30);
    expect(normalized.cachedTokens).toBe(120);
    expect(normalized.cacheHitRate).toBe(0.4);
    expect(normalized.peakContext).toBe(300);
    expect(normalized.avgTtft).toBe(500);
    expect(normalized.toolCalls).toBe(2);
    expect(normalized.toolErrors).toBe(1);
    expect(normalized.toolActions.bookedAppointment).toBe(true);
    expect(normalized.needsReview).toBe(true);
    expect(normalized.interruptionCount).toBe(2);
    expect(data.language).toBeTruthy();
    expect(data.llmSummary).toBeTruthy();
    expect(data.sessionEvents).toBeTruthy();
    expect(data.toolExecutions?.length).toBe(2);
    expect(data.voiceExperiment).toEqual({
      assignment: "sticky_caller_phone_hash",
      assignmentHash: "abcdef1234567890",
      experimentId: "sweetwater_rime_cartesia_2026_06",
      provider: "rime",
      scope: "sweetwater",
      speaker: "luz",
      variant: "rime",
    });
  });

  it("keeps metric token totals when llmSummary is partial", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_partial_llm_summary",
      callerPhone: "+15551234567",
      durationSec: 30,
      endedAt: "2026-05-20T14:01:00.000Z",
      llm: {
        fallbackUsed: true,
        model: "fallback-model",
        usedModels: ["primary-model", "fallback-model"],
      },
      llmSummary: {
        modelsUsed: ["summary-model"],
      },
      metrics: [
        {
          completionTokens: 25,
          metadata: { modelName: "primary-model" },
          promptCachedTokens: 40,
          promptTokens: 125,
          ttftMs: 450,
          type: "llm_metrics",
        },
      ],
      startedAt: "2026-05-20T14:00:30.000Z",
    });

    expect(normalized.llmModel).toBe("summary-model");
    expect(normalized.fallbackUsed).toBe(true);
    expect(normalized.inputTokens).toBe(125);
    expect(normalized.outputTokens).toBe(25);
    expect(normalized.cachedTokens).toBe(40);
    expect(normalized.peakContext).toBe(125);
    expect(normalized.avgTtft).toBe(450);
  });

  it("marks successful reschedules as booked and cancelled actions", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_rescheduled",
      callerPhone: "+15551234567",
      durationSec: 30,
      startedAt: "2026-05-20T14:00:30.000Z",
      toolExecutions: [
        {
          outputClass: "appointment_rescheduled",
          status: "success",
          toolName: "reschedule_appt",
        },
      ],
    });

    expect(normalized.toolActions.bookedAppointment).toBe(true);
    expect(normalized.toolActions.cancelledAppointment).toBe(true);
  });

  it("normalizes appointment actions and marks success without appointment id", () => {
    const normalized = normalizeLiveKitCallPayload({
      appointmentActions: [
        {
          action: "rescheduled",
          appointment: {
            appointmentDate: "2026-05-12",
            appointmentTime: "11:00 AM",
            appointmentTypeName: "Established Adult Medical",
            patientName: "Jane Smith",
            providerName: "Dr. Austin Bach",
          },
          cancelledAppointment: {
            appointmentId: "old-appt-1",
            appointmentDate: "2026-05-05",
          },
          status: "success",
          toolName: "reschedule_appointment",
        },
      ],
      callId: "call_appointment_actions",
      callerPhone: "+15551234567",
      durationSec: 30,
      startedAt: "2026-05-20T14:00:30.000Z",
    });
    const data = normalized.dataPayload as {
      appointmentActions?: Array<Record<string, unknown>>;
    };

    expect(normalized.toolActions.bookedAppointment).toBe(true);
    expect(normalized.toolActions.cancelledAppointment).toBe(true);
    expect(data.appointmentActions).toEqual([
      {
        action: "rescheduled",
        appointment: {
          appointmentDate: "2026-05-12",
          appointmentTime: "11:00 AM",
          appointmentTypeName: "Established Adult Medical",
          patientName: "Jane Smith",
          providerName: "Dr. Austin Bach",
        },
        cancelledAppointment: {
          appointmentDate: "2026-05-05",
          appointmentId: "old-appt-1",
        },
        status: "success",
        toolName: "reschedule_appointment",
      },
    ]);
  });

  it("uses call state as booked evidence when tool output is plain speech", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_state_booking",
      callerPhone: "+15551234567",
      callState: {
        patient: {
          appointments: [
            {
              date: "2026-05-12",
              facility: "Spring Hill",
              id: 98765,
              provider: "Dr. Austin Bach",
              time: "11:00 AM",
              type: "Established Adult",
            },
          ],
          name: "Jane Smith",
        },
        private: {
          latestBookedAppointmentId: 98765,
        },
      },
      durationSec: 30,
      startedAt: "2026-05-20T14:00:30.000Z",
      turns: [
        {
          cachedTokens: 0,
          callerText: "I need an appointment.",
          completionTokens: 0,
          promptTokens: 0,
          sttLatencyMs: 0,
          agentText: "You are booked.",
          toolCalls: [
            {
              args: "{}",
              durationMs: 100,
              isError: false,
              name: "book_appointment",
              result: "Booked May 12 at 11:00 AM.",
            },
          ],
          ttftMs: 0,
          ttsttfbMs: 0,
          turn: 1,
        },
      ],
    });

    expect(normalized.toolActions.bookedAppointment).toBe(true);
  });

  it("does not mark empty non-error transfer turn output as transferred", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_empty_transfer_turn",
      callerPhone: "+15551234567",
      durationSec: 30,
      endedAt: "2026-05-20T14:01:00.000Z",
      startedAt: "2026-05-20T14:00:30.000Z",
      turns: [
        {
          cachedTokens: 0,
          callerText: "Can I talk to someone?",
          completionTokens: 0,
          promptTokens: 0,
          sttLatencyMs: 0,
          agentText: "I'll transfer you.",
          toolCalls: [
            {
              args: "{}",
              durationMs: 100,
              isError: false,
              name: "transfer_call",
              result: "",
            },
          ],
          ttftMs: 0,
          ttsttfbMs: 0,
          turn: 1,
        },
      ],
    });

    expect(normalized.toolActions.transferred).toBe(false);
    expect(normalized.status).toBe("COMPLETED");
  });

  it("marks successful transfer execution evidence as transferred", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_transfer_execution",
      callerPhone: "+15551234567",
      durationSec: 30,
      endedAt: "2026-05-20T14:01:00.000Z",
      startedAt: "2026-05-20T14:00:30.000Z",
      toolExecutions: [
        {
          outputClass: "transfer_started",
          status: "success",
          toolName: "transfer_call",
        },
      ],
    });

    expect(normalized.toolActions.transferred).toBe(true);
    expect(normalized.status).toBe("ESCALATED");
  });

  it("marks explicit transfer turn result evidence as transferred", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_transfer_turn",
      callerPhone: "+15551234567",
      durationSec: 30,
      endedAt: "2026-05-20T14:01:00.000Z",
      startedAt: "2026-05-20T14:00:30.000Z",
      turns: [
        {
          cachedTokens: 0,
          callerText: "Can I talk to someone?",
          completionTokens: 0,
          promptTokens: 0,
          sttLatencyMs: 0,
          agentText: "The transfer is starting.",
          toolCalls: [
            {
              args: "{}",
              durationMs: 100,
              isError: false,
              name: "transfer_call",
              result: JSON.stringify({ status: "transfer_started" }),
            },
          ],
          ttftMs: 0,
          ttsttfbMs: 0,
          turn: 1,
        },
      ],
    });

    expect(normalized.toolActions.transferred).toBe(true);
    expect(normalized.status).toBe("ESCALATED");
  });

  it("marks plain-text transfer started turn output as transferred", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_transfer_text_turn",
      callerPhone: "+15551234567",
      durationSec: 30,
      endedAt: "2026-05-20T14:01:00.000Z",
      startedAt: "2026-05-20T14:00:30.000Z",
      turns: [
        {
          cachedTokens: 0,
          callerText: "Can I talk to someone?",
          completionTokens: 0,
          promptTokens: 0,
          sttLatencyMs: 0,
          agentText: "The transfer is starting.",
          toolCalls: [
            {
              args: "{}",
              durationMs: 100,
              isError: false,
              name: "transfer_call",
              result: "Transfer started to the Spring Hill office.",
            },
          ],
          ttftMs: 0,
          ttsttfbMs: 0,
          turn: 1,
        },
      ],
    });

    expect(normalized.toolActions.transferred).toBe(true);
    expect(normalized.status).toBe("ESCALATED");
  });

  it("does not mark plain-text transfer failure output as transferred", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_transfer_failed_text_turn",
      callerPhone: "+15551234567",
      durationSec: 30,
      endedAt: "2026-05-20T14:01:00.000Z",
      startedAt: "2026-05-20T14:00:30.000Z",
      turns: [
        {
          cachedTokens: 0,
          callerText: "Can I talk to someone?",
          completionTokens: 0,
          promptTokens: 0,
          sttLatencyMs: 0,
          agentText: "I couldn't transfer you.",
          toolCalls: [
            {
              args: "{}",
              durationMs: 100,
              isError: false,
              name: "transfer_call",
              result: "Could not transfer the call.",
            },
          ],
          ttftMs: 0,
          ttsttfbMs: 0,
          turn: 1,
        },
      ],
    });

    expect(normalized.toolActions.transferred).toBe(false);
    expect(normalized.status).toBe("COMPLETED");
  });

  it("does not let structured transfer errors pass through message text", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_transfer_structured_error",
      callerPhone: "+15551234567",
      durationSec: 30,
      endedAt: "2026-05-20T14:01:00.000Z",
      startedAt: "2026-05-20T14:00:30.000Z",
      turns: [
        {
          cachedTokens: 0,
          callerText: "Can I talk to someone?",
          completionTokens: 0,
          promptTokens: 0,
          sttLatencyMs: 0,
          agentText: "I couldn't transfer you.",
          toolCalls: [
            {
              args: "{}",
              durationMs: 100,
              isError: false,
              name: "transfer_call",
              result: JSON.stringify({
                message: "Transfer started but the downstream bridge failed.",
                status: "error",
              }),
            },
          ],
          ttftMs: 0,
          ttsttfbMs: 0,
          turn: 1,
        },
      ],
    });

    expect(normalized.toolActions.transferred).toBe(false);
    expect(normalized.status).toBe("COMPLETED");
  });

  it("marks structured reschedule tool calls as booked and cancelled actions", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_rescheduled_turn",
      callerPhone: "+15551234567",
      durationSec: 30,
      startedAt: "2026-05-20T14:00:30.000Z",
      turns: [
        {
          cachedTokens: 0,
          callerText: "Can you move my appointment?",
          completionTokens: 0,
          promptTokens: 0,
          sttLatencyMs: 0,
          agentText: "The appointment was moved.",
          toolCalls: [
            {
              args: "{}",
              durationMs: 100,
              isError: false,
              name: "reschedule_appt",
              result: JSON.stringify({
                appointmentId: 98765,
                cancelledAppointmentId: 12345,
                status: "rescheduled",
              }),
            },
          ],
          ttftMs: 0,
          ttsttfbMs: 0,
          turn: 1,
        },
      ],
    });

    expect(normalized.toolActions.bookedAppointment).toBe(true);
    expect(normalized.toolActions.cancelledAppointment).toBe(true);
  });

  it("stores normalized tool executions and ignores malformed action status", () => {
    const normalized = normalizeLiveKitCallPayload({
      callId: "call_malformed_tool_execution",
      callerPhone: "+15551234567",
      durationSec: 30,
      startedAt: "2026-05-20T14:00:30.000Z",
      toolExecutions: [
        {
          outputClass: "appointment_booked",
          status: "pending",
          toolName: { bad: true },
        },
      ] as unknown as LiveKitWebhookPayload["toolExecutions"],
    });
    const data = normalized.dataPayload as {
      toolExecutions?: Array<Record<string, unknown>>;
    };

    expect(normalized.toolActions.bookedAppointment).toBe(false);
    expect(data.toolExecutions).toEqual([{ outputClass: "appointment_booked" }]);
  });
});
