import { describe, expect, it } from "bun:test";

import {
  buildPortalCallTranscriptMessages,
  extractBookedAppointment,
} from "@/lib/portal-overview";

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

describe("portal booking extraction", () => {
  it("prefers canonical booking result fields for portal booking rows", () => {
    const startedAt = new Date("2026-05-03T13:00:00.000Z");

    const booking = extractBookedAppointment({
      callerPhone: "+17275551212",
      data: {
        turns: [
          {
            agentText: "I found one opening.",
            toolCalls: [
              {
                args: JSON.stringify({ date: "2026-05-12" }),
                isError: false,
                name: "get_availability",
                result: JSON.stringify({
                  location: "Old Location",
                  providers: [
                    {
                      columnId: 1513,
                      facility: "Old Facility",
                      name: "Old Provider",
                      profileId: 620,
                    },
                  ],
                }),
              },
              {
                args: JSON.stringify({
                  columnId: 1513,
                  duration: 30,
                  profileId: 620,
                  startDatetime: "2026-05-12T10:30",
                }),
                isError: false,
                name: "book_appt",
                result: JSON.stringify({
                  appointmentId: 98765,
                  appointmentTypeName: "Established Adult",
                  duration: 30,
                  locationName: "Spring Hill",
                  patientName: "SMITH,JANE",
                  providerName: "Dr. Austin Bach",
                  startDatetime: "2026-05-12T11:00",
                  status: "booked",
                }),
              },
            ],
          },
        ],
      },
      id: "call-1",
      outcomeSummary: null,
      startedAt,
    });

    expect(booking).toMatchObject({
      appointmentId: "98765",
      appointmentStart: "2026-05-12T11:00",
      appointmentStatus: "booked",
      appointmentTypeName: "Established Adult",
      callId: "call-1",
      callerPhone: "+17275551212",
      duration: 30,
      locationName: "Spring Hill",
      patientName: "Jane Smith",
      providerName: "Dr. Austin Bach",
    });
  });

  it("falls back to availability matches for old booking payloads", () => {
    const booking = extractBookedAppointment({
      callerPhone: "+17275551212",
      data: {
        turns: [
          {
            toolCalls: [
              {
                isError: false,
                name: "get_availability",
                result: JSON.stringify({
                  providers: [
                    {
                      columnId: 1513,
                      facility: "ABITA EYE GROUP SPRING HILL",
                      name: "Dr. Austin Bach",
                      profileId: 620,
                    },
                  ],
                }),
              },
              {
                args: JSON.stringify({
                  columnId: 1513,
                  patientName: "Jane Smith",
                  profileId: 620,
                  startDatetime: "2026-05-12T11:00",
                }),
                isError: false,
                name: "book_appt",
                result: JSON.stringify({
                  appointmentId: 98765,
                  status: "booked",
                }),
              },
            ],
          },
        ],
      },
      id: "call-1",
      outcomeSummary: null,
      startedAt: new Date("2026-05-03T13:00:00.000Z"),
    });

    expect(booking.providerName).toBe("Dr. Austin Bach");
    expect(booking.locationName).toBe("ABITA EYE GROUP SPRING HILL");
    expect(booking.patientName).toBe("Jane Smith");
  });
});
