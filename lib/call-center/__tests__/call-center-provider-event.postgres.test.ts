import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { PrismaClient } from "@/generated/prisma/client";
import { createProviderWebhookDrainer } from "@/lib/call-center/application/drain-provider-webhooks";
import { createTelnyxVoiceEventProcessor } from "@/lib/call-center/application/process-telnyx-voice-event";
import { callCenter } from "@/lib/call-center/call-center";
import { createPrismaCanonicalCallProjector } from "@/lib/call-center/infrastructure/prisma-canonical-call-projector";
import { admitTelnyxEvent } from "@/lib/call-center/infrastructure/prisma-telnyx-event-admission";
import {
  providerWebhookInbox,
  type ProviderWebhookRecord,
} from "@/lib/call-center/infrastructure/provider-webhook-inbox";
import type { TelnyxVoiceWebhookEnvelope } from "@/lib/call-center/infrastructure/telnyx-voice-envelope";

const postgresUrl = process.env.CALL_CENTER_POSTGRES_TEST_URL ?? "";
const describePostgres = postgresUrl ? describe : describe.skip;

function phoneNumbers(key: string) {
  const digits = String(Number.parseInt(key.slice(0, 8), 16)).padStart(10, "0");
  return {
    callerPhone: `+1${digits.slice(0, 9)}1`,
    practicePhone: `+1${digits.slice(0, 9)}2`,
  };
}

function envelope({
  eventType,
  key,
  occurredAt = new Date("2026-07-19T12:00:00.000Z"),
  payload = {},
  providerEventId,
  providerSessionId,
}: {
  eventType: string;
  key: string;
  occurredAt?: Date;
  payload?: Record<string, unknown>;
  providerEventId: string;
  providerSessionId: string;
}): TelnyxVoiceWebhookEnvelope {
  const { callerPhone, practicePhone } = phoneNumbers(key);
  const body = {
    data: {
      event_type: eventType,
      id: providerEventId,
      occurred_at: occurredAt.toISOString(),
      payload: {
        call_control_id: `control-${key}`,
        call_leg_id: `leg-${key}`,
        call_session_id: providerSessionId,
        direction: "incoming",
        from: callerPhone,
        to: practicePhone,
        ...payload,
      },
    },
  };
  return { body, eventType, occurredAt, providerEventId };
}

