import { describe, expect, it } from "bun:test";

import type { Prisma } from "@/generated/prisma/client";

import { releaseAgentSessionReservation } from "../prisma-agent-session-reservation";

const now = new Date("2026-07-12T12:00:00.000Z");

describe("canonical agent-session reservation release", () => {
  it("makes a still-ready endpoint available and emits its new state", async () => {
    const operations: string[] = [];
    let event: Record<string, unknown> | null = null;
    const transaction = {
      $queryRaw: async (query: { strings: readonly string[] }) => {
        const sql = query.strings.join("");
        operations.push(
          sql.includes("call_center_endpoint") ? "endpoint.lock" : "session.lock",
        );
        return [];
      },
      callCenterAgentSession: {
        findUnique: async () => ({
          audioReady: true,
          connectionState: "READY",
          currentCallId: "call-1",
          endpointId: "endpoint-1",
          id: "session-1",
          leaseExpiresAt: new Date(now.getTime() + 60_000),
          microphoneReady: true,
          practiceId: "practice-1",
          presence: "BUSY",
          stateVersion: 3,
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          operations.push("session.update");
          expect(data).toMatchObject({ currentCallId: null, presence: "AVAILABLE" });
          return { stateVersion: 4 };
        },
      },
      callCenterEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          operations.push("event.create");
          event = data;
          return { revision: BigInt(1) };
        },
      },
    } as unknown as Prisma.TransactionClient;

    await releaseAgentSessionReservation(transaction, {
      agentSessionId: "session-1",
      callId: "call-1",
      idempotencyKey: "command-1:release",
      now,
      reason: "DIAL_FAILED",
    });

    expect(operations).toEqual([
      "endpoint.lock",
      "session.lock",
      "session.update",
      "event.create",
    ]);
    expect(event).toMatchObject({
      aggregateId: "session-1",
      data: { callId: "call-1", presence: "AVAILABLE", stateVersion: 4 },
      type: "AGENT_SESSION_CALL_RELEASED",
    });
  });

  it("preserves an agent pause while clearing the finished call", async () => {
    let update: Record<string, unknown> | null = null;
    const transaction = {
      $queryRaw: async () => [],
      callCenterAgentSession: {
        findUnique: async () => ({
          audioReady: true,
          connectionState: "READY",
          currentCallId: "call-1",
          endpointId: "endpoint-1",
          id: "session-1",
          leaseExpiresAt: new Date(now.getTime() + 60_000),
          microphoneReady: true,
          practiceId: "practice-1",
          presence: "PAUSED",
          stateVersion: 3,
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          update = data;
          return { stateVersion: 4 };
        },
      },
      callCenterEvent: { create: async () => ({ revision: BigInt(1) }) },
    } as unknown as Prisma.TransactionClient;

    await releaseAgentSessionReservation(transaction, {
      agentSessionId: "session-1",
      callId: "call-1",
      idempotencyKey: "command-1:release",
      now,
      reason: "CALL_ENDED",
    });

    expect(update).toMatchObject({ currentCallId: null, presence: "PAUSED" });
  });

  it("does not clear a reservation already moved to another call", async () => {
    let updates = 0;
    const transaction = {
      $queryRaw: async () => [],
      callCenterAgentSession: {
        findUnique: async () => ({
          currentCallId: "call-2",
          endpointId: "endpoint-1",
        }),
        update: async () => {
          updates += 1;
        },
      },
    } as unknown as Prisma.TransactionClient;

    await releaseAgentSessionReservation(transaction, {
      agentSessionId: "session-1",
      callId: "call-1",
      idempotencyKey: "command-1:release",
      now,
      reason: "DIAL_FAILED",
    });
    expect(updates).toBe(0);
  });
});
