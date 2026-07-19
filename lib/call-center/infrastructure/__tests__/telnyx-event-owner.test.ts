import { describe, expect, it } from "bun:test";

import type { PrismaClient } from "@/generated/prisma/client";
import type { ProviderWebhookRecord } from "@/lib/call-center/infrastructure/provider-webhook-inbox";
import {
  resolveTelnyxEventOwner,
  telnyxEventOwnerLockKey,
  TelnyxEventOwnerError,
  type TelnyxEventOwner,
} from "@/lib/call-center/infrastructure/telnyx-event-owner";
import {
  directHandoffToken,
  directHandoffTokenHash,
} from "@/lib/call-center/infrastructure/direct-handoff-token";
import {
  directHandoffSipUri,
  redactDirectHandoffToken,
} from "@/lib/call-center/infrastructure/direct-handoff-uri";

const occurredAt = new Date("2026-07-12T12:00:00.000Z");
type StoredEffectOwner = TelnyxEventOwner | "LEGACY";

function event({
  callControlId = "control-1",
  callLegId = "provider-leg-1",
  callSessionId = "provider-session-1",
  clientState,
  direction = "incoming",
  effectOwner = null,
  eventId = "event-1",
  eventType = "call.initiated",
  from = "+17865550100",
  payloadClientState,
  to = "+17864657479",
}: {
  callControlId?: string | null;
  callLegId?: string | null;
  callSessionId?: string | null;
  clientState?: Record<string, unknown>;
  direction?: "incoming" | "outgoing" | null;
  effectOwner?: StoredEffectOwner | null;
  eventId?: string;
  eventType?: string;
  from?: string;
  payloadClientState?: string;
  to?: string;
} = {}): ProviderWebhookRecord {
  const sanitized = redactDirectHandoffToken({
    ...(callControlId ? { call_control_id: callControlId } : {}),
    ...(callLegId ? { call_leg_id: callLegId } : {}),
    ...(callSessionId ? { call_session_id: callSessionId } : {}),
    ...(clientState
      ? { client_state: Buffer.from(JSON.stringify(clientState)).toString("base64") }
      : payloadClientState
        ? { client_state: payloadClientState }
        : {}),
    ...(direction ? { direction } : {}),
    from,
    to,
  });
  const body = {
    data: {
      event_type: eventType,
      id: eventId,
      occurred_at: occurredAt.toISOString(),
      payload: sanitized.payload,
    },
  };
  return {
    attemptCount: 1,
    directHandoffTokenHash: sanitized.tokenHash,
    effectOwner,
    errorCode: null,
    eventType,
    id: `inbox-${eventId}`,
    nextAttemptAt: null,
    payload: body,
    processedAt: null,
    processingStatus: "PROCESSING",
    providerCallSessionId: callSessionId,
    providerEventId: eventId,
    updatedAt: occurredAt,
  };
}

type PersistedCall = {
  effectOwner: StoredEffectOwner;
  id: string;
  practiceId: string;
  providerCallSessionId: string | null;
};

type PersistedLeg = {
  call: PersistedCall;
  id: string;
  kind: "AGENT" | "CUSTOMER";
  providerCallControlId: string | null;
  providerCallLegId: string | null;
  providerCallSessionId: string | null;
};

type TestHandoff = {
  callId: string | null;
  callerPhone: string;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  number: {
    enabled: boolean;
    inboundEnabled: boolean;
    inboundQueueId: string | null;
    practiceId: string;
    practicePhoneNumber: { phoneNumber: string; practiceId: string };
    practicePhoneNumberId: string;
  };
  numberId: string;
  practiceId: string;
  providerCallSessionId: string | null;
  queue: { enabled: boolean; practiceId: string };
  queueId: string;
  status: "CONNECTED" | "FAILED" | "INGRESS_SEEN" | "ISSUED";
  tokenHash: string;
};