describePostgres("server Call Center provider-event lifecycle on PostgreSQL", () => {
  let adminPrisma: PrismaClient;

  beforeAll(() => {
    adminPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgresUrl }),
    });
  });

  afterAll(async () => {
    await adminPrisma.$disconnect();
  });

  async function fixture() {
    const key = randomUUID().replaceAll("-", "");
    const practiceId = `practice-${key}`;
    const locationId = `location-${key}`;
    const phoneId = `phone-${key}`;
    const numberId = `number-${key}`;
    const queueId = `queue-${key}`;
    const { practicePhone } = phoneNumbers(key);

    await adminPrisma.practice.create({
      data: { id: practiceId, name: `Provider event ${key}` },
    });
    await adminPrisma.practiceLocation.create({
      data: { id: locationId, name: "Provider event location", practiceId },
    });
    await adminPrisma.practicePhoneNumber.create({
      data: { id: phoneId, locationId, phoneNumber: practicePhone, practiceId },
    });
    await adminPrisma.callCenterQueue.create({
      data: { id: queueId, name: "Provider event queue", practiceId },
    });
    await adminPrisma.callCenterQueueLocation.create({
      data: { locationId, queueId },
    });
    await adminPrisma.callCenterNumber.create({
      data: {
        enabled: true,
        id: numberId,
        inboundEnabled: true,
        inboundQueueId: queueId,
        practiceId,
        practicePhoneNumberId: phoneId,
      },
    });

    return {
      async cleanup() {
        await adminPrisma.providerWebhookEvent.deleteMany({
          where: { providerEventId: { startsWith: `provider-${key}-` } },
        });
        await adminPrisma.practice.deleteMany({ where: { id: practiceId } });
      },
      key,
      locationId,
      numberId,
      practiceId,
      queueId,
    };
  }

  async function transferFixture(
    current: Awaited<ReturnType<typeof fixture>>,
    occurredAt: Date,
  ) {
    const providerSessionId = `session-${current.key}`;
    const callId = `call-${current.key}`;
    const customerLegId = `customer-${current.key}`;
    const sourceLegId = `source-${current.key}`;
    const targetLegId = `target-${current.key}`;
    const targetEndpointId = `endpoint-${current.key}`;
    const transferCommandId = `transfer-${current.key}`;
    const customerControlId = `customer-control-${current.key}`;
    const customerProviderLegId = `customer-provider-leg-${current.key}`;
    const sourceControlId = `source-control-${current.key}`;
    const sourceProviderLegId = `source-provider-leg-${current.key}`;
    const targetControlId = `target-control-${current.key}`;
    const targetProviderLegId = `target-provider-leg-${current.key}`;
    const { callerPhone, practicePhone } = phoneNumbers(current.key);
    const encode = (value: Record<string, unknown>) =>
      Buffer.from(JSON.stringify(value)).toString("base64");

    await adminPrisma.callCenterEndpoint.create({
      data: {
        id: targetEndpointId,
        label: "Transfer target",
        locationId: current.locationId,
        practiceId: current.practiceId,
        providerCredentialId: `credential-${current.key}`,
        sipUsername: `transfer-${current.key}`,
      },
    });
    await adminPrisma.callCenterCall.create({
      data: {
        answeredAt: occurredAt,
        direction: "OUTBOUND",
        fromPhone: practicePhone,
        id: callId,
        numberId: current.numberId,
        practiceId: current.practiceId,
        queueId: current.queueId,
        receivedAt: occurredAt,
        status: "CONNECTED",
        toPhone: callerPhone,
      },
    });
    await adminPrisma.callCenterCallLeg.createMany({
      data: [
        {
          answeredAt: occurredAt,
          bridgedAt: occurredAt,
          callId,
          id: customerLegId,
          kind: "CUSTOMER",
          providerCallControlId: customerControlId,
          providerCallLegId: customerProviderLegId,
          providerCallSessionId: providerSessionId,
          startedAt: occurredAt,
          status: "BRIDGED",
        },
        {
          answeredAt: occurredAt,
          bridgedAt: occurredAt,
          callId,
          id: sourceLegId,
          kind: "AGENT",
          providerCallControlId: sourceControlId,
          providerCallLegId: sourceProviderLegId,
          providerCallSessionId: providerSessionId,
          startedAt: occurredAt,
          status: "BRIDGED",
        },
        {
          callId,
          endpointId: targetEndpointId,
          id: targetLegId,
          kind: "AGENT",
          startedAt: occurredAt,
          status: "CREATED",
        },
      ],
    });
    await adminPrisma.callCenterCall.update({
      data: { winningLegId: sourceLegId },
      where: { id: callId },
    });
    await adminPrisma.callCenterCommand.create({
      data: {
        arguments: {
          agentSessionId: `agent-session-${current.key}`,
          endpointId: targetEndpointId,
          providerSourceLegId: customerLegId,
          sourceLegId,
        },
        attemptCount: 1,
        callId,
        createdAt: occurredAt,
        id: transferCommandId,
        idempotencyKey: `transfer-${current.key}`,
        legId: targetLegId,
        practiceId: current.practiceId,
        status: "SENT",
        type: "TRANSFER_AGENT",
        updatedAt: occurredAt,
      },
    });

    const targetState = encode({
      callId,
      canonicalCommand: true,
      commandId: transferCommandId,
      endpointId: targetEndpointId,
      internalAgentLeg: true,
      internalTransferTarget: true,
      legId: targetLegId,
    });
    const sourceState = encode({
      callId,
      internalAgentLeg: true,
      legId: sourceLegId,
    });
    const transferEvent = (
      eventType: string,
      providerEventId: string,
      payload: Record<string, unknown>,
      eventAt = occurredAt,
    ) =>
      envelope({
        eventType,
        key: current.key,
        occurredAt: eventAt,
        payload: { direction: "outgoing", ...payload },
        providerEventId,
        providerSessionId,
      });

    return {
      callId,
      customerLegId,
      providerSessionId,
      sourceControlId,
      sourceLegId,
      sourceProviderLegId,
      sourceState,
      targetControlId,
      targetEndpointId,
      targetLegId,
      targetProviderLegId,
      targetState,
      transferCommandId,
      transferEvent,
    };
  }

  it("persists one complete lifecycle and one projection for concurrent duplicates", async () => {
    const current = await fixture();
    const providerSessionId = `session-${current.key}`;
    const initiated = envelope({
      eventType: "call.initiated",
      key: current.key,
      providerEventId: `provider-${current.key}-initiated`,
      providerSessionId,
    });

    try {
      const deliveries = await Promise.allSettled([
        callCenter.applyProviderEvent(initiated),
        callCenter.applyProviderEvent(initiated),
      ]);
      expect(
        deliveries.some(
          (delivery) =>
            delivery.status === "fulfilled" && delivery.value.outcome === "PROCESSED",
        ),
      ).toBe(true);
      for (const delivery of deliveries) {
        if (delivery.status === "fulfilled") {
          expect(delivery.value.outcome).toBe("PROCESSED");
        } else {
          expect(delivery.reason).toMatchObject({ status: 503 });
        }
      }
      await expect(callCenter.applyProviderEvent(initiated)).resolves.toMatchObject({
        duplicate: true,
        outcome: "PROCESSED",
      });

      const call = await adminPrisma.callCenterCall.findFirstOrThrow({
        include: { commands: true, legs: true },
        where: { practiceId: current.practiceId },
      });
      expect(call.legs).toHaveLength(1);
      expect(call.commands.length).toBeGreaterThan(0);
      expect(
        await adminPrisma.callCenterEvent.count({
          where: {
            idempotencyKey: `telnyx:${initiated.providerEventId}`,
            practiceId: current.practiceId,
          },
        }),
      ).toBe(1);
      expect(
        await adminPrisma.providerWebhookEvent.findUniqueOrThrow({
          where: {
            provider_providerEventId: {
              provider: "TELNYX",
              providerEventId: initiated.providerEventId,
            },
          },
        }),
      ).toMatchObject({ attemptCount: 1, processingStatus: "PROCESSED" });

      const voicemail = envelope({
        eventType: "calls.voicemail.completed",
        key: current.key,
        payload: {
          call_control_id: undefined,
          call_leg_id: undefined,
          duration_secs: 12.4,
          recording_id: `recording-${current.key}`,
          recording_urls: {
            mp3: `https://example.test/${current.key}/voicemail.mp3`,
          },
        },
        providerEventId: `provider-${current.key}-voicemail`,
        providerSessionId,
      });
      await expect(callCenter.applyProviderEvent(voicemail)).resolves.toMatchObject({
        outcome: "PROCESSED",
      });
      expect(
        await adminPrisma.callCenterVoicemail.count({
          where: { callCenterCallId: call.id },
        }),
      ).toBe(1);
      expect(await adminPrisma.callCenterTask.count({ where: { callId: call.id } })).toBe(
        1,
      );
    } finally {
      await current.cleanup();
    }
  });

  it("leaves a same-session callback pending while live projection owns the lane", async () => {
    const current = await fixture();
    const providerSessionId = `session-${current.key}`;
    const releaseProjection = Promise.withResolvers<void>();
    const firstProjectionStarted = Promise.withResolvers<void>();
    const projector = createPrismaCanonicalCallProjector(adminPrisma);
    let firstProcessing: Promise<unknown> | null = null;
    let secondProcessing: Promise<unknown> | null = null;

    const first = envelope({
      eventType: "call.initiated",
      key: current.key,
      providerEventId: `provider-${current.key}-lane-first`,
      providerSessionId,
    });
    const second = envelope({
      eventType: "call.hangup",
      key: current.key,
      providerEventId: `provider-${current.key}-lane-second`,
      providerSessionId,
    });
    const processor = createTelnyxVoiceEventProcessor({
      admit: (event) => admitTelnyxEvent(event, adminPrisma),
      dispatchCommand: async (commandId) => ({ commandId, status: "SETTLED" }),
      inbox: providerWebhookInbox,
      projector: {
        projectAndComplete: async (...args) => {
          if (args[0].providerEventId === first.providerEventId) {
            firstProjectionStarted.resolve();
            await releaseProjection.promise;
          }
          return projector.projectAndComplete(...args);
        },
      },
    });

    try {
      firstProcessing = processor(first);
      await firstProjectionStarted.promise;

      secondProcessing = processor(second);
      await expect(secondProcessing).rejects.toMatchObject({ status: 503 });
      expect(
        await adminPrisma.providerWebhookEvent.findUniqueOrThrow({
          where: {
            provider_providerEventId: {
              provider: "TELNYX",
              providerEventId: second.providerEventId,
            },
          },
        }),
      ).toMatchObject({
        attemptCount: 0,
        processingStatus: "RECEIVED",
      });

      releaseProjection.resolve();
      await expect(firstProcessing).resolves.toMatchObject({ outcome: "PROCESSED" });
      secondProcessing = processor(second);
      await expect(secondProcessing).resolves.toMatchObject({
        outcome: "PROCESSED",
      });
    } finally {
      releaseProjection.resolve();
      await Promise.allSettled(
        [firstProcessing, secondProcessing].filter(
          (processing): processing is Promise<unknown> => processing !== null,
        ),
      );
      await current.cleanup();
    }
  });

  it("keeps snapshots, heartbeat, and Answer available during a 20-callback session burst", async () => {
    const current = await fixture();
    const id = (prefix: string) => `${prefix}-${current.key}`;
    const providerSessionId = id("burst-session");
    const userIds = Array.from({ length: 4 }, (_, index) => id(`burst-user-${index}`));
    const endpointIds = Array.from({ length: 4 }, (_, index) =>
      id(`burst-endpoint-${index}`),
    );
    const sessionIds = Array.from({ length: 4 }, (_, index) =>
      id(`burst-agent-session-${index}`),
    );
    const agentLegIds = Array.from({ length: 4 }, (_, index) =>
      id(`burst-agent-leg-${index}`),
    );
    const callId = id("burst-call");
    const now = new Date();
    const actors = userIds.map((userId) => ({
      allowedLocationIds: [current.locationId],
      hasAllLocationAccess: false,
      practiceId: current.practiceId,
      userId,
    }));
    const releaseProjection = Promise.withResolvers<void>();
    const firstProjectionStarted = Promise.withResolvers<void>();
    let activeProjectors = 0;
    let maxActiveProjectors = 0;
    const admitted: string[] = [];
    const bridgedLegIds = new Set<string>();
    const projectedStatuses: string[] = [];
    let firstProcessing: Promise<unknown> | null = null;
    const projector = createPrismaCanonicalCallProjector(adminPrisma);

    try {
      await adminPrisma.user.createMany({
        data: userIds.map((userId, index) => ({
          email: `${userId}@example.test`,
          id: userId,
          name: `Burst agent ${index}`,
        })),
      });
      await adminPrisma.practiceMembership.createMany({
        data: userIds.map((userId) => ({ practiceId: current.practiceId, userId })),
      });
      await adminPrisma.callCenterQueueMember.createMany({
        data: userIds.map((userId) => ({ queueId: current.queueId, userId })),
      });
      await adminPrisma.callCenterEndpoint.createMany({
        data: endpointIds.map((endpointId, index) => ({
          id: endpointId,
          label: `Burst endpoint ${index}`,
          locationId: current.locationId,
          practiceId: current.practiceId,
          providerCredentialId: id(`burst-credential-${index}`),
          sipUsername: id(`burst-sip-${index}`),
          userId: userIds[index]!,
        })),
      });
      await adminPrisma.callCenterAgentSession.createMany({
        data: sessionIds.map((sessionId, index) => ({
          audioReady: true,
          browserSessionId: id(`burst-browser-${index}`),
          connectionState: "READY",
          endpointId: endpointIds[index]!,
          id: sessionId,
          lastHeartbeatAt: now,
          leaseExpiresAt: new Date(now.getTime() + 60_000),
          microphoneReady: true,
          practiceId: current.practiceId,
          presence: "AVAILABLE",
          readyAt: now,
          userId: userIds[index]!,
        })),
      });
      await adminPrisma.callCenterCall.create({
        data: {
          direction: "INBOUND",
          fromPhone: "+17865550100",
          id: callId,
          numberId: current.numberId,
          practiceId: current.practiceId,
          queueId: current.queueId,
          receivedAt: now,
          status: "RINGING",
          toPhone: phoneNumbers(current.key).practicePhone,
        },
      });
      await adminPrisma.callCenterCallLeg.createMany({
        data: [
          {
            answeredAt: now,
            callId,
            id: id("burst-customer-leg"),
            kind: "CUSTOMER",
            status: "ANSWERED",
          },
          ...agentLegIds.map(
            (agentLegId, index) =>
              ({
                agentSessionId: sessionIds[index]!,
                callId,
                endpointId: endpointIds[index]!,
                id: agentLegId,
                kind: "AGENT",
                status: "RINGING",
              }) as const,
          ),
        ],
      });

      const eventTypes = [
        ...Array(4).fill("call.initiated"),
        ...Array(4).fill("call.answered"),
        ...Array(4).fill("call.bridged"),
        ...Array(4).fill("call.hangup"),
        ...Array(4).fill("call.initiated"),
      ] as const;
      const records: ProviderWebhookRecord[] = [];
      for (const [index, eventType] of eventTypes.entries()) {
        const agentIndex = index % agentLegIds.length;
        const receivedAt = new Date(now.getTime() + index);
        const clientState = Buffer.from(
          JSON.stringify({
            callId,
            endpointId: endpointIds[agentIndex],
            internalAgentLeg: true,
            legId: agentLegIds[agentIndex],
          }),
        ).toString("base64");
        const received = await providerWebhookInbox.receive(
          envelope({
            eventType,
            key: current.key,
            occurredAt: receivedAt,
            payload: {
              call_control_id: id(`burst-control-${agentIndex}`),
              call_leg_id: id(`burst-provider-leg-${agentIndex}`),
              client_state: clientState,
              direction: "outgoing",
            },
            providerEventId: `provider-${current.key}-burst-${index}`,
            providerSessionId,
          }),
        );
        await adminPrisma.providerWebhookEvent.update({
          data: { receivedAt },
          where: { id: received.id },
        });
        records.push({ ...received, receivedAt });
      }

      const processor = createTelnyxVoiceEventProcessor({
        admit: async (event) => {
          admitted.push(event.id);
          await admitTelnyxEvent(event, adminPrisma);
        },
        dispatchCommand: async (commandId) => ({ commandId, status: "SETTLED" }),
        inbox: providerWebhookInbox,
        projector: {
          projectAndComplete: async (...args) => {
            const [event] = args;
            activeProjectors += 1;
            maxActiveProjectors = Math.max(maxActiveProjectors, activeProjectors);
            try {
              if (event.id === records[0]!.id) {
                firstProjectionStarted.resolve();
                await releaseProjection.promise;
              }
              const projection = await projector.projectAndComplete(...args);
              if (projection.legStatus === "BRIDGED" && projection.legId) {
                bridgedLegIds.add(projection.legId);
              }
              projectedStatuses.push(projection.callStatus);
              return projection;
            } finally {
              activeProjectors -= 1;
            }
          },
        },
      });

      const first = processor.processRecord(records[0]!);
      firstProcessing = first;
      await firstProjectionStarted.promise;
      const competing = await Promise.allSettled(
        records.slice(1).map((record) => processor.processRecord(record)),
      );
      expect(
        competing.every(
          (result) =>
            result.status === "rejected" &&
            typeof result.reason === "object" &&
            result.reason !== null &&
            "status" in result.reason &&
            result.reason.status === 503,
        ),
      ).toBe(true);

      const [snapshots, heartbeats, answer] = await Promise.all([
        Promise.all(
          actors.map((actor) => callCenter.readOperatorState(actor, current.queueId)),
        ),
        Promise.all(
          actors.map((actor, index) =>
            callCenter.updateAgent({
              actor,
              input: {
                audioReady: true,
                clientInstanceId: id(`burst-browser-${index}`),
                connectionState: "READY",
                expectedStateVersion: 0,
                microphoneReady: true,
                presence: "AVAILABLE",
                sessionId: sessionIds[index]!,
              },
              kind: "HEARTBEAT",
              now: new Date(now.getTime() + 1_000),
            }),
          ),
        ),
        callCenter.claimInboundAnswer(
          actors[0]!,
          {
            callId,
            idempotencyKey: id("burst-answer"),
            legId: agentLegIds[0]!,
            sessionId: sessionIds[0]!,
          },
          new Date(now.getTime() + 1_000),
        ),
      ]);
      expect(
        snapshots.every((snapshot, index) =>
          snapshot.calls.some(
            (call) =>
              call.id === callId &&
              call.legs.some(
                (leg) => leg.id === agentLegIds[index] && leg.status === "RINGING",
              ),
          ),
        ),
      ).toBe(true);
      expect(
        heartbeats.every(
          ({ session }) => session.leaseExpiresAt.getTime() > now.getTime(),
        ),
      ).toBe(true);
      expect(answer.status).toBe("ACCEPTED");

      releaseProjection.resolve();
      await expect(first).resolves.toMatchObject({ outcome: "PROCESSED" });
      const drain = createProviderWebhookDrainer({
        backlog: { listDue: async () => records.slice(1) },
        concurrency: 4,
        processRecord: processor.processRecord,
      });
      await expect(drain()).resolves.toEqual({
        attempted: 19,
        failed: 0,
        processed: 19,
      });
      expect(maxActiveProjectors).toBe(1);
      expect(admitted).toEqual(records.map(({ id: eventId }) => eventId));
      expect(
        await adminPrisma.providerWebhookEvent.count({
          where: {
            providerCallSessionId: providerSessionId,
            processingStatus: "FAILED",
          },
        }),
      ).toBe(0);
      const call = await adminPrisma.callCenterCall.findUniqueOrThrow({
        include: { legs: { where: { kind: "AGENT" } } },
        where: { id: callId },
      });
      expect(call).toMatchObject({
        status: "COMPLETED",
        winningLegId: agentLegIds[0],
      });
      expect([...bridgedLegIds]).toEqual([agentLegIds[0]]);
      expect(call.legs.filter(({ status }) => status === "BRIDGED")).toHaveLength(0);
      expect(call.legs.filter(({ status }) => status === "ENDED")).toHaveLength(4);
      const terminalIndex = projectedStatuses.findIndex((status) =>
        ["ABANDONED", "COMPLETED", "FAILED", "VOICEMAIL"].includes(status),
      );
      expect(terminalIndex).toBeGreaterThanOrEqual(0);
      expect(
        projectedStatuses
          .slice(terminalIndex)
          .every((status) => status === projectedStatuses[terminalIndex]),
      ).toBe(true);
    } finally {
      releaseProjection.resolve();
      await firstProcessing?.catch(() => undefined);
      await current.cleanup();
      await adminPrisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  it("converges reordered callbacks and rolls back a failed projection", async () => {
    const current = await fixture();
    const providerSessionId = `session-${current.key}`;

    try {
      const hangup = envelope({
        eventType: "call.hangup",
        key: current.key,
        providerEventId: `provider-${current.key}-hangup`,
        providerSessionId,
      });
      await expect(callCenter.applyProviderEvent(hangup)).resolves.toMatchObject({
        outcome: "PROCESSED",
      });
      await expect(
        callCenter.applyProviderEvent(
          envelope({
            eventType: "call.initiated",
            key: current.key,
            providerEventId: `provider-${current.key}-initiated`,
            providerSessionId,
          }),
        ),
      ).resolves.toMatchObject({ outcome: "PROCESSED" });

      const call = await adminPrisma.callCenterCall.findFirstOrThrow({
        include: { legs: true },
        where: { practiceId: current.practiceId },
      });
      expect(call.legs).toHaveLength(1);

      const unsupported = envelope({
        eventType: "call.transcription",
        key: current.key,
        providerEventId: `provider-${current.key}-unsupported`,
        providerSessionId,
      });
      await expect(callCenter.applyProviderEvent(unsupported)).resolves.toMatchObject({
        outcome: "IGNORED",
      });

      const eventCount = await adminPrisma.callCenterEvent.count({
        where: { practiceId: current.practiceId },
      });
      const failed = envelope({
        eventType: "call.speak.ended",
        key: current.key,
        payload: {
          client_state: Buffer.from(
            JSON.stringify({
              callId: call.id,
              canonicalCommand: true,
              commandId: `missing-command-${current.key}`,
              legId: call.legs[0]!.id,
            }),
          ).toString("base64"),
        },
        providerEventId: `provider-${current.key}-failed`,
        providerSessionId,
      });
      await expect(callCenter.applyProviderEvent(failed)).resolves.toMatchObject({
        outcome: "FAILED",
      });
      expect(
        await adminPrisma.callCenterEvent.count({
          where: { practiceId: current.practiceId },
        }),
      ).toBe(eventCount);
      expect(
        await adminPrisma.providerWebhookEvent.findUniqueOrThrow({
          where: {
            provider_providerEventId: {
              provider: "TELNYX",
              providerEventId: failed.providerEventId,
            },
          },
        }),
      ).toMatchObject({
        attemptCount: 1,
        processingStatus: "FAILED",
      });
    } finally {
      await current.cleanup();
    }
  });

  it("completes a failed transfer after an out-of-scope peer event", async () => {
    const current = await fixture();
    const occurredAt = new Date("2026-07-19T21:52:08.772Z");

    try {
      const {
        callId,
        customerLegId,
        sourceControlId,
        sourceLegId,
        sourceProviderLegId,
        sourceState,
        targetControlId,
        targetLegId,
        targetProviderLegId,
        targetState,
        transferCommandId,
        transferEvent,
      } = await transferFixture(current, occurredAt);

      await expect(
        callCenter.applyProviderEvent(
          transferEvent("call.initiated", `provider-${current.key}-target-initiated`, {
            call_control_id: targetControlId,
            call_leg_id: targetProviderLegId,
            client_state: targetState,
          }),
        ),
      ).resolves.toMatchObject({ outcome: "PROCESSED" });
      await expect(
        callCenter.applyProviderEvent(
          transferEvent("call.initiated", `provider-${current.key}-peer-initiated`, {
            call_control_id: `peer-control-${current.key}`,
            call_leg_id: `peer-leg-${current.key}`,
          }),
        ),
      ).resolves.toMatchObject({ outcome: "IGNORED" });
      await expect(
        callCenter.applyProviderEvent(
          transferEvent("call.hangup", `provider-${current.key}-target-hangup`, {
            call_control_id: targetControlId,
            call_leg_id: targetProviderLegId,
            client_state: targetState,
            hangup_cause: "normal_clearing",
          }),
        ),
      ).resolves.toMatchObject({ outcome: "PROCESSED" });
      await expect(
        callCenter.applyProviderEvent(
          transferEvent("call.hangup", `provider-${current.key}-source-hangup`, {
            call_control_id: sourceControlId,
            call_leg_id: sourceProviderLegId,
            client_state: sourceState,
            hangup_cause: "normal_clearing",
          }),
        ),
      ).resolves.toMatchObject({ outcome: "PROCESSED" });

      const settled = await adminPrisma.callCenterCall.findUniqueOrThrow({
        include: { commands: true, legs: true },
        where: { id: callId },
      });
      expect(settled).toMatchObject({
        endedAt: occurredAt,
        status: "COMPLETED",
      });
      expect(settled.legs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: sourceLegId, status: "ENDED" }),
          expect.objectContaining({ id: targetLegId, status: "ENDED" }),
          expect.objectContaining({
            endedAt: occurredAt,
            errorCode: "CALL_TERMINAL",
            id: customerLegId,
            status: "ENDED",
          }),
        ]),
      );
      expect(settled.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            errorCode: "COMMAND_LEG_TERMINAL",
            id: transferCommandId,
            status: "FAILED",
          }),
          expect.objectContaining({
            legId: customerLegId,
            type: "HANGUP_LEG",
          }),
        ]),
      );
    } finally {
      await current.cleanup();
    }
  });

  it("keeps the source connected when the transfer target answers without bridge evidence", async () => {
    const current = await fixture();
    const requestedAt = new Date("2026-07-20T10:31:12.816Z");
    const targetInitiatedAt = new Date("2026-07-20T10:31:13.795Z");
    const targetAnsweredAt = new Date("2026-07-20T10:31:24.035Z");

    try {
      const {
        callId,
        customerLegId,
        sourceLegId,
        targetControlId,
        targetLegId,
        targetProviderLegId,
        targetState,
        transferCommandId,
        transferEvent,
      } = await transferFixture(current, requestedAt);

      await expect(
        callCenter.applyProviderEvent(
          transferEvent(
            "call.initiated",
            `provider-${current.key}-target-initiated`,
            {
              call_control_id: targetControlId,
              call_leg_id: targetProviderLegId,
              client_state: targetState,
            },
            targetInitiatedAt,
          ),
        ),
      ).resolves.toMatchObject({ outcome: "PROCESSED" });
      await expect(
        callCenter.applyProviderEvent(
          transferEvent(
            "call.answered",
            `provider-${current.key}-target-answered`,
            {
              call_control_id: targetControlId,
              call_leg_id: targetProviderLegId,
              client_state: targetState,
            },
            targetAnsweredAt,
          ),
        ),
      ).resolves.toMatchObject({ outcome: "PROCESSED" });

      const pending = await adminPrisma.callCenterCall.findUniqueOrThrow({
        include: { commands: true, legs: true },
        where: { id: callId },
      });
      expect(pending).toMatchObject({
        endedAt: null,
        status: "CONNECTED",
        winningLegId: sourceLegId,
      });
      expect(pending.legs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            answeredAt: targetAnsweredAt,
            bridgedAt: null,
            endedAt: null,
            id: targetLegId,
            status: "ANSWERED",
          }),
          expect.objectContaining({
            endedAt: null,
            id: customerLegId,
            status: "BRIDGED",
          }),
        ]),
      );
      expect(pending.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            errorCode: null,
            id: transferCommandId,
            status: "SENT",
          }),
        ]),
      );
    } finally {
      await current.cleanup();
    }
  });

  it("completes a transfer when the tagged target answers after an untagged peer bridge", async () => {
    const current = await fixture();
    const requestedAt = new Date("2026-07-20T10:31:12.816Z");
    const targetInitiatedAt = new Date("2026-07-20T10:31:13.795Z");
    const peerInitiatedAt = new Date("2026-07-20T10:31:14.237Z");
    const peerBridgedAt = new Date("2026-07-20T10:31:23.917Z");
    const sourceHungUpAt = new Date("2026-07-20T10:31:23.978Z");
    const targetAnsweredAt = new Date("2026-07-20T10:31:24.035Z");

    try {
      const {
        callId,
        customerLegId,
        sourceControlId,
        sourceLegId,
        sourceProviderLegId,
        sourceState,
        targetControlId,
        targetLegId,
        targetProviderLegId,
        targetState,
        transferCommandId,
        transferEvent,
      } = await transferFixture(current, requestedAt);
      const peerControlId = `peer-control-${current.key}`;
      const peerLegId = `peer-leg-${current.key}`;

      await expect(
        callCenter.applyProviderEvent(
          transferEvent(
            "call.initiated",
            `provider-${current.key}-target-initiated`,
            {
              call_control_id: targetControlId,
              call_leg_id: targetProviderLegId,
              client_state: targetState,
            },
            targetInitiatedAt,
          ),
        ),
      ).resolves.toMatchObject({ outcome: "PROCESSED" });
      await expect(
        callCenter.applyProviderEvent(
          transferEvent(
            "call.initiated",
            `provider-${current.key}-peer-initiated`,
            { call_control_id: peerControlId, call_leg_id: peerLegId },
            peerInitiatedAt,
          ),
        ),
      ).resolves.toMatchObject({ outcome: "IGNORED" });
      for (const eventType of ["call.answered", "call.bridged"]) {
        await expect(
          callCenter.applyProviderEvent(
            transferEvent(
              eventType,
              `provider-${current.key}-peer-${eventType.split(".")[1]}`,
              { call_control_id: peerControlId, call_leg_id: peerLegId },
              peerBridgedAt,
            ),
          ),
        ).resolves.toMatchObject({ outcome: "IGNORED" });
      }
      await expect(
        callCenter.applyProviderEvent(
          transferEvent(
            "call.hangup",
            `provider-${current.key}-source-hangup`,
            {
              call_control_id: sourceControlId,
              call_leg_id: sourceProviderLegId,
              client_state: sourceState,
              hangup_cause: "normal_clearing",
            },
            sourceHungUpAt,
          ),
        ),
      ).resolves.toMatchObject({ outcome: "PROCESSED" });
      await expect(
        callCenter.applyProviderEvent(
          transferEvent(
            "call.answered",
            `provider-${current.key}-target-answered`,
            {
              call_control_id: targetControlId,
              call_leg_id: targetProviderLegId,
              client_state: targetState,
            },
            targetAnsweredAt,
          ),
        ),
      ).resolves.toMatchObject({ outcome: "PROCESSED" });

      const transferred = await adminPrisma.callCenterCall.findUniqueOrThrow({
        include: { commands: true, legs: true },
        where: { id: callId },
      });
      expect(transferred).toMatchObject({
        endedAt: null,
        status: "CONNECTED",
        winningLegId: targetLegId,
      });
      expect(transferred.legs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            endedAt: sourceHungUpAt,
            errorCode: "TRANSFERRED",
            id: sourceLegId,
            status: "ENDED",
          }),
          expect.objectContaining({
            answeredAt: targetAnsweredAt,
            bridgedAt: peerBridgedAt,
            endedAt: null,
            id: targetLegId,
            status: "BRIDGED",
          }),
          expect.objectContaining({
            endedAt: null,
            id: customerLegId,
            status: "BRIDGED",
          }),
        ]),
      );
      expect(transferred.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            errorCode: null,
            id: transferCommandId,
            status: "CONFIRMED",
          }),
        ]),
      );
      expect(
        await adminPrisma.callCenterEvent.count({
          where: {
            aggregateId: callId,
            idempotencyKey: `${transferCommandId}:completed`,
            type: "CALL_TRANSFER_COMPLETED",
          },
        }),
      ).toBe(1);
    } finally {
      await current.cleanup();
    }
  });
});
