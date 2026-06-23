import { describe, expect, it } from "bun:test";

import {
  buildPortalCallTranscriptMessages,
  classifyBookingAppointmentType,
  extractBookedAppointment,
  filterPortalBookingsBySearch,
  summarizeBookingCategories,
  type PortalBookedAppointment,
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

  it("extracts portal booking rows from structured reschedule results", () => {
    const booking = extractBookedAppointment({
      callerPhone: "+17275551212",
      data: {
        turns: [
          {
            agentText: "I moved the appointment.",
            toolCalls: [
              {
                args: JSON.stringify({
                  appointmentId: 12345,
                  appointmentReason: "move appointment",
                  referringDoctor: "none",
                  slotId: "A",
                }),
                isError: false,
                name: "reschedule_appt",
                result: JSON.stringify({
                  appointmentId: 98765,
                  appointmentTypeName: "Established Adult",
                  bookingStatus: "booked",
                  cancelledAppointmentId: 12345,
                  cancellationStatus: "cancelled",
                  duration: 30,
                  locationName: "Spring Hill",
                  patientName: "SMITH,JANE",
                  providerName: "Dr. Austin Bach",
                  startDatetime: "2026-05-12T11:00",
                  status: "rescheduled",
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

    expect(booking).toMatchObject({
      appointmentId: "98765",
      appointmentStart: "2026-05-12T11:00",
      appointmentStatus: "rescheduled",
      appointmentTypeName: "Established Adult",
      duration: 30,
      locationName: "Spring Hill",
      patientName: "Jane Smith",
      providerName: "Dr. Austin Bach",
    });
  });

  it("falls back to final call state when booking tool output is speech text", () => {
    const booking = extractBookedAppointment({
      callerPhone: "+17275551212",
      data: {
        callState: {
          patient: {
            name: "Jane Smith",
            appointments: [
              {
                id: 98765,
                date: "2026-05-12",
                time: "11:00 AM",
                provider: "Dr. Austin Bach",
                type: "Established Adult",
                facility: "Spring Hill",
                confirmed: true,
              },
            ],
          },
          private: {
            latestBookedAppointmentId: 98765,
          },
        },
        turns: [
          {
            agentText: "The appointment is booked.",
            toolCalls: [
              {
                args: JSON.stringify({
                  appointmentReason: "blurry vision",
                  referringDoctor: "none",
                  slotId: "A",
                }),
                isError: false,
                name: "book_appt",
                result: "Booked May 12 at 11:00 AM with Dr. Austin Bach.",
              },
            ],
          },
        ],
      },
      id: "call-1",
      outcomeSummary: null,
      startedAt: new Date("2026-05-03T13:00:00.000Z"),
    });

    expect(booking).toMatchObject({
      appointmentId: "98765",
      appointmentStart: "2026-05-12T11:00",
      appointmentStatus: "booked",
      appointmentTypeName: "Established Adult",
      locationName: "Spring Hill",
      patientName: "Jane Smith",
      providerName: "Dr. Austin Bach",
    });
  });

  it("falls back to the current agent call state shape", () => {
    const booking = extractBookedAppointment({
      callerPhone: "+17275551212",
      data: {
        callState: {
          identity: {
            latestBookedAppointmentId: 98765,
            patient: {
              name: "Jane Smith",
              appointments: [
                {
                  id: 98765,
                  date: "2026-05-12",
                  time: "11:00 AM",
                  provider: "Dr. Austin Bach",
                  type: "Established Adult",
                  facility: "Spring Hill",
                  confirmed: true,
                },
              ],
            },
          },
        },
        turns: [
          {
            agentText: "The appointment was moved.",
            toolCalls: [
              {
                args: JSON.stringify({
                  appointmentReason: "move appointment",
                  referringDoctor: "none",
                  slotId: "A",
                }),
                isError: false,
                name: "reschedule_appt",
                result:
                  "Rescheduled the appointment to May 12 at 11:00 AM. Cancelled the old appointment.",
              },
            ],
          },
        ],
      },
      id: "call-1",
      outcomeSummary: null,
      startedAt: new Date("2026-05-03T13:00:00.000Z"),
    });

    expect(booking).toMatchObject({
      appointmentId: "98765",
      appointmentStart: "2026-05-12T11:00",
      appointmentStatus: "booked",
      appointmentTypeName: "Established Adult",
      locationName: "Spring Hill",
      patientName: "Jane Smith",
      providerName: "Dr. Austin Bach",
    });
  });
});

describe("portal booking search", () => {
  const baseBooking: PortalBookedAppointment = {
    appointmentId: "appt-1",
    appointmentStart: "2026-05-12T11:00",
    appointmentStatus: "booked",
    appointmentTypeName: "Established Adult",
    callId: "call-1",
    callStartedAt: new Date("2026-05-03T13:00:00.000Z"),
    callerPhone: "+17275551212",
    careLane: "unknown",
    duration: 30,
    locationName: "Spring Hill",
    patientName: "Jane Smith",
    providerName: "Dr. Austin Bach",
    summary: null,
    visitType: "follow_up_or_existing",
  };

  it("matches patient names case-insensitively", () => {
    const results = filterPortalBookingsBySearch(
      [
        baseBooking,
        {
          ...baseBooking,
          appointmentId: "appt-2",
          callId: "call-2",
          patientName: "Robert Jones",
        },
      ],
      "jane",
    );

    expect(results).toHaveLength(1);
    expect(results[0].patientName).toBe("Jane Smith");
  });

  it("matches caller phone digits across formatting", () => {
    const results = filterPortalBookingsBySearch([baseBooking], "(727) 555-1212");

    expect(results).toHaveLength(1);
    expect(results[0].callerPhone).toBe("+17275551212");
  });
});

describe("portal booking categories", () => {
  it("classifies appointment type names into care lane and visit type", () => {
    expect(classifyBookingAppointmentType("New Adult Medical")).toEqual({
      careLane: "medical",
      visitType: "new",
    });
    expect(classifyBookingAppointmentType("Established Pediatric Vision")).toEqual({
      careLane: "routine_vision",
      visitType: "follow_up_or_existing",
    });
    expect(classifyBookingAppointmentType("Crystal River New Patient")).toEqual({
      careLane: "unknown",
      visitType: "new",
    });
  });

  it("summarizes medical, routine vision, and unclassified bookings", () => {
    const baseBooking: PortalBookedAppointment = {
      appointmentId: "appt-1",
      appointmentStart: "2026-05-12T11:00",
      appointmentStatus: "booked",
      appointmentTypeName: "New Adult Medical",
      callId: "call-1",
      callStartedAt: new Date("2026-05-03T13:00:00.000Z"),
      callerPhone: "+17275551212",
      careLane: "medical",
      duration: 30,
      locationName: "Spring Hill",
      patientName: "Jane Smith",
      providerName: "Dr. Austin Bach",
      summary: null,
      visitType: "new",
    };

    const summary = summarizeBookingCategories([
      baseBooking,
      {
        ...baseBooking,
        appointmentId: "appt-2",
        appointmentTypeName: "Established Adult Vision",
        callId: "call-2",
        careLane: "routine_vision",
        visitType: "follow_up_or_existing",
      },
      {
        ...baseBooking,
        appointmentId: "appt-3",
        appointmentTypeName: "Crystal River New Patient",
        callId: "call-3",
        careLane: "unknown",
        visitType: "new",
      },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.medical).toMatchObject({
      newPatient: 1,
      total: 1,
    });
    expect(summary.routineVision).toMatchObject({
      followUpOrExisting: 1,
      total: 1,
    });
    expect(summary.unknown).toMatchObject({
      newPatient: 1,
      total: 1,
    });
  });
});
