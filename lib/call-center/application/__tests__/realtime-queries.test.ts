import { describe, expect, it } from "bun:test";

import { QueueAccessError } from "@/lib/call-center/auth/queue-access";

import {
  CALL_CENTER_READ_TRANSACTION_OPTIONS,
  queueCallWhere,
  readCallCenterSnapshot,
  serializeCall,
} from "../realtime-queries";

const now = new Date("2026-07-11T12:00:00.000Z");

describe("call center snapshot", () => {
  it("scopes queue calls through the configured number location", () => {
    expect(
      queueCallWhere(
        {
          allowedLocationIds: ["location-1"],
          hasAllLocationAccess: false,
          practiceId: "practice-1",
          userId: "user-1",
        },
        "queue-1",
        ["location-1", "location-2"],
      ),
    ).toEqual({
      number: {
        practiceId: "practice-1",
        practicePhoneNumber: {
          location: { practiceId: "practice-1" },
          locationId: { in: ["location-1"] },
        },
      },
      practiceId: "practice-1",
      queueId: "queue-1",
    });
  });

  it("scopes a practice-wide queue to the actor's selected locations", () => {
    expect(
      queueCallWhere(
        {
          allowedLocationIds: ["location-1"],
          hasAllLocationAccess: false,
          practiceId: "practice-1",
          userId: "user-1",
        },
        "queue-1",
        [],
      ),
    ).toMatchObject({
      number: {
        practiceId: "practice-1",
        practicePhoneNumber: {
          locationId: { in: ["location-1"] },
        },
      },
    });
  });

  it("loads queue access once inside the read transaction budget", async () => {
    let queries = 0;
    let options: unknown;
    const database = {
      $transaction: async (
        work: (transaction: unknown) => unknown,
        transactionOptions: unknown,
      ) => {
        options = transactionOptions;
        return work({
          callCenterQueue: {
            findMany: async () => {
              queries += 1;
              return [];
            },
          },
        });
      },
    } as never;

    await expect(
      readCallCenterSnapshot(
        {
          allowedLocationIds: [],
          hasAllLocationAccess: true,
          practiceId: "practice-1",
          userId: "user-1",
        },
        "queue-1",
        database,
      ),
    ).rejects.toBeInstanceOf(QueueAccessError);
    expect(queries).toBe(1);
    expect(options).toEqual(CALL_CENTER_READ_TRANSACTION_OPTIONS);
  });

  it("serializes durable calls without Date values", () => {
    const call = serializeCall({
      answeredAt: null,
      callerName: null,
      direction: "INBOUND",
      endedAt: null,
      fromPhone: "+17865550100",
      id: "call-1",
      legs: [
        {
          agentSessionId: "session-1",
          endpointId: "endpoint-1",
          id: "leg-1",
          kind: "AGENT",
          providerCallControlId: "control-1",
          providerCallLegId: "provider-leg-1",
          providerCallSessionId: "provider-session-1",
          status: "RINGING",
        },
      ],
      queueId: "queue-1",
      receivedAt: now,
      stateVersion: 12,
      status: "RINGING",
      toPhone: "+17865550101",
      winningLegId: null,
    });

    expect(call).toMatchObject({
      receivedAt: "2026-07-11T12:00:00.000Z",
      stateVersion: 12,
    });
  });
});