function strippedHandoff(overrides: Partial<TestHandoff> = {}): TestHandoff {
  return {
    callId: null,
    callerPhone: "+17865550100",
    createdAt: new Date("2026-07-12T11:59:30.000Z"),
    expiresAt: new Date("2026-07-12T12:01:00.000Z"),
    id: "handoff-1",
    number: {
      enabled: false,
      inboundEnabled: false,
      inboundQueueId: "queue-1",
      practiceId: "practice-1",
      practicePhoneNumber: {
        phoneNumber: "+17864657479",
        practiceId: "practice-1",
      },
      practicePhoneNumberId: "phone-1",
    },
    numberId: "number-1",
    practiceId: "practice-1",
    providerCallSessionId: null,
    queue: { enabled: false, practiceId: "practice-1" },
    queueId: "queue-1",
    status: "ISSUED",
    tokenHash: "token-hash-1",
    ...overrides,
  };
}

type TestDatabaseOptions = {
  assignmentCount?: number;
  calls?: PersistedCall[];
  eventOwners?: StoredEffectOwner[];
  handoff?: TestHandoff | null;
  handoffCandidates?: TestHandoff[];
  legs?: PersistedLeg[];
  lockedNumber?: {
    enabled: boolean;
    id: string;
    inboundEnabled: boolean;
    inboundQueueId: string | null;
    phoneNumber: string;
    practiceId: string;
    practicePhoneNumberId: string;
  } | null;
  number?: {
    id: string;
    inboundQueueId: string | null;
    practiceId: string;
    practicePhoneNumberId: string;
  } | null;
  outOfScopeSessions?: string[];
  outboundMapping?: {
    callId: string;
    legId: string;
    practiceId: string;
    token: string;
  } | null;
  queue?: {
    enabled: boolean;
    id: string;
    practiceId: string;
  } | null;
  rejectedSessions?: string[];
};

