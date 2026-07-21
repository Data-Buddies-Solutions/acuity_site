import { describe, expect, it } from "bun:test";

import { QueueAccessError } from "@/lib/call-center/auth/queue-access";
import { selectLiveCallOwnership } from "@/lib/call-center/realtime-contract";

import {
  CALL_CENTER_READ_TRANSACTION_OPTIONS,
  activeCallWhere,
  queueCallWhere,
  readCallCenterSnapshot,
  serializeCall,
} from "../realtime-queries";

const now = new Date("2026-07-11T12:00:00.000Z");

function outboundSnapshotCall(id: string, locationId: string) {
  return {
    answerReservation: null,
    answeredAt: now,
    callerName: "Hidden Patient",
    commands: [],
    direction: "OUTBOUND" as const,
    endedAt: null,
    fromPhone: "+19546097250",
    id,
    legs: [
      {
        agentSessionId: "session-1",
        commands: [],
        endpoint: { label: "Front Desk 1", practiceId: "practice-1" },
        endpointId: "endpoint-1",
        id: `${id}-leg`,
        kind: "AGENT" as const,
        providerCallControlId: "control-1",
        providerCallLegId: "provider-leg-1",
        providerCallSessionId: "provider-session-1",
        status: "ANSWERED" as const,
      },
    ],
    number: {
      practiceId: "practice-1",
      practicePhoneNumber: {
        location: {
          name: "North Miami Beach Optical",
          practiceId: "practice-1",
        },
        locationId,
      },
    },
    practiceId: "practice-1",
    queueId: "queue-1",
    receivedAt: now,
    stateVersion: 3,
    status: "CONNECTED" as const,
    toPhone: "+19542872010",
    winningLegId: null,
  };
}

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
        commands: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { status: true, type: true },
          take: 1,
          where: {
            OR: [
              { status: "CONFIRMED", type: "START_HOLD_MUSIC" },
              {
                status: { in: ["SENT", "CONFIRMED"] },
                type: "STOP_HOLD_MUSIC",
              },
            ],
          },
        },
        legs: {
          select: {
            commands: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: { arguments: true, status: true, type: true },
              take: 1,
              where: { type: "TRANSFER_AGENT" },
            },
            endpoint: { select: { label: true, practiceId: true } },
          },
        },
        number: {
          select: {
            practiceId: true,
            practicePhoneNumber: {
              select: {
                locationId: true,
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
      selectedQueueCallIds: [],
      schemaVersion: 9,
    });
  });

  it("separates the authorized outbound queue row from a personal call at another location", async () => {
    const authorized = {
      ...outboundSnapshotCall("call-outbound-authorized", "location-1"),
      commands: [{ status: "CONFIRMED" as const, type: "START_HOLD_MUSIC" as const }],
    };
    const personal = outboundSnapshotCall("call-outbound-personal", "location-2");
    const database = {
      $transaction: async (work: (transaction: unknown) => unknown) =>
        work({
          callCenterCall: {
            findMany: async () => [authorized, personal],
          },
          callCenterQueue: {
            findMany: async () => [
              {
                id: "queue-1",
                locations: [{ locationId: "location-1" }],
                name: "Main queue",
              },
            ],
          },
        }),
    } as never;

    const state = await readCallCenterSnapshot(
      {
        allowedLocationIds: ["location-1"],
        hasAllLocationAccess: false,
        practiceId: "practice-1",
        userId: "user-1",
      },
      "queue-1",
      database,
      () => now,
    );

    expect(state.calls).toHaveLength(2);
    expect(state.calls[0]).toEqual(
      expect.objectContaining({
        callOfficeLabel: "North Miami Beach Optical",
        callerName: "Hidden Patient",
        direction: "OUTBOUND",
        fromPhone: "+19546097250",
        legs: [
          expect.objectContaining({
            endpointLabel: "Front Desk 1",
            id: "call-outbound-authorized-leg",
            status: "ANSWERED",
          }),
        ],
        onHold: true,
        queueId: "queue-1",
        status: "CONNECTED",
        toPhone: "+19542872010",
        winningLegId: null,
      }),
    );
    expect(state.selectedQueueCallIds).toEqual(["call-outbound-authorized"]);
  });

  it("does not project incomplete, failed, rolled-back, or stale hold work", async () => {
    const histories = [
      [{ status: "PENDING" as const, type: "START_HOLD_MUSIC" as const }],
      [{ status: "SENDING" as const, type: "START_HOLD_MUSIC" as const }],
      [{ status: "SENT" as const, type: "START_HOLD_MUSIC" as const }],
      [{ status: "FAILED" as const, type: "START_HOLD_MUSIC" as const }],
      [
        { status: "SENT" as const, type: "STOP_HOLD_MUSIC" as const },
        { status: "CONFIRMED" as const, type: "START_HOLD_MUSIC" as const },
      ],
      [
        { status: "FAILED" as const, type: "START_HOLD_MUSIC" as const },
        { status: "SENT" as const, type: "STOP_HOLD_MUSIC" as const },
        { status: "CONFIRMED" as const, type: "START_HOLD_MUSIC" as const },
      ],
    ];
    const database = {
      $transaction: async (work: (transaction: unknown) => unknown) =>
        work({
          callCenterCall: {
            findMany: async () =>
              histories.map((commands, index) => ({
                ...outboundSnapshotCall(`call-${index}`, "location-1"),
                commands,
              })),
          },
          callCenterQueue: {
            findMany: async () => [{ id: "queue-1", locations: [], name: "Main" }],
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

    expect(state.calls.map(({ onHold }) => onHold)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("projects a pending transfer from its linked canonical target leg", () => {
    const selected = {
      ...outboundSnapshotCall("call-transfer", "location-1"),
      winningLegId: "call-transfer-leg",
    };
    const sourceLegId = selected.winningLegId;
    const target = {
      ...selected.legs[0]!,
      agentSessionId: "session-2",
      commands: [
        {
          arguments: { sourceLegId },
          status: "PENDING" as const,
          type: "TRANSFER_AGENT" as const,
        },
      ],
      endpoint: { label: "Front Desk 2", practiceId: "practice-1" },
      endpointId: "endpoint-2",
      id: "target-leg",
      status: "CREATED" as const,
    };

    expect(
      serializeCall({
        ...selected,
        legs: [{ ...selected.legs[0]!, commands: [] }, target],
      } as never).transferring,
    ).toBe(true);
  });

  it("keeps transfer activity through durable dispatch and target ringing", () => {
    const selected = {
      ...outboundSnapshotCall("call-transfer", "location-1"),
      winningLegId: "call-transfer-leg",
    };
    const target = {
      ...selected.legs[0]!,
      agentSessionId: "session-2",
      endpoint: { label: "Front Desk 2", practiceId: "practice-1" },
      endpointId: "endpoint-2",
      id: "target-leg",
      status: "RINGING" as const,
    };

    const transferring = ["SENDING", "SENT", "CONFIRMED"].map(
      (status) =>
        serializeCall({
          ...selected,
          legs: [
            { ...selected.legs[0]!, commands: [] },
            {
              ...target,
              commands: [
                {
                  arguments: { sourceLegId: selected.winningLegId },
                  status,
                  type: "TRANSFER_AGENT",
                },
              ],
            },
          ],
        } as never).transferring,
    );

    expect(transferring).toEqual([true, true, true]);
  });

  it("rejects failed, declined, timed-out, stale, or ambiguous transfer evidence", () => {
    const selected = {
      ...outboundSnapshotCall("call-transfer", "location-1"),
      winningLegId: "call-transfer-leg",
    };
    const target = {
      ...selected.legs[0]!,
      agentSessionId: "session-2",
      endpoint: { label: "Front Desk 2", practiceId: "practice-1" },
      endpointId: "endpoint-2",
      id: "target-leg",
    };
    const projection = (
      commandStatus: "CONFIRMED" | "FAILED",
      targetStatus: "ENDED" | "FAILED" | "RINGING",
      sourceLegId = selected.winningLegId,
    ) =>
      serializeCall({
        ...selected,
        legs: [
          { ...selected.legs[0]!, commands: [] },
          {
            ...target,
            commands: [
              {
                arguments: { sourceLegId },
                status: commandStatus,
                type: "TRANSFER_AGENT",
              },
            ],
            status: targetStatus,
          },
        ],
      } as never).transferring;
    const ambiguousTarget = {
      ...target,
      commands: [
        {
          arguments: { sourceLegId: selected.winningLegId },
          status: "SENT" as const,
          type: "TRANSFER_AGENT" as const,
        },
      ],
      id: "second-target-leg",
      status: "RINGING" as const,
    };

    expect({
      ambiguous: serializeCall({
        ...selected,
        legs: [
          { ...selected.legs[0]!, commands: [] },
          { ...target, ...ambiguousTarget, id: "target-leg" },
          ambiguousTarget,
        ],
      } as never).transferring,
      declined: projection("CONFIRMED", "ENDED"),
      failed: projection("FAILED", "RINGING"),
      stale: projection("CONFIRMED", "RINGING", "stale-source-leg"),
      timedOut: projection("FAILED", "FAILED"),
    }).toEqual({
      ambiguous: false,
      declined: false,
      failed: false,
      stale: false,
      timedOut: false,
    });
  });

  it("converges successful inbound and outbound transfers on the winning target seat", () => {
    const ownership = (["INBOUND", "OUTBOUND"] as const).map((direction) => {
      const selected = {
        ...outboundSnapshotCall(`call-${direction.toLowerCase()}`, "location-1"),
        direction,
        winningLegId: "target-leg",
      };
      const source = {
        ...selected.legs[0]!,
        commands: [],
        status: "ENDED" as const,
      };
      const target = {
        ...source,
        agentSessionId: "session-2",
        commands: [
          {
            arguments: { sourceLegId: source.id },
            status: "CONFIRMED" as const,
            type: "TRANSFER_AGENT" as const,
          },
        ],
        endpoint: { label: "Front Desk 2", practiceId: "practice-1" },
        endpointId: "endpoint-2",
        id: "target-leg",
        status: "BRIDGED" as const,
      };
      const call = serializeCall({ ...selected, legs: [source, target] } as never);
      return {
        direction,
        owner: selectLiveCallOwnership(call),
        transferring: call.transferring,
      };
    });

    expect(ownership).toEqual([
      {
        direction: "INBOUND",
        owner: { endpointLabel: "Front Desk 2", state: "ANSWERED" },
        transferring: false,
      },
      {
        direction: "OUTBOUND",
        owner: { endpointLabel: "Front Desk 2", state: "ANSWERED" },
        transferring: false,
      },
    ]);
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
        commands: [],
        direction: "INBOUND",
        endedAt: null,
        fromPhone: "+17865550100",
        id: "call-1",
        legs: [
          {
            agentSessionId: "session-1",
            commands: [],
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
        number: {
          practiceId: "practice-1",
          practicePhoneNumber: { location: null, locationId: null },
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
        commands: [],
        direction: "INBOUND",
        endedAt: null,
        fromPhone: "+17865550100",
        id: "call-1",
        legs: [
          {
            agentSessionId: "session-1",
            commands: [],
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
            commands: [],
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
          practiceId: "practice-1",
          practicePhoneNumber: {
            locationId: "location-1",
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
    expect(selectLiveCallOwnership(call)).toEqual({
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
        commands: [],
        direction: "INBOUND",
        endedAt: null,
        fromPhone: "+17865550100",
        id: "call-1",
        legs: [
          {
            agentSessionId: "session-1",
            commands: [],
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
            commands: [],
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
          practiceId: "practice-1",
          practicePhoneNumber: {
            locationId: "location-2",
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
    expect(selectLiveCallOwnership(call)).toEqual({
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
        commands: [],
        direction: "INBOUND",
        endedAt: null,
        fromPhone: "+17865550100",
        id: "call-1",
        legs: [],
        number: {
          practiceId: "practice-1",
          practicePhoneNumber: { location: null, locationId: null },
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

    expect(call.answerReservation).toBeNull();
  });
});
