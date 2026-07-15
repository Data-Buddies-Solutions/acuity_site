import { describe, expect, it } from "bun:test";

import {
  buildCanonicalBatchItems,
  localAgentSessionWhere,
  queueCallWhere,
  readCanonicalEventBatch,
  serializeAgentSession,
  serializeCall,
  serializeOperation,
  serializeReadyTransferTargets,
} from "../realtime-queries";

const now = new Date("2026-07-11T12:00:00.000Z");

describe("canonical realtime serializers", () => {
  it("offers only staff with exactly one ready transfer session", () => {
    expect(
      serializeReadyTransferTargets([
        {
          user: {
            callCenterEndpoints: [{ agentSessions: [{ id: "session-1" }] }],
            id: "ready-user",
            name: "Ready",
          },
        },
        {
          user: {
            callCenterEndpoints: [{ agentSessions: [] }],
            id: "offline-user",
            name: "Offline",
          },
        },
        {
          user: {
            callCenterEndpoints: [
              { agentSessions: [{ id: "session-2" }, { id: "session-3" }] },
            ],
            id: "ambiguous-user",
            name: "Ambiguous",
          },
        },
      ]),
    ).toEqual([{ name: "Ready", userId: "ready-user" }]);
  });

  it("binds the local session projection to this browser instance", () => {
    expect(
      localAgentSessionWhere(
        {
          allowedLocationIds: [],
          hasAllLocationAccess: true,
          practiceId: "practice-1",
          userId: "user-1",
        },
        ["endpoint-1"],
        "tab-1",
        now,
      ),
    ).toMatchObject({
      browserSessionId: "tab-1",
      endpointId: { in: ["endpoint-1"] },
      OR: [
        { currentCallId: { not: null } },
        { offeredCallId: { not: null } },
        {
          connectionState: { not: "CLOSED" },
          leaseExpiresAt: { gt: now },
          presence: { not: "OFFLINE" },
        },
      ],
      practiceId: "practice-1",
      userId: "user-1",
    });
  });

  it("keeps active-call ownership projected when the station lease expires", () => {
    const session = {
      audioReady: false,
      browserSessionId: "tab-1",
      connectionState: "CLOSED" as const,
      currentCallId: "call-1",
      offeredCallId: null,
      endpointId: "endpoint-1",
      id: "session-1",
      leaseExpiresAt: now,
      microphoneReady: false,
      presence: "OFFLINE" as const,
      stateVersion: 5,
    };
    const counts = { active: 1, openTasks: 0, recent: 0, waiting: 0 };

    const [active] = buildCanonicalBatchItems({
      calls: [],
      counts,
      events: [
        {
          aggregateId: session.id,
          aggregateType: "AGENT_SESSION",
          data: {},
          practiceId: "practice-1",
          revision: BigInt(40),
          type: "AGENT_SESSION_LEASE_EXPIRED",
        },
      ],
      sessions: [session],
      tasks: [],
    });
    const [idle] = buildCanonicalBatchItems({
      calls: [],
      counts,
      events: [
        {
          aggregateId: session.id,
          aggregateType: "AGENT_SESSION",
          data: {},
          practiceId: "practice-1",
          revision: BigInt(41),
          type: "AGENT_SESSION_LEASE_EXPIRED",
        },
      ],
      sessions: [{ ...session, currentCallId: null }],
      tasks: [],
    });

    expect(active.projection).toMatchObject({
      delta: {
        kind: "AGENT_SESSION_UPSERT",
        session: { currentCallId: "call-1", id: "session-1" },
      },
    });
    expect(idle.projection).toMatchObject({
      delta: { kind: "AGENT_SESSION_REMOVE", sessionId: "session-1" },
    });
  });
  it("scopes queue calls through the configured practice-number location", () => {
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

  it("preserves call stateVersion while removing Date and bigint hazards", () => {
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

    expect(call.stateVersion).toBe(12);
    expect(call.receivedAt).toBe("2026-07-11T12:00:00.000Z");
    expect(call.legs[0]?.providerCallSessionId).toBe("provider-session-1");
  });

  it("uses the canonical client identity and connection vocabulary", () => {
    const session = serializeAgentSession({
      audioReady: false,
      browserSessionId: "tab-1",
      connectionState: "ERROR",
      currentCallId: "call-1",
      offeredCallId: null,
      endpointId: "endpoint-1",
      id: "session-1",
      leaseExpiresAt: now,
      microphoneReady: true,
      presence: "PAUSED",
      stateVersion: 4,
    });

    expect(session).toMatchObject({
      clientInstanceId: "tab-1",
      connectionState: "FAILED",
      currentCallId: "call-1",
      stateVersion: 4,
    });
    expect("browserSessionId" in session).toBe(false);
  });

  it("removes resolved tasks and carries absolute convergent counts", () => {
    const counts = { active: 1, openTasks: 0, recent: 2, waiting: 3 };
    const [item] = buildCanonicalBatchItems({
      calls: [],
      counts,
      events: [
        {
          aggregateId: "task-1",
          aggregateType: "TASK",
          data: {},
          practiceId: "practice-1",
          revision: BigInt(42),
          type: "TASK_RESOLVED",
        },
      ],
      sessions: [],
      tasks: [
        {
          callId: "call-1",
          callerPhone: null,
          createdAt: new Date("2026-07-12T12:00:00.000Z"),
          id: "task-1",
          kind: "FOLLOW_UP",
          status: "RESOLVED",
        },
      ],
    });

    expect(item.projection).toMatchObject({
      counts,
      delta: { kind: "TASK_REMOVE", taskId: "task-1" },
      revision: "42",
    });
  });

  it("projects a claim receipt as one durable operation", () => {
    const counts = { active: 0, openTasks: 0, recent: 0, waiting: 1 };
    const [item] = buildCanonicalBatchItems({
      calls: [
        {
          answeredAt: null,
          callerName: null,
          direction: "INBOUND",
          endedAt: null,
          fromPhone: "+17865550100",
          id: "call-1",
          legs: [],
          queueId: "queue-1",
          receivedAt: now,
          stateVersion: 2,
          status: "RINGING",
          toPhone: "+17865550101",
          winningLegId: null,
        },
      ],
      commands: [
        {
          callId: "call-1",
          errorCode: null,
          id: "command-1",
          nextAttemptAt: null,
          practiceId: "practice-1",
          status: "PENDING",
          type: "DIAL_AGENT",
        },
      ],
      counts,
      events: [
        {
          aggregateId: "call-1",
          aggregateType: "CALL",
          data: {
            agentSessionId: "session-1",
            endpointId: "endpoint-1",
            legId: "leg-1",
            providerCommandId: "command-1",
          },
          practiceId: "practice-1",
          revision: BigInt(43),
          type: "CALL_CLAIM_REQUESTED",
        },
      ],
      sessions: [],
      tasks: [],
    });

    expect(item.projection).toMatchObject({
      aggregateType: "COMMAND",
      delta: {
        kind: "OPERATION_UPSERT",
        operation: {
          callId: "call-1",
          operationEventRevision: "43",
          providerCommandId: "command-1",
          status: "PENDING",
          targetAgentSessionId: "session-1",
          targetEndpointId: "endpoint-1",
          targetLegId: "leg-1",
          type: "CLAIM",
        },
      },
    });
  });

  it("projects an outbound receipt without exposing browser dial data", () => {
    const operation = serializeOperation(
      {
        aggregateId: "call-outbound",
        aggregateType: "CALL",
        data: {
          agentSessionId: "session-1",
          callId: "call-outbound",
          clientState: "must-not-leak",
          endpointId: "endpoint-1",
          from: "+15555550000",
          legId: "leg-outbound",
          to: "+15555550123",
        },
        practiceId: "practice-1",
        revision: BigInt(44),
        type: "CALL_OUTBOUND_REQUESTED",
      },
      new Map(),
    );

    expect(operation).toEqual({
      callId: "call-outbound",
      errorCode: null,
      operationEventRevision: "44",
      providerCommandId: null,
      status: "CONFIRMED",
      targetAgentSessionId: "session-1",
      targetEndpointId: "endpoint-1",
      targetLegId: "leg-outbound",
      type: "OUTBOUND",
    });
    expect(JSON.stringify(operation)).not.toContain("must-not-leak");
    expect(JSON.stringify(operation)).not.toContain("+1555555");
  });

  it("exposes the exact source and target identities for a transfer", () => {
    const operation = serializeOperation(
      {
        aggregateId: "call-1",
        aggregateType: "CALL",
        data: {
          providerCommandId: "transfer-command",
          sourceLegId: "source-leg",
          targetAgentSessionId: "target-session",
          targetEndpointId: "target-endpoint",
          targetLegId: "target-leg",
        },
        practiceId: "practice-1",
        revision: BigInt(45),
        type: "CALL_TRANSFER_REQUESTED",
      },
      new Map([
        [
          "transfer-command",
          {
            callId: "call-1",
            errorCode: null,
            id: "transfer-command",
            nextAttemptAt: null,
            practiceId: "practice-1",
            status: "SENT",
            type: "DIAL_AGENT",
          },
        ],
      ]),
    );

    expect(operation).toEqual({
      callId: "call-1",
      errorCode: null,
      operationEventRevision: "45",
      providerCommandId: "transfer-command",
      sourceLegId: "source-leg",
      status: "SENT",
      targetAgentSessionId: "target-session",
      targetEndpointId: "target-endpoint",
      targetLegId: "target-leg",
      type: "TRANSFER",
    });
  });

  it("projects later command failure onto the original operation", () => {
    const [item] = buildCanonicalBatchItems({
      calls: [
        {
          answeredAt: null,
          callerName: null,
          direction: "INBOUND",
          endedAt: null,
          fromPhone: "+17865550100",
          id: "call-1",
          legs: [],
          queueId: "queue-1",
          receivedAt: now,
          stateVersion: 2,
          status: "QUEUED",
          toPhone: "+17865550101",
          winningLegId: null,
        },
      ],
      commands: [
        {
          callId: "call-1",
          errorCode: "PROVIDER_VALIDATION_FAILED",
          id: "command-1",
          nextAttemptAt: null,
          practiceId: "practice-1",
          status: "FAILED",
          type: "DIAL_AGENT",
        },
      ],
      counts: { active: 0, openTasks: 0, recent: 0, waiting: 1 },
      events: [
        {
          aggregateId: "call-1",
          aggregateType: "CALL",
          data: {
            operationEventRevision: "43",
            providerCommandId: "command-1",
            targetAgentSessionId: "session-1",
            targetEndpointId: "endpoint-1",
            targetLegId: "leg-1",
          },
          practiceId: "practice-1",
          revision: BigInt(44),
          type: "CALL_OPERATION_STATUS_CHANGED",
        },
      ],
      sessions: [],
      tasks: [],
    });

    expect(item.projection).toMatchObject({
      revision: "44",
      delta: {
        kind: "OPERATION_UPSERT",
        operation: {
          operationEventRevision: "43",
          status: "FAILED",
        },
      },
    });
  });

  it("keeps each poll query count constant for a full filtered batch", async () => {
    async function run(eventCount: number) {
      let queries = 0;
      const counted =
        <T>(value: T) =>
        async () => {
          queries += 1;
          return value;
        };
      const transaction = {
        callCenterAgentSession: { findMany: counted([]) },
        callCenterCall: {
          count: counted(0),
          findMany: counted([]),
        },
        callCenterCommand: { findMany: counted([]) },
        callCenterEvent: {
          findMany: counted(
            Array.from({ length: eventCount }, (_, index) => ({
              aggregateId: `other-call-${index}`,
              aggregateType: "CALL",
              data: {},
              practiceId: "practice-1",
              revision: BigInt(index + 1),
              type: "CALL_UPDATED",
            })),
          ),
        },
        callCenterQueue: {
          findFirst: counted({
            id: "queue-1",
            locations: [{ locationId: "location-1" }],
            maxWaitSec: 30,
            name: "Optical",
            ringTimeoutSec: 20,
            routingMode: "LEGACY",
          }),
        },
        callCenterTask: {
          count: counted(0),
          findMany: counted([]),
        },
        practiceMembership: {
          findUnique: counted({ locationScope: "ALL", locations: [] }),
        },
      };
      const database = {
        $transaction: async (work: (value: unknown) => unknown) => work(transaction),
      } as never;

      const batch = await readCanonicalEventBatch(
        { practiceId: "practice-1", userId: "user-1" },
        "queue-1",
        "tab-1",
        BigInt(0),
        database,
      );
      return { batch, queries };
    }

    const one = await run(1);
    const full = await run(100);
    expect(full.queries).toBe(one.queries);
    expect(full.batch.items).toHaveLength(100);
    expect(full.batch.scannedThrough).toBe(BigInt(100));
  });
});
