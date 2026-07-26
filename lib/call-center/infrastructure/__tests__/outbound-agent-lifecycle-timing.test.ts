import { describe, expect, it } from "bun:test";

import { outboundAgentLifecycleTiming } from "@/lib/call-center/infrastructure/prisma-canonical-call-projector";

describe("outbound agent lifecycle timing", () => {
  it("names durable ringing and answer phases without caller data", () => {
    const startedAt = new Date("2026-07-25T12:00:00.000Z");

    expect(
      outboundAgentLifecycleTiming({
        direction: "OUTBOUND",
        eventType: "call.ringing",
        legKind: "AGENT",
        occurredAt: new Date("2026-07-25T12:00:04.000Z"),
        startedAt,
      }),
    ).toEqual({
      durationMs: 4_000,
      occurredAt: "2026-07-25T12:00:04.000Z",
      phase: "agent-ringing",
      startedAt: "2026-07-25T12:00:00.000Z",
    });
    expect(
      outboundAgentLifecycleTiming({
        direction: "OUTBOUND",
        eventType: "call.answered",
        legKind: "AGENT",
        occurredAt: new Date("2026-07-25T12:00:06.000Z"),
        startedAt,
      }),
    ).toMatchObject({ durationMs: 6_000, phase: "agent-answer" });
    expect(
      outboundAgentLifecycleTiming({
        direction: "INBOUND",
        eventType: "call.answered",
        legKind: "AGENT",
        occurredAt: startedAt,
        startedAt,
      }),
    ).toBeNull();
  });
});