function database({
  assignmentCount = 1,
  calls = [],
  eventOwners = [],
  handoff = null,
  handoffCandidates,
  legs = [],
  lockedNumber,
  number = {
    id: "number-1",
    inboundQueueId: "queue-1",
    practiceId: "practice-1",
    practicePhoneNumberId: "phone-1",
  },
  outOfScopeSessions = [],
  outboundMapping = null,
  queue = {
    enabled: true,
    id: "queue-1",
    practiceId: "practice-1",
  },
  rejectedSessions = [],
}: TestDatabaseOptions = {}) {
  const assigned: TelnyxEventOwner[] = [];
  const created: Array<Record<string, unknown>> = [];
  const operations: string[] = [];
  const queries: string[] = [];
  const configuredNumber = number;
  const reloadedNumber =
    lockedNumber === undefined
      ? configuredNumber
        ? {
            ...configuredNumber,
            enabled: true,
            inboundEnabled: true,
            phoneNumber: "+17864657479",
          }
        : null
      : lockedNumber;
  const handoffs = handoffCandidates ?? (handoff ? [handoff] : []);
  const queryText = (query: unknown) =>
    Array.isArray((query as { strings?: string[] })?.strings)
      ? ((query as { strings: string[] }).strings ?? []).join(" ")
      : "";
  const transaction = {
    $queryRaw: async (query: unknown) => {
      const sql = queryText(query);
      const values = (query as { values?: unknown[] })?.values ?? [];
      queries.push(sql);
      if (values.some((value) => String(value).startsWith("TELNYX_SESSION:"))) {
        operations.push("provider-session.lock");
      } else if (values.some((value) => String(value).startsWith("CALL_CENTER:"))) {
        operations.push("practice.lock");
      } else if (sql.includes('FROM "practice"')) {
        operations.push("practice.row-lock");
      } else if (sql.includes('FROM "call_center_call_leg"')) {
        operations.push("call-leg.row-lock");
      } else if (sql.includes('FROM "call_center_handoff"')) {
        operations.push("handoff.row-lock");
      } else if (sql.includes('FROM "practice_phone_number"')) {
        operations.push("practice-number.row-lock");
      } else if (sql.includes('FROM "call_center_queue"')) {
        operations.push("queue.row-lock");
      } else if (sql.includes('FROM "call_center_number"')) {
        operations.push("number.row-lock");
      }
      if (sql.includes("call_center_call_leg")) return [{ id: legs[0]?.id }];
      if (sql.includes("call_center_handoff")) return handoff ? [{ id: handoff.id }] : [];
      if (sql.includes('FROM "practice"')) {
        return [{ id: configuredNumber?.practiceId }];
      }
      if (sql.includes('FROM "call_center_queue"')) return queue ? [queue] : [];
      if (sql.includes('FROM "call_center_number"')) {
        return reloadedNumber ? [reloadedNumber] : [];
      }
      return [];
    },
    callCenterCall: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        operations.push("call-and-customer-leg.create");
        created.push(data);
        return { id: "created-call" };
      },
      findUnique: async ({ where }: { where: { providerCallSessionId: string } }) =>
        calls.find(
          (call) => call.providerCallSessionId === where.providerCallSessionId,
        ) ?? null,
    },
    callCenterCallLeg: {
      findMany: async () => legs,
      findUnique: async ({ where }: { where: { id: string } }) =>
        legs.find((leg) => leg.id === where.id) ?? null,
      update: async ({
        data,
        where,
      }: {
        data: Partial<PersistedLeg>;
        where: { id: string };
      }) => {
        const leg = legs.find((candidate) => candidate.id === where.id);
        if (!leg) throw new Error("missing test leg");
        Object.assign(leg, data);
        return leg;
      },
    },
    callCenterEvent: {
      findUnique: async ({
        where,
      }: {
        where: {
          practiceId_type_idempotencyKey: {
            idempotencyKey: string;
            practiceId: string;
            type: string;
          };
        };
      }) => {
        const key = where.practiceId_type_idempotencyKey;
        return outboundMapping &&
          key.practiceId === outboundMapping.practiceId &&
          key.type === "CALL_OUTBOUND_CREATED" &&
          key.idempotencyKey === `outbound-client-state:${outboundMapping.token}`
          ? {
              aggregateId: outboundMapping.callId,
              aggregateType: "CALL",
              data: { legId: outboundMapping.legId },
            }
          : null;
      },
    },
    callCenterHandoff: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const expiresAt = where.expiresAt as { gt: Date };
        const createdAt = where.createdAt as { lte: Date };
        const status = where.status as { in: TestHandoff["status"][] };
        return handoffs
          .filter(
            (candidate) =>
              candidate.callerPhone === where.callerPhone &&
              candidate.number.practicePhoneNumber.phoneNumber === "+17864657479" &&
              candidate.createdAt <= createdAt.lte &&
              candidate.expiresAt > expiresAt.gt &&
              status.in.includes(candidate.status),
          )
          .slice(0, 2)
          .map(({ id, practiceId }) => ({ id, practiceId }));
      },
      findUnique: async ({ where }: { where: { id?: string; tokenHash?: string } }) =>
        handoffs.find(
          (candidate) =>
            (where.id && candidate.id === where.id) ||
            (where.tokenHash && candidate.tokenHash === where.tokenHash),
        ) ?? null,
      update: async ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where: { id: string };
      }) => {
        const selected = handoffs.find((candidate) => candidate.id === where.id);
        if (!selected) throw new Error("missing test handoff");
        Object.assign(selected, data);
        return selected;
      },
    },
    callCenterNumber: {
      findMany: async () => (configuredNumber ? [configuredNumber] : []),
    },
    providerWebhookEvent: {
      findFirst: async ({ where }: { where: { providerCallSessionId: string } }) =>
        outOfScopeSessions.includes(where.providerCallSessionId)
          ? { errorCode: "TELNYX_EVENT_OUT_OF_SCOPE" }
          : rejectedSessions.includes(where.providerCallSessionId)
            ? { errorCode: "TELNYX_DIRECT_HANDOFF_TOKEN_INVALID" }
            : null,
      findMany: async () => eventOwners.map((effectOwner) => ({ effectOwner })),
      updateMany: async ({ data }: { data: { effectOwner: TelnyxEventOwner } }) => {
        if (assignmentCount !== 1) return { count: assignmentCount };
        operations.push("event-owner.assign");
        assigned.push(data.effectOwner);
        if (!eventOwners.includes(data.effectOwner)) eventOwners.push(data.effectOwner);
        return { count: 1 };
      },
    },
  };
  return {
    assigned,
    created,
    legs,
    operations,
    queries,
    prisma: {
      $transaction: async (operation: (tx: typeof transaction) => Promise<unknown>) => {
        const assignedCount = assigned.length;
        const createdCount = created.length;
        const owners = [...eventOwners];
        try {
          return await operation(transaction);
        } catch (error) {
          assigned.splice(assignedCount);
          created.splice(createdCount);
          eventOwners.splice(0, eventOwners.length, ...owners);
          throw error;
        }
      },
    } as unknown as Pick<PrismaClient, "$transaction">,
  };
}

