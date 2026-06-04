import { describe, expect, it } from "bun:test";

import { deriveDeterministicFindings } from "@/lib/call-review/deterministic";
import {
  buildNormalizedReviewInputFromAgentCall,
  shouldQueueAgentCallReview,
  type AgentCallReviewSource,
} from "@/lib/call-review/normalize";

function sourceWithData(
  data: unknown,
  overrides: Partial<AgentCallReviewSource> = {},
): AgentCallReviewSource {
  return {
    bookedAppointment: false,
    callId: "call_test",
    callerPhone: "+15551234567",
    cancelledAppointment: false,
    confirmedAppointment: false,
    data,
    durationSec: 60,
    endedAt: new Date("2026-06-01T12:01:00.000Z"),
    fallbackUsed: false,
    id: "agent_call_1",
    interruptionCount: 0,
    officePhone: "+15557654321",
    startedAt: new Date("2026-06-01T12:00:00.000Z"),
    status: "COMPLETED",
    toolCalls: 0,
    toolErrors: 0,
    totalTurns: 1,
    transferred: false,
    ...overrides,
  };
}

describe("call review normalization", () => {
  it("queues completed calls that have review material", () => {
    const data = {
      turns: [
        {
          agentText: "How can I help?",
          callerText: "I need an appointment.",
          toolCalls: [],
          turn: 1,
        },
      ],
    };

    expect(shouldQueueAgentCallReview({ dataPayload: data, status: "COMPLETED" })).toBe(
      true,
    );
    expect(shouldQueueAgentCallReview({ dataPayload: data, status: "IN_PROGRESS" })).toBe(
      false,
    );
  });

  it("redacts obvious identifiers before building judge input", () => {
    const input = buildNormalizedReviewInputFromAgentCall(
      sourceWithData({
        sessionReport: {
          chat_history: {
            items: [
              {
                content: [
                  {
                    transcript:
                      "My phone is +15551234567, email jane@example.com, DOB 01/02/1980, member id ABCD12345.",
                  },
                ],
                createdAt: 1,
                role: "user",
                type: "message",
              },
              {
                content: [{ transcript: "I can help with that." }],
                createdAt: 2,
                role: "assistant",
                type: "message",
              },
            ],
          },
        },
      }),
    );

    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain("+15551234567");
    expect(serialized).not.toContain("jane@example.com");
    expect(serialized).not.toContain("01/02/1980");
    expect(serialized).not.toContain("ABCD12345");
    expect(serialized).toContain("[PHONE]");
    expect(serialized).toContain("[EMAIL]");
    expect(serialized).toContain("[DOB]");
    expect(serialized).toContain("[MEMBER_ID]");
  });
});

describe("call review deterministic findings", () => {
  it("flags a booking success claim when no successful booking tool exists", () => {
    const input = buildNormalizedReviewInputFromAgentCall(
      sourceWithData({
        turns: [
          {
            agentText: "You're booked for tomorrow at 2 pm.",
            callerText: "I need an appointment.",
            toolCalls: [],
            turn: 1,
          },
        ],
      }),
    );

    const flags = deriveDeterministicFindings(input).map((finding) => finding.flag);

    expect(flags).toContain("book_claim_without_book_appt");
  });

  it("does not flag a booking success claim after a successful booking tool", () => {
    const input = buildNormalizedReviewInputFromAgentCall(
      sourceWithData(
        {
          turns: [
            {
              agentText: "You're booked for tomorrow at 2 pm.",
              callerText: "I need an appointment.",
              toolCalls: [
                {
                  args: '{"startDatetime":"2026-06-02T14:00:00"}',
                  durationMs: 200,
                  isError: false,
                  name: "book_appt",
                  result: '{"appointmentId":"appt_123"}',
                },
              ],
              turn: 1,
            },
          ],
        },
        {
          bookedAppointment: true,
          toolCalls: 1,
        },
      ),
    );

    const flags = deriveDeterministicFindings(input).map((finding) => finding.flag);

    expect(flags).not.toContain("book_claim_without_book_appt");
  });

  it("flags insurance acceptance claims without check_insurance", () => {
    const input = buildNormalizedReviewInputFromAgentCall(
      sourceWithData({
        turns: [
          {
            agentText: "Yes, we accept your insurance.",
            callerText: "Do you take Aetna insurance?",
            toolCalls: [],
            turn: 1,
          },
        ],
      }),
    );

    const flags = deriveDeterministicFindings(input).map((finding) => finding.flag);

    expect(flags).toContain("insurance_claim_without_check_insurance");
  });
});
