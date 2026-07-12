import { describe, expect, it } from "bun:test";

import type { PrismaClient } from "@/generated/prisma/client";
import type { ProviderWebhookRecord } from "@/lib/call-center/infrastructure/provider-webhook-inbox";
import {
  resolveTelnyxEventOwner,
  telnyxEventOwnerLockKey,
  TelnyxEventOwnerError,
  type TelnyxEventOwner,
} from "@/lib/call-center/infrastructure/telnyx-event-owner";

const occurredAt = new Date("2026-07-12T12:00:00.000Z");
const activation = (enabled: boolean) => () => ({ enabled });

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
  direction?: "incoming" | "outgoing";
  effectOwner?: TelnyxEventOwner | null;
  eventId?: string;
  eventType?: string;
  from?: string;
  payloadClientState?: string;
  to?: string;
} = {}): ProviderWebhookRecord {
  const body = {
    data: {
      event_type: eventType,
      id: eventId,
      occurred_at: occurredAt.toISOString(),
      payload: {
        ...(callControlId ? { call_control_id: callControlId } : {}),
        ...(callLegId ? { call_leg_id: callLegId } : {}),
        ...(callSessionId ? { call_session_id: callSessionId } : {}),
        ...(clientState
          ? {
              client_state: Buffer.from(JSON.stringify(clientState)).toString("base64"),
            }
          : payloadClientState
            ? { client_state: payloadClientState }
            : {}),
        direction,
        from,
        to,
      },
    },
  };
  return {
    attemptCount: 1,
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
  effectOwner: TelnyxEventOwner;
  id: string;
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

type TestDatabaseOptions = {
  calls?: PersistedCall[];
  eventOwners?: TelnyxEventOwner[];
  legs?: PersistedLeg[];
  number?: {
    id: string;
    inboundQueueId: string | null;
    practiceId: string;
    practicePhoneNumberId: string;
  } | null;
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
    routingMode: "ACTIVE" | "LEGACY" | "SHADOW";
  } | null;
};

function database({
  calls = [],
  eventOwners = [],
  legs = [],
  number = {
    id: "number-1",
    inboundQueueId: "queue-1",
    practiceId: "practice-1",
    practicePhoneNumberId: "phone-1",
  },
  outboundMapping = null,
  queue = {
    enabled: true,
    id: "queue-1",
    practiceId: "practice-1",
    routingMode: "ACTIVE",
  },
}: TestDatabaseOptions = {}) {
  const assigned: TelnyxEventOwner[] = [];
  const created: Array<Record<string, unknown>> = [];
  const queries: string[] = [];
  let configuredNumber = number;
  const queryText = (query: unknown) =>
    Array.isArray((query as { strings?: string[] })?.strings)
      ? ((query as { strings: string[] }).strings ?? []).join(" ")
      : "";
  const transaction = {
    $queryRaw: async (query: unknown) => {
      const sql = queryText(query);
      queries.push(sql);
      if (sql.includes("call_center_call_leg")) return [{ id: legs[0]?.id }];
      if (sql.includes('FROM "practice"')) {
        return [{ id: configuredNumber?.practiceId }];
      }
      if (sql.includes('FROM "call_center_queue"')) return queue ? [queue] : [];
      if (sql.includes('FROM "call_center_number"')) {
        return configuredNumber
          ? [
              {
                ...configuredNumber,
                enabled: true,
                inboundEnabled: true,
                phoneNumber: "+17864657479",
              },
            ]
          : [];
      }
      return [];
    },
    callCenterCall: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
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
    callCenterNumber: {
      findMany: async () => (configuredNumber ? [configuredNumber] : []),
    },
    providerWebhookEvent: {
      findMany: async () => eventOwners.map((effectOwner) => ({ effectOwner })),
      updateMany: async ({ data }: { data: { effectOwner: TelnyxEventOwner } }) => {
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
    queries,
    prisma: {
      $transaction: async (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    } as unknown as Pick<PrismaClient, "$transaction">,
    setNumber(value: TestDatabaseOptions["number"]) {
      configuredNumber = value ?? null;
    },
  };
}

describe("Telnyx event effect owner", () => {
  it("uses PostgreSQL-safe advisory lock keys", () => {
    expect(telnyxEventOwnerLockKey("event-1", "session-1")).toBe(
      "TELNYX_SESSION:session-1",
    );
    expect(telnyxEventOwnerLockKey("event-1", null)).toBe("TELNYX_EVENT:event-1");
    expect(telnyxEventOwnerLockKey("event-1", "session-1")).not.toContain("\u0000");
  });

  it("records ACTIVE call and event ownership before canonical projection", async () => {
    const db = database();
    await expect(
      resolveTelnyxEventOwner(event(), db.prisma, activation(true)),
    ).resolves.toBe("CANONICAL");

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
      resolveTelnyxEventOwner(
        event({ eventId: "event-after-rollback" }),
        db.prisma,
        activation(false),
      ),
    ).resolves.toBe("CANONICAL");
    expect(db.created).toHaveLength(1);
  });

  it("freezes LEGACY and SHADOW ownership for configured inbound calls", async () => {
    for (const routingMode of ["LEGACY", "SHADOW"] as const) {
      const db = database({
        queue: {
          enabled: true,
          id: "queue-1",
          practiceId: "practice-1",
          routingMode,
        },
      });
      await expect(resolveTelnyxEventOwner(event(), db.prisma)).resolves.toBe("LEGACY");
      expect(db.created[0]).toMatchObject({ effectOwner: "LEGACY" });
      expect(db.assigned).toEqual(["LEGACY"]);
    }
  });

  it("globally activates every configured queue without a per-queue exception", async () => {
    const legacyQueue = database({
      queue: {
        enabled: true,
        id: "queue-1",
        practiceId: "practice-1",
        routingMode: "LEGACY",
      },
    });
    await expect(
      resolveTelnyxEventOwner(event(), legacyQueue.prisma, activation(true)),
    ).resolves.toBe("CANONICAL");

    const shadowQueue = database({
      queue: {
        enabled: true,
        id: "queue-1",
        practiceId: "practice-1",
        routingMode: "SHADOW",
      },
    });
    await expect(
      resolveTelnyxEventOwner(event(), shadowQueue.prisma, activation(true)),
    ).resolves.toBe("CANONICAL");
  });

  it("persists unconfigured ingress as LEGACY across a later activation", async () => {
    const db = database({ number: null });
    await expect(
      resolveTelnyxEventOwner(event(), db.prisma, activation(false)),
    ).resolves.toBe("LEGACY");
    db.setNumber({
      id: "number-1",
      inboundQueueId: "queue-1",
      practiceId: "practice-1",
      practicePhoneNumberId: "phone-1",
    });
    await expect(
      resolveTelnyxEventOwner(event({ eventId: "event-2" }), db.prisma, activation(true)),
    ).resolves.toBe("LEGACY");
    expect(db.created).toHaveLength(0);
    expect(db.assigned).toEqual(["LEGACY", "LEGACY"]);
  });

  it("uses immutable call ownership for session-only voicemail", async () => {
    const call = {
      effectOwner: "CANONICAL" as const,
      id: "call-1",
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

  it("resolves opaque outbound state and rejects tamper or provider replay", async () => {
    const call = {
      effectOwner: "CANONICAL" as const,
      id: "outbound-call",
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
    const db = database({
      legs: [leg],
      number: null,
      outboundMapping: {
        callId: call.id,
        legId: leg.id,
        practiceId: "practice-1",
        token: "trusted-token",
      },
    });
    const trustedState = {
      callId: "tampered-call-is-ignored",
      canonicalOutboundToken: "trusted-token",
      legId: "tampered-leg-is-ignored",
      practiceId: "practice-1",
    };
    await expect(
      resolveTelnyxEventOwner(
        event({
          callSessionId: "outbound-session",
          clientState: trustedState,
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
          clientState: trustedState,
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

  it("admits an ACTIVE callback canonically before initiated projection", async () => {
    const db = database();
    await expect(
      resolveTelnyxEventOwner(
        event({ eventType: "call.answered" }),
        db.prisma,
        activation(true),
      ),
    ).resolves.toBe("CANONICAL");
    expect(db.created).toHaveLength(1);
  });

  it("fails closed when canonical, provider, and stored owners disagree", async () => {
    const call = {
      effectOwner: "LEGACY" as const,
      id: "legacy-call",
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

  it("treats malformed opaque client state as absent for legacy compatibility", async () => {
    const db = database({ number: null });
    await expect(
      resolveTelnyxEventOwner(event({ payloadClientState: "not-base64" }), db.prisma),
    ).resolves.toBe("LEGACY");
    expect(db.assigned).toEqual(["LEGACY"]);
  });
});
