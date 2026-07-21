import { describe, expect, it } from "bun:test";

import { QueueAccessError } from "@/lib/call-center/auth/queue-access";
import { selectInboundCallOwnership } from "@/lib/call-center/realtime-contract";

import {
  CALL_CENTER_READ_TRANSACTION_OPTIONS,
  activeCallWhere,
  queueCallWhere,
  readCallCenterSnapshot,
  serializeCall,
} from "../realtime-queries";

const now = new Date("2026-07-11T12:00:00.000Z");

describe("call center snapshot", () => {
  it("includes live offers outside the selected queue while excluding terminal calls", () => {
    const selectedQueue = { practiceId: "practice-1", queueId: "queue-1" };
    expect(
      activeCallWhere(selectedQueue, {
        practiceId: "practice-1",
        userId: "user-1",
      }),
    ).toEqual({
      AND: [
        {
          OR: [
            selectedQueue,
            {
              legs: {
                some: {
                  agentSession: {
                    practiceId: "practice-1",
                    userId: "user-1",
                  },
                  kind: "AGENT",
                  status: {
                    in: ["CREATED", "DIALING", "RINGING", "ANSWERED", "BRIDGED"],
                  },
                },
              },
              practiceId: "practice-1",
            },
          ],
        },
        { status: { in: ["RECEIVED", "QUEUED", "RINGING", "CONNECTED"] } },
      ],
    });
  });

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

  it("returns only authorized active calls in a two-query budget", async () => {
    let activeCallQuery: unknown;
    const operations: string[] = [];
    const database = {
      $transaction: async (work: (transaction: unknown) => unknown) =>
        work({
          callCenterCall: {
            findMany: async (query: unknown) => {
              operations.push("active-calls");
              activeCallQuery = query;
              return [];
            },
          },
          callCenterQueue: {
            findMany: async () => {
              operations.push("queue-access");
              return [{ id: "queue-1", locations: [], name: "Main queue" }];
            },
          },
        }),
    } as never;

    const state = await readCallCenterSnapshot(
      {
        allowedLocationIds: [],
        hasAllLocationAccess: true,
        practiceId: "practice-1",
        userId: "user-1",
      },
      "queue-1",
      database,
      () => now,
    );

    expect(operations).toEqual(["queue-access", "active-calls"]);
    expect(activeCallQuery).toMatchObject({
      select: {
        legs: {
          select: {
            endpoint: { select: { label: true, practiceId: true } },
          },
        },
        number: {
          select: {
            practicePhoneNumber: {
              select: {
                location: { select: { name: true, practiceId: true } },
              },
            },
          },
        },
      },
      take: 100,
    });
    expect(state).toEqual({
      calls: [],
      observedAt: "2026-07-11T12:00:00.000Z",
      queueId: "queue-1",
      schemaVersion: 6,
    });
  });

  it("serializes durable calls without Date values", () => {
    const call = serializeCall(
      {
        answerReservation: {
          agentSessionId: "session-1",
          expiresAt: new Date("2026-07-11T12:00:05.000Z"),
          legId: "leg-1",
          status: "ACCEPTED",
        },
        answeredAt: null,
        callerName: null,
        direction: "INBOUND",
        endedAt: null,
        fromPhone: "+17865550100",
        id: "call-1",
        legs: [
          {
            agentSessionId: "session-1",
            endpoint: null,
            endpointId: "endpoint-1",
            id: "leg-1",
            kind: "AGENT",
            providerCallControlId: "control-1",
            providerCallLegId: "provider-leg-1",
            providerCallSessionId: "provider-session-1",
            status: "RINGING",
          },
        ],
        number: { practicePhoneNumber: { location: null } },
        practiceId: "practice-1",
        queueId: "queue-1",
        receivedAt: now,
        stateVersion: 12,
        status: "RINGING",
        toPhone: "+17865550101",
        winningLegId: null,
      },
      now,
    );

    expect(call).toMatchObject({
      answerReservation: {
        expiresAt: "2026-07-11T12:00:05.000Z",
        status: "ACCEPTED",
      },
      receivedAt: "2026-07-11T12:00:00.000Z",
      stateVersion: 12,
    });
  });

  it("serializes the authorized endpoint seat and inbound call office", () => {
    const call = serializeCall(
      {
        answerReservation: null,
        answeredAt: now,
        callerName: "Hidden Patient",
        direction: "INBOUND",
        endedAt: null,
        fromPhone: "+17865550100",
        id: "call-1",
        legs: [
          {
            agentSessionId: "session-1",
            endpoint: { label: "Front Desk 1", practiceId: "practice-1" },
            endpointId: "endpoint-1",
            id: "leg-1",
            kind: "AGENT",
            providerCallControlId: "control-1",
            providerCallLegId: "provider-leg-1",
            providerCallSessionId: "provider-session-1",
            status: "BRIDGED",
          },
          {
            agentSessionId: "session-2",
            endpoint: { label: "Front Desk 2", practiceId: "practice-1" },
            endpointId: "endpoint-2",
            id: "leg-2",
            kind: "AGENT",
            providerCallControlId: "control-2",
            providerCallLegId: "provider-leg-2",
            providerCallSessionId: "provider-session-2",
            status: "ANSWERED",
          },
        ],
        number: {
          practicePhoneNumber: {
            location: {
              name: "North Miami Beach Optical",
              practiceId: "practice-1",
            },
          },
        },
        practiceId: "practice-1",
        queueId: "queue-1",
        receivedAt: now,
        stateVersion: 12,
        status: "CONNECTED",
        toPhone: "+17865550101",
        winningLegId: "leg-1",
      },
      now,
    );

    expect(call).toMatchObject({
      callOfficeLabel: "North Miami Beach Optical",
      legs: [
        { endpointLabel: "Front Desk 1", id: "leg-1", status: "BRIDGED" },
        { endpointLabel: "Front Desk 2", id: "leg-2", status: "ANSWERED" },
      ],
      winningLegId: "leg-1",
    });
    expect(call).not.toHaveProperty("number");
    expect(call).not.toHaveProperty("practiceId");
    expect(selectInboundCallOwnership(call)).toEqual({
      endpointLabel: "Front Desk 1",
      state: "ANSWERED",
    });
  });

  it("fails closed when endpoint or office ownership crosses the call practice", () => {
    const call = serializeCall(
      {
        answerReservation: null,
        answeredAt: null,
        callerName: null,
        direction: "INBOUND",
        endedAt: null,
        fromPhone: "+17865550100",
        id: "call-1",
        legs: [
          {
            agentSessionId: "session-1",
            endpoint: { label: "Front Desk 1", practiceId: "practice-1" },
            endpointId: "endpoint-1",
            id: "leg-1",
            kind: "AGENT",
            providerCallControlId: "control-1",
            providerCallLegId: "provider-leg-1",
            providerCallSessionId: "provider-session-1",
            status: "ANSWERED",
          },
          {
            agentSessionId: "session-2",
            endpoint: { label: "Other Practice Seat", practiceId: "practice-2" },
            endpointId: "endpoint-2",
            id: "leg-2",
            kind: "AGENT",
            providerCallControlId: "control-2",
            providerCallLegId: "provider-leg-2",
            providerCallSessionId: "provider-session-2",
            status: "ANSWERED",
          },
        ],
        number: {
          practicePhoneNumber: {
            location: { name: "Other Practice", practiceId: "practice-2" },
          },
        },
        practiceId: "practice-1",
        queueId: "queue-1",
        receivedAt: now,
        stateVersion: 12,
        status: "RINGING",
        toPhone: "+17865550101",
        winningLegId: null,
      },
      now,
    );

    expect(call.callOfficeLabel).toBeNull();
    expect(call.legs.map(({ endpointLabel }) => endpointLabel)).toEqual([
      "Front Desk 1",
      null,
    ]);
    expect(selectInboundCallOwnership(call)).toEqual({
      endpointLabel: null,
      state: "RINGING",
    });
  });

  it("omits an expired active answer reservation", () => {
    const call = serializeCall(
      {
        answerReservation: {
          agentSessionId: "session-1",
          expiresAt: now,
          legId: "leg-1",
          status: "ANSWERED",
        },
        answeredAt: null,
        callerName: null,
        direction: "INBOUND",
        endedAt: null,
        fromPhone: "+17865550100",
        id: "call-1",
        legs: [],
        number: { practicePhoneNumber: { location: null } },
        practiceId: "practice-1",
        queueId: "queue-1",
        receivedAt: now,
        stateVersion: 12,
        status: "RINGING",
        toPhone: "+17865550101",
        winningLegId: null,
      },
      now,
    );

    expect(call.answerReservation).toBeNull();
  });
});
