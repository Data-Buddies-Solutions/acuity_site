import { describe, expect, it } from "bun:test";

import { buildVoiceExperimentReport } from "@/lib/voice-experiment-report";

const experimentId = "sweetwater_rime_cartesia_2026_06";

describe("voice experiment report", () => {
  it("groups calls by variant and computes outcome rates", () => {
    const report = buildVoiceExperimentReport(
      [
        {
          bookedAppointment: false,
          cancelledAppointment: false,
          confirmedAppointment: false,
          data: {
            language: { languageChanged: false },
            sessionEvents: {
              falseInterruptions: [{ createdAt: "2026-06-16T10:00:00.000Z" }],
              overlappingSpeech: [{ createdAt: "2026-06-16T10:00:01.000Z" }],
            },
            toolExecutions: [
              {
                outputClass: "appointment_booked",
                status: "success",
                toolName: "book_appt",
              },
            ],
            turns: [{ callerText: "I need an appointment" }],
            voiceExperiment: {
              experimentId,
              provider: "cartesia",
              variant: "cartesia",
              voiceId: "voice-a",
            },
          },
          durationSec: 60,
          status: "COMPLETED",
          toolCalls: 0,
          toolErrors: 0,
          transferred: false,
        },
        {
          bookedAppointment: false,
          cancelledAppointment: false,
          confirmedAppointment: false,
          data: {
            language: { languageSwitches: 1 },
            toolExecutions: [
              {
                outputClass: "transfer_started",
                status: "success",
                toolName: "transfer_call",
              },
              {
                outputClass: "middleware_error",
                status: "error",
                toolName: "check_insurance",
              },
            ],
            turns: [{ callerText: "Representative please" }],
            voiceExperiment: {
              experimentId,
              provider: "rime",
              speaker: "luz",
              variant: "rime",
            },
          },
          durationSec: 30,
          status: "ESCALATED",
          toolCalls: 0,
          toolErrors: 0,
          transferred: true,
        },
        {
          bookedAppointment: false,
          cancelledAppointment: false,
          confirmedAppointment: false,
          data: {
            toolExecutions: [
              {
                outputClass: "knowledge_returned",
                status: "success",
                toolName: "lookup_knowledge",
              },
            ],
            turns: [{ callerText: "What time are you open?" }],
            voiceExperiment: {
              experimentId,
              provider: "rime",
              speaker: "luz",
              variant: "rime",
            },
          },
          durationSec: 45,
          status: "COMPLETED",
          toolCalls: 0,
          toolErrors: 0,
          transferred: false,
        },
        {
          bookedAppointment: true,
          cancelledAppointment: false,
          confirmedAppointment: false,
          data: {
            voiceExperiment: {
              experimentId: "other_experiment",
              variant: "cartesia",
            },
          },
          durationSec: 20,
          status: "COMPLETED",
          toolCalls: 0,
          toolErrors: 0,
          transferred: false,
        },
      ],
      experimentId,
    );

    expect(report.totalCalls).toBe(3);
    expect(report.variants.map((variant) => variant.variant)).toEqual([
      "cartesia",
      "rime",
    ]);

    const cartesia = report.variants.find((variant) => variant.variant === "cartesia");
    expect(cartesia?.captureRate).toBe(1);
    expect(cartesia?.falseInterruptions).toBe(1);
    expect(cartesia?.overlappingSpeech).toBe(1);

    const rime = report.variants.find((variant) => variant.variant === "rime");
    expect(rime?.totalCalls).toBe(2);
    expect(rime?.capturedCalls).toBe(1);
    expect(rime?.earlyRepresentativeRate).toBe(0.5);
    expect(rime?.toolErrorRate).toBe(1 / 3);
    expect(rime?.transferRate).toBe(0.5);
    expect(rime?.languageSwitchRate).toBe(0.5);
  });
});