const trustedOutboundState = {
  callId: "tampered-call-is-ignored",
  canonicalOutboundToken: "trusted-token",
  legId: "tampered-leg-is-ignored",
  practiceId: "practice-1",
};

function outboundDatabase() {
  const call = {
    effectOwner: "CANONICAL" as const,
    id: "outbound-call",
    practiceId: "practice-1",
    providerCallSessionId: null,
  };
  const leg: PersistedLeg = {
    call,
    id: "outbound-leg",
    kind: "AGENT",
    providerCallControlId: null,
    providerCallLegId: null,
    providerCallSessionId: null,
  };
  return database({
    legs: [leg],
    number: null,
    outboundMapping: {
      callId: call.id,
      legId: leg.id,
      practiceId: "practice-1",
      token: "trusted-token",
    },
  });
}

describe("Telnyx event effect owner", () => {
  it("uses PostgreSQL-safe advisory lock keys", () => {
    expect(telnyxEventOwnerLockKey("event-1", "session-1")).toBe(
      "TELNYX_SESSION:session-1",
    );
    expect(telnyxEventOwnerLockKey("event-1", null)).toBe("TELNYX_EVENT:event-1");
    expect(telnyxEventOwnerLockKey("event-1", "session-1")).not.toContain("\u0000");
  });

  it("records call and event ownership before canonical projection", async () => {
    const db = database();
    await expect(resolveTelnyxEventOwner(event(), db.prisma)).resolves.toBe("CANONICAL");

    expect(db.assigned).toEqual(["CANONICAL"]);
    expect(db.queries[0]).toContain("pg_advisory_xact_lock");
    expect(db.queries[0]).toContain('::text AS "lock"');
    expect(db.created[0]).toMatchObject({
      direction: "INBOUND",
      effectOwner: "CANONICAL",
      numberId: "number-1",
      practiceId: "practice-1",
      providerCallSessionId: "provider-session-1",
      queueId: "queue-1",
    });

    await expect(
      resolveTelnyxEventOwner(event({ eventId: "event-after-rollback" }), db.prisma),
    ).resolves.toBe("CANONICAL");
    expect(db.created).toHaveLength(1);
  });

  it("orders configured inbound admission under the shared practice lock", async () => {
    const db = database();

    await expect(resolveTelnyxEventOwner(event(), db.prisma)).resolves.toBe("CANONICAL");

    expect(db.operations).toEqual([
      "provider-session.lock",
      "practice.lock",
      "queue.row-lock",
      "number.row-lock",
      "call-and-customer-leg.create",
      "event-owner.assign",
    ]);
    expect(db.created[0]).toMatchObject({
      numberId: "number-1",
      practiceId: "practice-1",
      queueId: "queue-1",
    });
  });

  it("admits one signed direct handoff using its issued route snapshot", async () => {
    const secret = "handoff-secret";
    const token = directHandoffToken("handoff-1", secret);
    const handoff: TestHandoff = {
      callId: null,
      callerPhone: "+17865550100",
      createdAt: new Date("2026-07-12T11:59:30.000Z"),
      expiresAt: new Date("2026-07-12T12:01:00.000Z"),
      id: "handoff-1",
      number: {
        enabled: false,
        inboundEnabled: false,
        inboundQueueId: "queue-2",
        practiceId: "practice-1",
        practicePhoneNumber: {
          phoneNumber: "+19542872010",
          practiceId: "practice-1",
        },
        practicePhoneNumberId: "phone-1",
      },
      numberId: "number-1",
      practiceId: "practice-1",
      providerCallSessionId: null,
      queue: { enabled: false, practiceId: "practice-1" },
      queueId: "queue-1",
      status: "ISSUED",
      tokenHash: directHandoffTokenHash(token),
    };
    const db = database({ handoff, number: null });

    const owner = await resolveTelnyxEventOwner(
      event({
        to: directHandoffSipUri(
          "sip:acuity-handoff@abitacallcenter.sip.telnyx.com",
          token,
        ),
      }),
      db.prisma,
    );
    expect(owner).toBe("CANONICAL");

    expect(db.created[0]).toMatchObject({
      effectOwner: "CANONICAL",
      fromPhone: "+17865550100",
      numberId: "number-1",
      queueId: "queue-1",
      toPhone: "+19542872010",
    });
    expect(handoff).toMatchObject({
      callId: "created-call",
      providerCallSessionId: "provider-session-1",
      status: "INGRESS_SEEN",
    });

    const replayDb = database({ handoff, number: null });
    await expect(
      resolveTelnyxEventOwner(
        event({
          callControlId: "control-2",
          callLegId: "provider-leg-2",
          callSessionId: "provider-session-2",
          eventId: "duplicate-provider-session",
          to: directHandoffSipUri(
            "sip:acuity-handoff@abitacallcenter.sip.telnyx.com",
            token,
          ),
        }),
        replayDb.prisma,
      ),
    ).rejects.toMatchObject({
      code: "TELNYX_DIRECT_HANDOFF_NOT_TRANSFERABLE",
    });
    expect(db.created).toHaveLength(1);
    expect(replayDb.created).toHaveLength(0);
  });

  it("orders direct handoff admission under the shared practice lock", async () => {
    const token = directHandoffToken("handoff-1", "handoff-secret");
    const handoff = strippedHandoff({ tokenHash: directHandoffTokenHash(token) });
    const db = database({ handoff, number: null });

    await expect(
      resolveTelnyxEventOwner(
        event({
          to: directHandoffSipUri(
            "sip:acuity-handoff@abitacallcenter.sip.telnyx.com",
            token,
          ),
        }),
        db.prisma,
      ),
    ).resolves.toBe("CANONICAL");

    expect(db.operations).toEqual([
      "provider-session.lock",
      "practice.lock",
      "handoff.row-lock",
      "practice-number.row-lock",
      "number.row-lock",
      "queue.row-lock",
      "call-and-customer-leg.create",
      "event-owner.assign",
    ]);
  });

  it("correlates the production Telnyx REFER shape without SIP markers", async () => {
    const handoff = strippedHandoff();
    const db = database({ handoff });

    await expect(resolveTelnyxEventOwner(event(), db.prisma)).resolves.toBe("CANONICAL");

    expect(db.created).toHaveLength(1);
    expect(db.created[0]).toMatchObject({
      effectOwner: "CANONICAL",
      fromPhone: "+17865550100",
      numberId: "number-1",
      providerCallSessionId: "provider-session-1",
      queueId: "queue-1",
      toPhone: "+17864657479",
    });
    expect(handoff).toMatchObject({
      callId: "created-call",
      providerCallSessionId: "provider-session-1",
      status: "INGRESS_SEEN",
    });
  });

  it("fails closed when a stripped REFER could match two reservations", async () => {
    const base = strippedHandoff();
    const db = database({
      handoffCandidates: [
        base,
        {
          ...base,
          createdAt: new Date("2026-07-12T11:59:31.000Z"),
          id: "handoff-2",
          tokenHash: "token-hash-2",
        },
      ],
    });

    await expect(resolveTelnyxEventOwner(event(), db.prisma)).rejects.toMatchObject({
      code: "TELNYX_DIRECT_HANDOFF_CORRELATION_AMBIGUOUS",
    });
    expect(db.created).toHaveLength(0);
  });

  it("rejects a second provider session for a consumed stripped REFER", async () => {
    const consumed = strippedHandoff({
      callId: "created-call",
      providerCallSessionId: "first-provider-session",
      status: "CONNECTED",
    });
    const db = database({ handoff: consumed });

    await expect(resolveTelnyxEventOwner(event(), db.prisma)).rejects.toMatchObject({
      code: "TELNYX_DIRECT_HANDOFF_NOT_TRANSFERABLE",
    });
    expect(db.created).toHaveLength(0);
  });

  it("keeps every callback for a rejected direct session terminal", async () => {
    const db = database({ rejectedSessions: ["provider-session-1"] });

    await expect(resolveTelnyxEventOwner(event(), db.prisma)).rejects.toMatchObject({
      code: "TELNYX_DIRECT_HANDOFF_NOT_TRANSFERABLE",
    });
    expect(db.created).toHaveLength(0);
  });

  it("does not admit an unknown URI token through configured-number fallback", async () => {
    const db = database();
    await expect(
      resolveTelnyxEventOwner(
        event({
          to: directHandoffSipUri(
            "sip:acuity-handoff@abitacallcenter.sip.telnyx.com",
            "b".repeat(43),
          ),
        }),
        db.prisma,
      ),
    ).rejects.toMatchObject({ code: "TELNYX_DIRECT_HANDOFF_TOKEN_INVALID" });
    expect(db.created).toHaveLength(0);
  });

  it("canonically admits every configured queue", async () => {
    const db = database();
    await expect(resolveTelnyxEventOwner(event(), db.prisma)).resolves.toBe("CANONICAL");
  });

  it("keeps an unconfigured provider session out of canonical routing", async () => {
    const db = database({ number: null });
    await expect(resolveTelnyxEventOwner(event(), db.prisma)).rejects.toMatchObject({
      code: "TELNYX_EVENT_OUT_OF_SCOPE",
    });
    const afterConfiguration = database({
      outOfScopeSessions: ["provider-session-1"],
    });
    await expect(
      resolveTelnyxEventOwner(event({ eventId: "event-2" }), afterConfiguration.prisma),
    ).rejects.toMatchObject({ code: "TELNYX_EVENT_OUT_OF_SCOPE" });
    expect(db.created).toHaveLength(0);
    expect(db.assigned).toEqual([]);
  });

  it("keeps reordered callbacks sticky to their admitted provider session", async () => {
    const db = database({ eventOwners: ["CANONICAL"], number: null });

    await expect(
      resolveTelnyxEventOwner(event({ eventType: "call.answered" }), db.prisma),
    ).resolves.toBe("CANONICAL");

    expect(db.created).toEqual([]);
    expect(db.assigned).toEqual(["CANONICAL"]);
  });

  it("aborts admission when the configured number changes after practice locking", async () => {
    const db = database({
      lockedNumber: {
        enabled: true,
        id: "number-1",
        inboundEnabled: true,
        inboundQueueId: "queue-2",
        phoneNumber: "+17864657479",
        practiceId: "practice-1",
        practicePhoneNumberId: "phone-1",
      },
    });

    await expect(resolveTelnyxEventOwner(event(), db.prisma)).rejects.toMatchObject({
      code: "TELNYX_EVENT_NUMBER_CHANGED",
    });
    expect(db.created).toEqual([]);
    expect(db.assigned).toEqual([]);
  });

  it("rolls back the Call, customer leg, and event owner when admission fails", async () => {
    const db = database({ assignmentCount: 0 });

    await expect(resolveTelnyxEventOwner(event(), db.prisma)).rejects.toMatchObject({
      code: "TELNYX_EVENT_OWNER_ASSIGNMENT_LOST",
    });
    expect(db.created).toEqual([]);
    expect(db.assigned).toEqual([]);
  });

  it("uses immutable call ownership for session-only voicemail", async () => {
    const call = {
      effectOwner: "CANONICAL" as const,
      id: "call-1",
      practiceId: "practice-1",
      providerCallSessionId: "provider-session-1",
    };
    const db = database({ calls: [call], number: null });
    await expect(
      resolveTelnyxEventOwner(
        event({
          callControlId: null,
          callLegId: null,
          eventType: "calls.voicemail.completed",
        }),
        db.prisma,
      ),
    ).resolves.toBe("CANONICAL");
  });

  it("atomically binds the first canonical agent callback identities", async () => {
    const call = {
      effectOwner: "CANONICAL" as const,
      id: "call-1",
      practiceId: "practice-1",
      providerCallSessionId: "customer-session",
    };
    const leg: PersistedLeg = {
      call,
      id: "agent-leg-1",
      kind: "AGENT",
      providerCallControlId: null,
      providerCallLegId: null,
      providerCallSessionId: null,
    };
    const db = database({ legs: [leg], number: null });
    const first = event({
      callSessionId: "agent-session",
      clientState: { callId: "call-1", legId: "agent-leg-1" },
      eventType: "call.initiated",
    });
    await expect(resolveTelnyxEventOwner(first, db.prisma)).resolves.toBe("CANONICAL");
    expect(db.operations).toEqual([
      "provider-session.lock",
      "practice.lock",
      "call-leg.row-lock",
      "event-owner.assign",
    ]);
    expect(db.legs[0]).toMatchObject({
      providerCallControlId: "control-1",
      providerCallLegId: "provider-leg-1",
      providerCallSessionId: "agent-session",
    });

    await expect(
      resolveTelnyxEventOwner(
        event({
          callSessionId: "agent-session",
          eventId: "event-2",
          eventType: "call.answered",
        }),
        db.prisma,
      ),
    ).resolves.toBe("CANONICAL");
  });

  it("resolves a persisted outbound token when direction is absent", async () => {
    const db = outboundDatabase();

    await expect(
      resolveTelnyxEventOwner(
        event({
          callSessionId: "outbound-session",
          clientState: trustedOutboundState,
          direction: null,
        }),
        db.prisma,
      ),
    ).resolves.toBe("CANONICAL");
    expect(db.legs[0]).toMatchObject({
      id: "outbound-leg",
      providerCallControlId: "control-1",
      providerCallLegId: "provider-leg-1",
      providerCallSessionId: "outbound-session",
    });
  });

  it("rejects a persisted outbound token with explicit inbound direction", async () => {
    const db = outboundDatabase();

    await expect(
      resolveTelnyxEventOwner(
        event({ clientState: trustedOutboundState, direction: "incoming" }),
        db.prisma,
      ),
    ).rejects.toThrow("TELNYX_EVENT_OUTBOUND_TOKEN_INVALID");
    expect(db.legs[0]?.providerCallControlId).toBeNull();
  });

  it("resolves opaque outbound state and rejects tamper or provider replay", async () => {
    const db = outboundDatabase();

    await expect(
      resolveTelnyxEventOwner(
        event({
          callSessionId: "outbound-session",
          clientState: trustedOutboundState,
          direction: "outgoing",
        }),
        db.prisma,
      ),
    ).resolves.toBe("CANONICAL");
    expect(db.legs[0]).toMatchObject({
      id: "outbound-leg",
      providerCallControlId: "control-1",
      providerCallLegId: "provider-leg-1",
      providerCallSessionId: "outbound-session",
    });

    await expect(
      resolveTelnyxEventOwner(
        event({
          callSessionId: "replayed-session",
          clientState: trustedOutboundState,
          direction: "outgoing",
          eventId: "replay",
        }),
        db.prisma,
      ),
    ).rejects.toThrow("TELNYX_EVENT_IDENTITY_MISMATCH");
    await expect(
      resolveTelnyxEventOwner(
        event({
          clientState: {
            canonicalOutboundToken: "forged-token",
            practiceId: "practice-1",
          },
          direction: "outgoing",
          eventId: "forged",
        }),
        db.prisma,
      ),
    ).rejects.toThrow("TELNYX_EVENT_OUTBOUND_TOKEN_NOT_FOUND");
  });

  it("admits a canonical callback before initiated projection", async () => {
    const db = database();
    await expect(
      resolveTelnyxEventOwner(event({ eventType: "call.answered" }), db.prisma),
    ).resolves.toBe("CANONICAL");
    expect(db.created).toHaveLength(1);
  });

  it("fails closed when canonical, provider, and stored owners disagree", async () => {
    const call = {
      effectOwner: "LEGACY" as const,
      id: "legacy-call",
      practiceId: "practice-1",
      providerCallSessionId: "provider-session-1",
    };
    const db = database({
      eventOwners: ["CANONICAL"],
      legs: [
        {
          call,
          id: "legacy-leg",
          kind: "CUSTOMER",
          providerCallControlId: "control-1",
          providerCallLegId: "provider-leg-1",
          providerCallSessionId: "provider-session-1",
        },
      ],
    });
    await expect(
      resolveTelnyxEventOwner(
        event({ clientState: { callId: "call-1", legId: "leg-1" } }),
        db.prisma,
      ),
    ).rejects.toBeInstanceOf(TelnyxEventOwnerError);
  });

  it("treats malformed opaque client state as absent", async () => {
    const db = database({ number: null });
    await expect(
      resolveTelnyxEventOwner(event({ payloadClientState: "not-base64" }), db.prisma),
    ).rejects.toMatchObject({ code: "TELNYX_EVENT_OUT_OF_SCOPE" });
    expect(db.assigned).toEqual([]);
  });
});
