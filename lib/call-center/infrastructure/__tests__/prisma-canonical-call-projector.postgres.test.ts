import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { PrismaClient } from "@/generated/prisma/client";
import { lockCallCenterPractice } from "@/lib/call-center/infrastructure/prisma-call-center-practice-lock";
import type { ProviderWebhookRecord } from "@/lib/call-center/infrastructure/provider-webhook-inbox";
import {
  CanonicalProjectionError,
  createPrismaCanonicalCallProjector,
  type CanonicalCallProjector,
} from "@/lib/call-center/infrastructure/prisma-canonical-call-projector";
import type { CanonicalTelnyxCallFact } from "@/lib/call-center/infrastructure/telnyx-canonical-call-fact";

const postgresUrl = process.env.CALL_CENTER_POSTGRES_TEST_URL ?? "";
const describePostgres = postgresUrl ? describe : describe.skip;
const occurredAt = new Date("2026-07-20T10:00:00.000Z");
const projectedAt = new Date("2026-07-20T10:00:01.000Z");

type Fixture = Awaited<ReturnType<typeof createFixture>>;

describePostgres("canonical call projector on PostgreSQL", () => {
  let prisma: PrismaClient;
  let projector: CanonicalCallProjector;

  beforeAll(() => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgresUrl }),
    });
    projector = createPrismaCanonicalCallProjector(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates one inbound call and returns only commands committed with it", async () => {
    const fixture = await createFixture(prisma);
    const event = await fixture.processingEvent("call.initiated");

    try {
      const result = await projector.projectAndComplete(
        event,
        fixture.fact({
          fromPhone: fixture.callerPhone,
          providerEventId: event.providerEventId,
          toAddress: fixture.practicePhone,
          toPhone: fixture.practicePhone,
        }),
        projectedAt,
      );

      const call = await prisma.callCenterCall.findUniqueOrThrow({
        include: {
          commands: { orderBy: { createdAt: "asc" } },
          legs: true,
          tasks: true,
        },
        where: { id: result.callId },
      });
      expect(result).toMatchObject({
        callId: call.id,
        callStatus: "VOICEMAIL",
        legId: call.legs[0]?.id,
        legStatus: "RINGING",
        practiceId: fixture.practiceId,
      });
      expect(call).toMatchObject({
        direction: "INBOUND",
        fromPhone: fixture.callerPhone,
        practiceId: fixture.practiceId,
        queueId: fixture.queueId,
        status: "VOICEMAIL",
        toPhone: fixture.practicePhone,
      });
      expect(call.legs).toMatchObject([
        {
          kind: "CUSTOMER",
          providerCallControlId: fixture.id("control"),
          providerCallLegId: fixture.id("provider-leg"),
          status: "RINGING",
        },
      ]);
      expect(result.commandIds).toEqual(call.commands.map(({ id }) => id));
      expect(call.commands.map(({ type }) => type)).toEqual([
        "ANSWER_CUSTOMER",
        "START_RINGBACK",
        "STOP_PLAYBACK",
        "PLAY_VOICEMAIL_GREETING",
      ]);
      expect(call.tasks).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps a terminal direct-handoff failure monotonic under replay", async () => {
    const fixture = await createFixture(prisma);
    const callId = fixture.id("failed-handoff-call");
    const event = await fixture.processingEvent("call.initiated", "failed-handoff");
    const fact = fixture.fact({
      fromPhone: fixture.callerPhone,
      providerEventId: event.providerEventId,
      toAddress: fixture.practicePhone,
      toPhone: fixture.practicePhone,
    });

    try {
      await prisma.callCenterCall.create({
        data: {
          direction: "INBOUND",
          fromPhone: fixture.callerPhone,
          id: callId,
          numberId: fixture.numberId,
          practiceId: fixture.practiceId,
          providerCallSessionId: fixture.id("session"),
          queueId: fixture.queueId,
          receivedAt: occurredAt,
          status: "RECEIVED",
          toPhone: fixture.practicePhone,
        },
      });
      await fixture.createIngressHandoff(callId, "terminal");

      await expect(
        projector.projectAndComplete(event, fact, projectedAt),
      ).resolves.toMatchObject({
        callId,
        callStatus: "VOICEMAIL",
      });
      const failed = await prisma.callCenterHandoff.findUniqueOrThrow({
        where: { callId },
      });
      expect(failed).toMatchObject({
        connectedAt: null,
        failedAt: projectedAt,
        failureCode: "CALL_VOICEMAIL",
        status: "FAILED",
      });

      await prisma.providerWebhookEvent.update({
        data: {
          attemptCount: 2,
          processedAt: null,
          processingStatus: "PROCESSING",
        },
        where: { id: event.id },
      });
      await projector.projectAndComplete(
        { ...event, attemptCount: 2 },
        fact,
        new Date("2026-07-20T10:00:02.000Z"),
      );
      expect(
        await prisma.callCenterHandoff.findUniqueOrThrow({
          where: { callId },
        }),
      ).toEqual(failed);
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns pending agent dials from customer answer and ringback callbacks", async () => {
    const fixture = await createFixture(prisma);
    await fixture.createReadyAgent();
    const initiated = await fixture.processingEvent("call.initiated", "ready-inbound");

    try {
      const initial = await projector.projectAndComplete(
        initiated,
        fixture.fact({
          fromPhone: fixture.callerPhone,
          providerEventId: initiated.providerEventId,
          toAddress: fixture.practicePhone,
          toPhone: fixture.practicePhone,
        }),
        projectedAt,
      );
      expect(initial).toMatchObject({
        callStatus: "QUEUED",
        legStatus: "RINGING",
      });
      const commands = await prisma.callCenterCommand.findMany({
        where: { callId: initial.callId },
      });
      const answer = commands.find(({ type }) => type === "ANSWER_CUSTOMER")!;
      const ringback = commands.find(({ type }) => type === "START_RINGBACK")!;
      const dial = commands.find(({ type }) => type === "DIAL_AGENT")!;
      expect([answer, ringback, dial]).not.toContain(undefined);

      await prisma.callCenterCommand.update({
        data: { attemptCount: 1, status: "SENT" },
        where: { id: answer.id },
      });
      const answered = await fixture.processingEvent(
        "call.answered",
        "customer-answered",
      );
      await expect(
        projector.projectAndComplete(
          answered,
          fixture.fact({
            canonicalCallId: initial.callId,
            canonicalLegId: initial.legId,
            eventType: "call.answered",
            fromPhone: fixture.callerPhone,
            providerCommandId: answer.id,
            providerCommandIdSource: "PAYLOAD",
            providerEventId: answered.providerEventId,
            toAddress: fixture.practicePhone,
            toPhone: fixture.practicePhone,
          }),
          new Date("2026-07-20T10:00:02.000Z"),
        ),
      ).resolves.toMatchObject({
        callStatus: "QUEUED",
        commandIds: [dial.id],
        legStatus: "ANSWERED",
      });

      await prisma.callCenterCommand.update({
        data: { attemptCount: 1, status: "SENT" },
        where: { id: ringback.id },
      });
      const playback = await fixture.processingEvent(
        "call.playback.started",
        "customer-ringback",
      );
      await expect(
        projector.projectAndComplete(
          playback,
          fixture.fact({
            canonicalCallId: initial.callId,
            canonicalLegId: initial.legId,
            eventType: "call.playback.started",
            fromPhone: fixture.callerPhone,
            providerCommandId: ringback.id,
            providerCommandIdSource: "PAYLOAD",
            providerEventId: playback.providerEventId,
            toAddress: fixture.practicePhone,
            toPhone: fixture.practicePhone,
          }),
          new Date("2026-07-20T10:00:03.000Z"),
        ),
      ).resolves.toMatchObject({
        callStatus: "QUEUED",
        commandIds: [dial.id],
        legStatus: "ANSWERED",
      });
      expect(
        await prisma.callCenterCommand.findMany({
          orderBy: { id: "asc" },
          where: { id: { in: [answer.id, dial.id, ringback.id] } },
        }),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: answer.id, status: "CONFIRMED" }),
          expect.objectContaining({ id: dial.id, status: "PENDING" }),
          expect.objectContaining({ id: ringback.id, status: "CONFIRMED" }),
        ]),
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("commits one outbound provider fact as one reconstructable revision", async () => {
    const fixture = await createFixture(prisma);
    const { callId, legId } = await fixture.createOutboundCall("projection");
    const event = await fixture.processingEvent("call.initiated");

    try {
      const result = await projector.projectAndComplete(
        event,
        fixture.fact({
          canonicalCallId: callId,
          canonicalLegId: legId,
          direction: "OUTBOUND",
          endpointId: fixture.endpointId,
          legKind: "AGENT",
          providerEventId: event.providerEventId,
        }),
        projectedAt,
      );

      expect(result).toEqual({
        callId,
        callStatus: "RINGING",
        commandIds: [],
        legId,
        legStatus: "RINGING",
        practiceId: fixture.practiceId,
      });
      expect(
        await prisma.callCenterCall.findUniqueOrThrow({
          include: { legs: true },
          where: { id: callId },
        }),
      ).toMatchObject({
        deadlineAt: new Date("2026-07-20T10:01:00.000Z"),
        providerCallSessionId: fixture.id("session"),
        status: "RINGING",
        legs: [
          {
            endpointId: fixture.endpointId,
            providerCallControlId: fixture.id("control"),
            providerCallLegId: fixture.id("provider-leg"),
            providerCallSessionId: fixture.id("session"),
            status: "RINGING",
          },
        ],
      });
      expect(
        await prisma.callCenterEvent.findFirstOrThrow({
          where: { aggregateId: callId },
        }),
      ).toMatchObject({
        aggregateType: "CALL",
        data: {
          callStatus: "RINGING",
          legId,
          legStatus: "RINGING",
          providerEventId: event.providerEventId,
        },
        idempotencyKey: `telnyx:${event.providerEventId}`,
        type: "CALL_INITIATED",
      });
      expect(
        await prisma.providerWebhookEvent.findUniqueOrThrow({
          where: { id: event.id },
        }),
      ).toMatchObject({
        errorCode: null,
        nextAttemptAt: null,
        processedAt: projectedAt,
        processingStatus: "PROCESSED",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("releases the customer dial only after the outbound agent answers", async () => {
    const fixture = await createFixture(prisma);
    const { callId, legId } = await fixture.createOutboundCall("lifecycle");
    const commandId = fixture.id("dial-command");
    const customerLegId = fixture.id("customer-leg");
    const customerCommandId = fixture.id("customer-command");

    try {
      await prisma.callCenterCallLeg.create({
        data: {
          callId,
          id: customerLegId,
          kind: "CUSTOMER",
          startedAt: occurredAt,
          status: "CREATED",
        },
      });
      await prisma.callCenterCommand.create({
        data: {
          attemptCount: 1,
          callId,
          id: commandId,
          idempotencyKey: fixture.id("dial-command-key"),
          legId,
          practiceId: fixture.practiceId,
          status: "SENT",
          type: "DIAL_AGENT",
        },
      });
      await prisma.callCenterCommand.create({
        data: {
          callId,
          dependsOnCommandId: commandId,
          id: customerCommandId,
          idempotencyKey: fixture.id("customer-command-key"),
          legId: customerLegId,
          practiceId: fixture.practiceId,
          type: "DIAL_CUSTOMER",
        },
      });
      const answered = await fixture.processingEvent("call.answered", "outbound-answer");
      await expect(
        projector.projectAndComplete(
          answered,
          fixture.fact({
            canonicalCallId: callId,
            canonicalLegId: legId,
            direction: "OUTBOUND",
            endpointId: fixture.endpointId,
            eventType: "call.answered",
            legKind: "AGENT",
            providerEventId: answered.providerEventId,
          }),
          projectedAt,
        ),
      ).resolves.toMatchObject({
        callStatus: "RINGING",
        commandIds: [customerCommandId],
        legStatus: "ANSWERED",
      });
      expect(
        await prisma.callCenterCommand.findUniqueOrThrow({
          where: { id: commandId },
        }),
      ).toMatchObject({ status: "CONFIRMED" });

      const hangup = await fixture.processingEvent("call.hangup", "outbound-hangup");
      await expect(
        projector.projectAndComplete(
          hangup,
          fixture.fact({
            canonicalCallId: callId,
            canonicalLegId: legId,
            direction: "OUTBOUND",
            endpointId: fixture.endpointId,
            eventType: "call.hangup",
            hangupCauseCode: "NORMAL_CLEARING",
            legKind: "AGENT",
            providerEventId: hangup.providerEventId,
          }),
          new Date("2026-07-20T10:00:02.000Z"),
        ),
      ).resolves.toMatchObject({
        callStatus: "ABANDONED",
        legStatus: "ENDED",
      });
      expect(
        await prisma.callCenterCall.findUniqueOrThrow({
          include: { legs: true },
          where: { id: callId },
        }),
      ).toMatchObject({
        status: "ABANDONED",
        legs: expect.arrayContaining([
          expect.objectContaining({ id: legId, status: "ENDED" }),
          expect.objectContaining({ id: customerLegId, status: "ENDED" }),
        ]),
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires both outbound bridge callbacks in either delivery order", async () => {
    for (const firstKind of ["CUSTOMER", "AGENT"] as const) {
      const fixture = await createFixture(prisma);
      const key = firstKind.toLowerCase();
      const { callId, legId } = await fixture.createOutboundCall(`bridge-${key}`);
      const customerLegId = fixture.id(`bridge-${key}-customer-leg`);
      const agentControlId = fixture.id(`bridge-${key}-agent-control`);
      const agentProviderLegId = fixture.id(`bridge-${key}-agent-provider-leg`);
      const customerControlId = fixture.id(`bridge-${key}-customer-control`);
      const customerProviderLegId = fixture.id(`bridge-${key}-customer-provider-leg`);

      try {
        await prisma.callCenterCall.update({
          data: { status: "RINGING" },
          where: { id: callId },
        });
        await prisma.callCenterCallLeg.update({
          data: {
            answeredAt: occurredAt,
            providerCallControlId: agentControlId,
            providerCallLegId: agentProviderLegId,
            providerCallSessionId: fixture.id(`bridge-${key}-session`),
            status: "ANSWERED",
          },
          where: { id: legId },
        });
        await prisma.callCenterCallLeg.create({
          data: {
            answeredAt: occurredAt,
            callId,
            id: customerLegId,
            kind: "CUSTOMER",
            providerCallControlId: customerControlId,
            providerCallLegId: customerProviderLegId,
            providerCallSessionId: fixture.id(`bridge-${key}-session`),
            startedAt: occurredAt,
            status: "ANSWERED",
          },
        });

        const projectBridge = async (
          kind: "AGENT" | "CUSTOMER",
          suffix: string,
          at: Date,
        ) => {
          const event = await fixture.processingEvent(
            "call.bridged",
            `bridge-${key}-${suffix}`,
          );
          return projector.projectAndComplete(
            event,
            fixture.fact({
              canonicalCallId: callId,
              canonicalLegId: kind === "AGENT" ? legId : customerLegId,
              direction: "OUTBOUND",
              ...(kind === "AGENT" ? { endpointId: fixture.endpointId } : {}),
              eventType: "call.bridged",
              legKind: kind,
              providerCallControlId:
                kind === "AGENT" ? agentControlId : customerControlId,
              providerCallLegId:
                kind === "AGENT" ? agentProviderLegId : customerProviderLegId,
              providerEventId: event.providerEventId,
            }),
            at,
          );
        };

        const secondKind = firstKind === "AGENT" ? "CUSTOMER" : "AGENT";
        await expect(
          projectBridge(firstKind, "first", projectedAt),
        ).resolves.toMatchObject({
          callStatus: "RINGING",
          legStatus: "BRIDGED",
        });
        await expect(
          projectBridge(secondKind, "second", new Date("2026-07-20T10:00:02.000Z")),
        ).resolves.toMatchObject({
          callStatus: "CONNECTED",
          legStatus: "BRIDGED",
        });
        expect(
          await prisma.callCenterCall.findUniqueOrThrow({ where: { id: callId } }),
        ).toMatchObject({ status: "CONNECTED", winningLegId: legId });
      } finally {
        await fixture.cleanup();
      }
    }
  });

  it("enforces relational and categorical provider identity boundaries", async () => {
    const fixture = await createFixture(prisma);

    try {
      await expect(
        Promise.resolve(
          prisma.callCenterCallLeg.create({
            data: {
              callId: fixture.id("missing-call"),
              id: fixture.id("orphan-leg"),
              kind: "AGENT",
              startedAt: occurredAt,
              status: "CREATED",
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "P2003" });

      const { callId, legId } = await fixture.createOutboundCall("identity");
      const initiated = await fixture.processingEvent("call.initiated", "identity-bound");
      await projector.projectAndComplete(
        initiated,
        fixture.fact({
          canonicalCallId: callId,
          canonicalLegId: legId,
          direction: "OUTBOUND",
          endpointId: fixture.endpointId,
          legKind: "AGENT",
          providerEventId: initiated.providerEventId,
        }),
        projectedAt,
      );

      await expect(
        Promise.resolve(
          prisma.callCenterCallLeg.create({
            data: {
              callId,
              endpointId: fixture.endpointId,
              id: fixture.id("duplicate-control-leg"),
              kind: "AGENT",
              providerCallControlId: fixture.id("control"),
              startedAt: occurredAt,
              status: "CREATED",
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "P2002" });

      const mismatch = await fixture.processingEvent(
        "call.answered",
        "identity-mismatch",
      );
      await expect(
        projector.projectAndComplete(
          mismatch,
          fixture.fact({
            canonicalCallId: callId,
            canonicalLegId: legId,
            direction: "OUTBOUND",
            endpointId: fixture.endpointId,
            eventType: "call.answered",
            legKind: "AGENT",
            providerCallControlId: fixture.id("different-control"),
            providerEventId: mismatch.providerEventId,
          }),
          projectedAt,
        ),
      ).rejects.toEqual(new CanonicalProjectionError("CANONICAL_LEG_IDENTITY_MISMATCH"));
      expect(
        await prisma.providerWebhookEvent.findUniqueOrThrow({
          where: { id: mismatch.id },
        }),
      ).toMatchObject({ processingStatus: "PROCESSING" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("resolves an unlinked provider peer to its planned SIP agent leg", async () => {
    const fixture = await createFixture(prisma);
    const { callId, legId } = await fixture.createOutboundCall("peer");
    const event = await fixture.processingEvent("call.initiated", "peer");

    try {
      await prisma.callCenterCallLeg.update({
        data: {
          answeredAt: occurredAt,
          bridgedAt: occurredAt,
          status: "BRIDGED",
        },
        where: { id: legId },
      });
      await prisma.callCenterCall.update({
        data: {
          answeredAt: occurredAt,
          providerCallSessionId: fixture.id("session"),
          status: "CONNECTED",
          winningLegId: legId,
        },
        where: { id: callId },
      });

      await expect(
        projector.projectAndComplete(
          event,
          fixture.fact({
            legKind: "AGENT",
            providerCallControlId: fixture.id("peer-control"),
            providerCallLegId: fixture.id("peer-provider-leg"),
            providerEventId: event.providerEventId,
            toAddress: `sip:${fixture.id("sip")}@sip.telnyx.com`,
          }),
          projectedAt,
        ),
      ).resolves.toEqual({
        callId,
        callStatus: "CONNECTED",
        commandIds: [],
        legId,
        legStatus: "BRIDGED",
        practiceId: fixture.practiceId,
      });
      expect(
        await prisma.callCenterEvent.count({
          where: {
            aggregateId: callId,
            idempotencyKey: `telnyx:${event.providerEventId}`,
          },
        }),
      ).toBe(0);
      expect(
        await prisma.providerWebhookEvent.findUniqueOrThrow({
          where: { id: event.id },
        }),
      ).toMatchObject({ processingStatus: "PROCESSED" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps one bridge winner and advances its direct handoff only after connection", async () => {
    const fixture = await createFixture(prisma);
    const callId = fixture.id("call");
    const customerLegId = fixture.id("customer-leg");
    const winningLegId = fixture.id("winning-leg");
    const losingLegId = fixture.id("losing-leg");
    const losingEndpointId = await fixture.createEndpoint("losing");
    const winnerBridge = await fixture.processingEvent("call.bridged", "winner");

    try {
      await prisma.callCenterCall.create({
        data: {
          direction: "INBOUND",
          fromPhone: fixture.callerPhone,
          id: callId,
          numberId: fixture.numberId,
          practiceId: fixture.practiceId,
          queueId: fixture.queueId,
          receivedAt: occurredAt,
          status: "RINGING",
          toPhone: fixture.practicePhone,
        },
      });
      await prisma.callCenterCallLeg.createMany({
        data: [
          {
            callId,
            id: customerLegId,
            kind: "CUSTOMER",
            providerCallControlId: fixture.id("customer-control"),
            providerCallLegId: fixture.id("customer-provider-leg"),
            startedAt: occurredAt,
            status: "ANSWERED",
          },
          {
            callId,
            endpointId: fixture.endpointId,
            id: winningLegId,
            kind: "AGENT",
            providerCallControlId: fixture.id("winner-control"),
            providerCallLegId: fixture.id("winner-provider-leg"),
            startedAt: occurredAt,
            status: "RINGING",
          },
          {
            callId,
            endpointId: losingEndpointId,
            id: losingLegId,
            kind: "AGENT",
            providerCallControlId: fixture.id("loser-control"),
            providerCallLegId: fixture.id("loser-provider-leg"),
            startedAt: occurredAt,
            status: "RINGING",
          },
        ],
      });
      await fixture.createIngressHandoff(callId, "bridge");

      const winner = await projector.projectAndComplete(
        winnerBridge,
        fixture.fact({
          canonicalCallId: callId,
          canonicalLegId: winningLegId,
          endpointId: fixture.endpointId,
          eventType: "call.bridged",
          legKind: "AGENT",
          providerCallControlId: fixture.id("winner-control"),
          providerCallLegId: fixture.id("winner-provider-leg"),
          providerEventId: winnerBridge.providerEventId,
        }),
        projectedAt,
      );

      expect(winner).toMatchObject({
        callId,
        callStatus: "CONNECTED",
        legId: winningLegId,
        legStatus: "BRIDGED",
      });
      expect(
        await prisma.callCenterCall.findUniqueOrThrow({ where: { id: callId } }),
      ).toMatchObject({
        status: "CONNECTED",
        winningLegId,
      });
      expect(
        await prisma.callCenterHandoff.findUniqueOrThrow({ where: { callId } }),
      ).toMatchObject({
        connectedAt: projectedAt,
        failedAt: null,
        failureCode: null,
        status: "CONNECTED",
      });
      expect(
        await prisma.callCenterCallLeg.findUniqueOrThrow({
          where: { id: losingLegId },
        }),
      ).toMatchObject({ status: "ENDED" });
      expect(
        await prisma.callCenterCommand.count({
          where: { id: { in: winner.commandIds } },
        }),
      ).toBe(winner.commandIds.length);

      const loserBridge = await fixture.processingEvent("call.bridged", "loser");
      const delayed = await projector.projectAndComplete(
        loserBridge,
        fixture.fact({
          canonicalCallId: callId,
          canonicalLegId: losingLegId,
          endpointId: losingEndpointId,
          eventType: "call.bridged",
          legKind: "AGENT",
          occurredAt: new Date("2026-07-20T10:00:02.000Z"),
          providerCallControlId: fixture.id("loser-control"),
          providerCallLegId: fixture.id("loser-provider-leg"),
          providerEventId: loserBridge.providerEventId,
        }),
        new Date("2026-07-20T10:00:03.000Z"),
      );

      expect(delayed).toMatchObject({
        callStatus: "CONNECTED",
        legId: losingLegId,
        legStatus: "ENDED",
      });
      expect(
        await prisma.callCenterCall.findUniqueOrThrow({ where: { id: callId } }),
      ).toMatchObject({
        status: "CONNECTED",
        winningLegId,
      });

      const winnerHangup = await fixture.processingEvent("call.hangup", "winner-hangup");
      await expect(
        projector.projectAndComplete(
          winnerHangup,
          fixture.fact({
            canonicalCallId: callId,
            canonicalLegId: winningLegId,
            endpointId: fixture.endpointId,
            eventType: "call.hangup",
            legKind: "AGENT",
            providerCallControlId: fixture.id("winner-control"),
            providerCallLegId: fixture.id("winner-provider-leg"),
            providerEventId: winnerHangup.providerEventId,
          }),
          new Date("2026-07-20T10:00:04.000Z"),
        ),
      ).resolves.toMatchObject({
        callStatus: "COMPLETED",
        legStatus: "ENDED",
      });
      expect(
        await prisma.callCenterHandoff.findUniqueOrThrow({ where: { callId } }),
      ).toMatchObject({
        connectedAt: projectedAt,
        failedAt: null,
        failureCode: null,
        status: "CONNECTED",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("completes a cold transfer only after target answer and bridge facts", async () => {
    const fixture = await createFixture(prisma);
    const { callId, commandId, sourceLegId, targetEndpointId, targetLegId } =
      await fixture.createTransfer("transfer");

    try {
      const bridged = await fixture.processingEvent("call.bridged", "transfer-bridged");
      await expect(
        projector.projectAndComplete(
          bridged,
          fixture.fact({
            canonicalCallId: callId,
            canonicalLegId: targetLegId,
            direction: "OUTBOUND",
            endpointId: targetEndpointId,
            eventType: "call.bridged",
            internalTransferTarget: true,
            legKind: "AGENT",
            providerCallControlId: fixture.id("transfer-target-control"),
            providerCallLegId: fixture.id("transfer-target-provider-leg"),
            providerCommandId: commandId,
            providerCommandIdSource: "CLIENT_STATE",
            providerEventId: bridged.providerEventId,
          }),
          projectedAt,
        ),
      ).resolves.toMatchObject({
        callStatus: "CONNECTED",
        legStatus: "CREATED",
      });

      const answered = await fixture.processingEvent(
        "call.answered",
        "transfer-answered",
      );
      await expect(
        projector.projectAndComplete(
          answered,
          fixture.fact({
            canonicalCallId: callId,
            canonicalLegId: targetLegId,
            direction: "OUTBOUND",
            endpointId: targetEndpointId,
            eventType: "call.answered",
            internalTransferTarget: true,
            legKind: "AGENT",
            providerCallControlId: fixture.id("transfer-target-control"),
            providerCallLegId: fixture.id("transfer-target-provider-leg"),
            providerCommandId: commandId,
            providerCommandIdSource: "CLIENT_STATE",
            providerEventId: answered.providerEventId,
          }),
          new Date("2026-07-20T10:00:02.000Z"),
        ),
      ).resolves.toMatchObject({
        callStatus: "CONNECTED",
        legStatus: "BRIDGED",
      });

      expect(
        await prisma.callCenterCall.findUniqueOrThrow({
          include: { legs: { orderBy: { id: "asc" } } },
          where: { id: callId },
        }),
      ).toMatchObject({
        status: "CONNECTED",
        winningLegId: targetLegId,
        legs: expect.arrayContaining([
          expect.objectContaining({ id: sourceLegId, status: "ENDED" }),
          expect.objectContaining({ id: targetLegId, status: "BRIDGED" }),
        ]),
      });
      expect(
        await prisma.callCenterCommand.findUniqueOrThrow({
          where: { id: commandId },
        }),
      ).toMatchObject({ status: "CONFIRMED" });
      expect(
        await prisma.callCenterEvent.count({
          where: {
            aggregateId: callId,
            type: "CALL_TRANSFER_COMPLETED",
          },
        }),
      ).toBe(1);

      const delayedSourceHangup = await fixture.processingEvent(
        "call.hangup",
        "transfer-delayed-source-hangup",
      );
      await expect(
        projector.projectAndComplete(
          delayedSourceHangup,
          fixture.fact({
            canonicalCallId: callId,
            canonicalLegId: sourceLegId,
            direction: "OUTBOUND",
            endpointId: fixture.endpointId,
            eventType: "call.hangup",
            legKind: "AGENT",
            providerCallControlId: fixture.id("transfer-source-control"),
            providerCallLegId: fixture.id("transfer-source-provider-leg"),
            providerEventId: delayedSourceHangup.providerEventId,
          }),
          new Date("2026-07-20T10:00:03.000Z"),
        ),
      ).resolves.toMatchObject({
        callStatus: "CONNECTED",
        legId: sourceLegId,
        legStatus: "ENDED",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps a failed transfer target terminal under delayed callbacks", async () => {
    const fixture = await createFixture(prisma);
    const { callId, commandId, sourceLegId, targetEndpointId, targetLegId } =
      await fixture.createTransfer("failed-transfer");

    try {
      const targetHangup = await fixture.processingEvent(
        "call.hangup",
        "failed-transfer-target-hangup",
      );
      await expect(
        projector.projectAndComplete(
          targetHangup,
          fixture.fact({
            canonicalCallId: callId,
            canonicalLegId: targetLegId,
            direction: "OUTBOUND",
            endpointId: targetEndpointId,
            eventType: "call.hangup",
            internalTransferTarget: true,
            legKind: "AGENT",
            providerCallControlId: fixture.id("failed-transfer-target-control"),
            providerCallLegId: fixture.id("failed-transfer-target-provider-leg"),
            providerCommandId: commandId,
            providerCommandIdSource: "CLIENT_STATE",
            providerEventId: targetHangup.providerEventId,
          }),
          projectedAt,
        ),
      ).resolves.toMatchObject({
        callStatus: "CONNECTED",
        legId: targetLegId,
        legStatus: "ENDED",
      });
      expect(
        await prisma.callCenterCommand.findUniqueOrThrow({
          where: { id: commandId },
        }),
      ).toMatchObject({ status: "FAILED" });

      const delayedAnswer = await fixture.processingEvent(
        "call.answered",
        "failed-transfer-delayed-answer",
      );
      await expect(
        projector.projectAndComplete(
          delayedAnswer,
          fixture.fact({
            canonicalCallId: callId,
            canonicalLegId: targetLegId,
            direction: "OUTBOUND",
            endpointId: targetEndpointId,
            eventType: "call.answered",
            internalTransferTarget: true,
            legKind: "AGENT",
            providerCallControlId: fixture.id("failed-transfer-target-control"),
            providerCallLegId: fixture.id("failed-transfer-target-provider-leg"),
            providerCommandId: commandId,
            providerCommandIdSource: "CLIENT_STATE",
            providerEventId: delayedAnswer.providerEventId,
          }),
          new Date("2026-07-20T10:00:02.000Z"),
        ),
      ).resolves.toMatchObject({
        callStatus: "CONNECTED",
        legId: targetLegId,
        legStatus: "ENDED",
      });
      expect(
        await prisma.callCenterCall.findUniqueOrThrow({
          where: { id: callId },
        }),
      ).toMatchObject({
        status: "CONNECTED",
        winningLegId: sourceLegId,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("serializes concurrent bridge facts to one relational winner", async () => {
    const fixture = await createFixture(prisma);
    const callId = fixture.id("concurrent-call");
    const firstLegId = fixture.id("concurrent-first-leg");
    const secondLegId = fixture.id("concurrent-second-leg");
    const secondEndpointId = await fixture.createEndpoint("concurrent-second");
    const firstBridge = await fixture.processingEvent("call.bridged", "concurrent-first");
    const secondBridge = await fixture.processingEvent(
      "call.bridged",
      "concurrent-second",
    );

    try {
      await prisma.callCenterCall.create({
        data: {
          direction: "INBOUND",
          fromPhone: fixture.callerPhone,
          id: callId,
          numberId: fixture.numberId,
          practiceId: fixture.practiceId,
          queueId: fixture.queueId,
          receivedAt: occurredAt,
          status: "RINGING",
          toPhone: fixture.practicePhone,
        },
      });
      await prisma.callCenterCallLeg.createMany({
        data: [
          {
            callId,
            id: fixture.id("concurrent-customer-leg"),
            kind: "CUSTOMER",
            providerCallControlId: fixture.id("concurrent-customer-control"),
            providerCallLegId: fixture.id("concurrent-customer-provider-leg"),
            startedAt: occurredAt,
            status: "ANSWERED",
          },
          {
            callId,
            endpointId: fixture.endpointId,
            id: firstLegId,
            kind: "AGENT",
            providerCallControlId: fixture.id("concurrent-first-control"),
            providerCallLegId: fixture.id("concurrent-first-provider-leg"),
            startedAt: occurredAt,
            status: "RINGING",
          },
          {
            callId,
            endpointId: secondEndpointId,
            id: secondLegId,
            kind: "AGENT",
            providerCallControlId: fixture.id("concurrent-second-control"),
            providerCallLegId: fixture.id("concurrent-second-provider-leg"),
            startedAt: occurredAt,
            status: "RINGING",
          },
        ],
      });

      await Promise.all([
        projector.projectAndComplete(
          firstBridge,
          fixture.fact({
            canonicalCallId: callId,
            canonicalLegId: firstLegId,
            endpointId: fixture.endpointId,
            eventType: "call.bridged",
            legKind: "AGENT",
            providerCallControlId: fixture.id("concurrent-first-control"),
            providerCallLegId: fixture.id("concurrent-first-provider-leg"),
            providerEventId: firstBridge.providerEventId,
          }),
          projectedAt,
        ),
        projector.projectAndComplete(
          secondBridge,
          fixture.fact({
            canonicalCallId: callId,
            canonicalLegId: secondLegId,
            endpointId: secondEndpointId,
            eventType: "call.bridged",
            legKind: "AGENT",
            providerCallControlId: fixture.id("concurrent-second-control"),
            providerCallLegId: fixture.id("concurrent-second-provider-leg"),
            providerEventId: secondBridge.providerEventId,
          }),
          projectedAt,
        ),
      ]);

      const call = await prisma.callCenterCall.findUniqueOrThrow({
        include: {
          legs: {
            orderBy: { id: "asc" },
            where: { kind: "AGENT" },
          },
        },
        where: { id: callId },
      });
      expect(call.winningLegId).not.toBeNull();
      expect([firstLegId, secondLegId]).toContain(call.winningLegId!);
      expect(call.legs.filter(({ status }) => status === "BRIDGED")).toHaveLength(1);
      expect(call.legs.filter(({ status }) => status === "ENDED")).toHaveLength(1);
      expect(
        await prisma.providerWebhookEvent.count({
          where: {
            id: { in: [firstBridge.id, secondBridge.id] },
            processingStatus: "PROCESSED",
          },
        }),
      ).toBe(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("projects unrelated existing calls without waiting for the practice lock", async () => {
    const fixture = await createFixture(prisma);
    const first = await fixture.createOutboundCall("unrelated-first");
    const second = await fixture.createOutboundCall("unrelated-second");
    const firstEvent = await fixture.processingEvent("call.initiated", "unrelated-first");
    const secondEvent = await fixture.processingEvent(
      "call.initiated",
      "unrelated-second",
    );
    let releasePracticeLock = () => {};
    const holdPracticeLock = new Promise<void>((resolve) => {
      releasePracticeLock = resolve;
    });
    let practiceLockAcquired = () => {};
    const practiceLocked = new Promise<void>((resolve) => {
      practiceLockAcquired = resolve;
    });

    const blocker = prisma.$transaction(
      async (transaction) => {
        await lockCallCenterPractice(transaction, fixture.practiceId);
        practiceLockAcquired();
        await holdPracticeLock;
      },
      { timeout: 10_000 },
    );

    try {
      await practiceLocked;
      const projections = Promise.all([
        projector.projectAndComplete(
          firstEvent,
          fixture.fact({
            canonicalCallId: first.callId,
            canonicalLegId: first.legId,
            direction: "OUTBOUND",
            endpointId: fixture.endpointId,
            eventType: "call.initiated",
            legKind: "AGENT",
            providerCallControlId: fixture.id("unrelated-first-control"),
            providerCallLegId: fixture.id("unrelated-first-provider-leg"),
            providerCallSessionId: fixture.id("unrelated-first-session"),
            providerEventId: firstEvent.providerEventId,
          }),
          projectedAt,
        ),
        projector.projectAndComplete(
          secondEvent,
          fixture.fact({
            canonicalCallId: second.callId,
            canonicalLegId: second.legId,
            direction: "OUTBOUND",
            endpointId: fixture.endpointId,
            eventType: "call.initiated",
            legKind: "AGENT",
            providerCallControlId: fixture.id("unrelated-second-control"),
            providerCallLegId: fixture.id("unrelated-second-provider-leg"),
            providerCallSessionId: fixture.id("unrelated-second-session"),
            providerEventId: secondEvent.providerEventId,
          }),
          projectedAt,
        ),
      ]);
      const completedBeforeRelease = await Promise.race([
        projections.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]);
      expect(completedBeforeRelease).toBe(true);
      await projections;
    } finally {
      releasePracticeLock();
      await blocker;
      await fixture.cleanup();
    }
  });

  it("converges duplicate and reordered customer facts without reopening terminal state", async () => {
    const fixture = await createFixture(prisma);
    const hangup = await fixture.processingEvent("call.hangup", "hangup-first");

    try {
      const hangupResult = await projector.projectAndComplete(
        hangup,
        fixture.fact({
          eventType: "call.hangup",
          fromPhone: fixture.callerPhone,
          hangupCauseCode: "NORMAL_CLEARING",
          providerEventId: hangup.providerEventId,
          toAddress: fixture.practicePhone,
          toPhone: fixture.practicePhone,
        }),
        projectedAt,
      );
      expect(hangupResult).toMatchObject({
        callStatus: "ABANDONED",
        legStatus: "ENDED",
      });

      const initiated = await fixture.processingEvent("call.initiated", "initiated-late");
      const lateInitiatedFact = fixture.fact({
        fromPhone: fixture.callerPhone,
        occurredAt: new Date("2026-07-20T09:59:59.000Z"),
        providerEventId: initiated.providerEventId,
        toAddress: fixture.practicePhone,
        toPhone: fixture.practicePhone,
      });
      await expect(
        projector.projectAndComplete(
          initiated,
          lateInitiatedFact,
          new Date("2026-07-20T10:00:02.000Z"),
        ),
      ).resolves.toMatchObject({
        callId: hangupResult.callId,
        callStatus: "ABANDONED",
        legId: hangupResult.legId,
        legStatus: "ENDED",
      });
      await prisma.providerWebhookEvent.update({
        data: {
          attemptCount: 2,
          processedAt: null,
          processingStatus: "PROCESSING",
        },
        where: { id: initiated.id },
      });
      await expect(
        projector.projectAndComplete(
          { ...initiated, attemptCount: 2 },
          lateInitiatedFact,
          new Date("2026-07-20T10:00:03.000Z"),
        ),
      ).resolves.toMatchObject({
        callId: hangupResult.callId,
        callStatus: "ABANDONED",
        legId: hangupResult.legId,
        legStatus: "ENDED",
      });

      expect(
        await prisma.callCenterCall.findMany({
          include: { legs: true },
          where: { practiceId: fixture.practiceId },
        }),
      ).toMatchObject([
        {
          id: hangupResult.callId,
          legs: [{ id: hangupResult.legId, status: "ENDED" }],
          status: "ABANDONED",
        },
      ]);
      expect(
        await prisma.callCenterEvent.count({
          where: {
            aggregateId: hangupResult.callId,
            idempotencyKey: { startsWith: "telnyx:" },
          },
        }),
      ).toBe(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("settles, replays, and rejects exact media command callbacks", async () => {
    const fixture = await createFixture(prisma);
    const { callId, legId } = await fixture.createOutboundCall("hold");
    const startCommandId = fixture.id("start-hold-command");

    try {
      await prisma.callCenterCallLeg.update({
        data: {
          answeredAt: occurredAt,
          bridgedAt: occurredAt,
          providerCallControlId: fixture.id("hold-control"),
          providerCallLegId: fixture.id("hold-provider-leg"),
          status: "BRIDGED",
        },
        where: { id: legId },
      });
      await prisma.callCenterCall.update({
        data: {
          answeredAt: occurredAt,
          status: "CONNECTED",
          winningLegId: legId,
        },
        where: { id: callId },
      });
      await prisma.callCenterCommand.create({
        data: {
          attemptCount: 1,
          callId,
          id: startCommandId,
          idempotencyKey: fixture.id("start-hold-key"),
          legId,
          practiceId: fixture.practiceId,
          status: "SENT",
          type: "START_HOLD_MUSIC",
        },
      });

      const started = await fixture.processingEvent(
        "call.playback.started",
        "hold-started",
      );
      await projector.projectAndComplete(
        started,
        fixture.fact({
          canonicalCallId: callId,
          canonicalLegId: legId,
          direction: "OUTBOUND",
          endpointId: fixture.endpointId,
          eventType: "call.playback.started",
          legKind: "AGENT",
          providerCallControlId: fixture.id("hold-control"),
          providerCallLegId: fixture.id("hold-provider-leg"),
          providerCommandId: startCommandId,
          providerCommandIdSource: "PAYLOAD",
          providerEventId: started.providerEventId,
        }),
        projectedAt,
      );
      expect(
        await prisma.callCenterCommand.findUniqueOrThrow({
          where: { id: startCommandId },
        }),
      ).toMatchObject({ errorCode: null, status: "CONFIRMED" });

      const failed = await fixture.processingEvent("call.playback.ended", "hold-failed");
      const failedFact = fixture.fact({
        canonicalCallId: callId,
        canonicalLegId: legId,
        direction: "OUTBOUND",
        endpointId: fixture.endpointId,
        eventType: "call.playback.ended",
        legKind: "AGENT",
        playbackStatus: "failed",
        providerCallControlId: fixture.id("hold-control"),
        providerCallLegId: fixture.id("hold-provider-leg"),
        providerCommandId: startCommandId,
        providerCommandIdSource: "PAYLOAD",
        providerEventId: failed.providerEventId,
      });
      await expect(
        projector.projectAndComplete(failed, failedFact, projectedAt),
      ).resolves.toMatchObject({
        callStatus: "CONNECTED",
        legStatus: "BRIDGED",
      });
      await prisma.providerWebhookEvent.update({
        data: {
          attemptCount: 2,
          processedAt: null,
          processingStatus: "PROCESSING",
        },
        where: { id: failed.id },
      });
      await expect(
        projector.projectAndComplete(
          { ...failed, attemptCount: 2 },
          failedFact,
          projectedAt,
        ),
      ).resolves.toMatchObject({
        callStatus: "CONNECTED",
        legStatus: "BRIDGED",
      });
      expect(
        await prisma.callCenterCommand.findUniqueOrThrow({
          where: { id: startCommandId },
        }),
      ).toMatchObject({
        errorCode: "PROVIDER_PLAYBACK_FAILED",
        status: "FAILED",
      });

      const wrongTypeCommandId = fixture.id("wrong-hold-command");
      await prisma.callCenterCommand.create({
        data: {
          attemptCount: 1,
          callId,
          id: wrongTypeCommandId,
          idempotencyKey: fixture.id("wrong-hold-key"),
          legId,
          practiceId: fixture.practiceId,
          status: "SENT",
          type: "STOP_HOLD_MUSIC",
        },
      });
      const wrongType = await fixture.processingEvent(
        "call.playback.started",
        "wrong-hold-type",
      );
      await expect(
        projector.projectAndComplete(
          wrongType,
          {
            ...failedFact,
            eventType: "call.playback.started",
            playbackStatus: null,
            providerCommandId: wrongTypeCommandId,
            providerEventId: wrongType.providerEventId,
          },
          projectedAt,
        ),
      ).rejects.toEqual(new CanonicalProjectionError("CANONICAL_COMMAND_LINK_MISMATCH"));

      const missingId = await fixture.processingEvent(
        "call.playback.started",
        "missing-hold-command",
      );
      await expect(
        projector.projectAndComplete(
          missingId,
          {
            ...failedFact,
            eventType: "call.playback.started",
            playbackStatus: null,
            providerCommandId: null,
            providerCommandIdSource: null,
            providerEventId: missingId.providerEventId,
          },
          projectedAt,
        ),
      ).rejects.toEqual(new CanonicalProjectionError("CANONICAL_COMMAND_ID_MISSING"));

      await prisma.callCenterCommand.createMany({
        data: ["first", "second"].map((suffix) => ({
          attemptCount: 1,
          callId,
          id: fixture.id(`ambiguous-dial-${suffix}`),
          idempotencyKey: fixture.id(`ambiguous-dial-key-${suffix}`),
          legId,
          practiceId: fixture.practiceId,
          status: "SENT" as const,
          type: "DIAL_AGENT" as const,
        })),
      });
      const ambiguous = await fixture.processingEvent("call.answered", "ambiguous-dial");
      await expect(
        projector.projectAndComplete(
          ambiguous,
          {
            ...failedFact,
            eventType: "call.answered",
            playbackStatus: null,
            providerCommandId: null,
            providerCommandIdSource: null,
            providerEventId: ambiguous.providerEventId,
          },
          projectedAt,
        ),
      ).rejects.toEqual(
        new CanonicalProjectionError("CANONICAL_COMMAND_CORRELATION_AMBIGUOUS"),
      );

      const other = await fixture.createOutboundCall("other-boundary");
      const otherCommandId = fixture.id("other-boundary-command");
      await prisma.callCenterCommand.create({
        data: {
          attemptCount: 1,
          callId: other.callId,
          id: otherCommandId,
          idempotencyKey: fixture.id("other-boundary-command-key"),
          legId: other.legId,
          practiceId: fixture.practiceId,
          status: "SENT",
          type: "START_HOLD_MUSIC",
        },
      });
      const crossBoundary = await fixture.processingEvent(
        "call.playback.started",
        "cross-boundary-command",
      );
      await expect(
        projector.projectAndComplete(
          crossBoundary,
          {
            ...failedFact,
            eventType: "call.playback.started",
            playbackStatus: null,
            providerCommandId: otherCommandId,
            providerEventId: crossBoundary.providerEventId,
          },
          projectedAt,
        ),
      ).rejects.toEqual(new CanonicalProjectionError("CANONICAL_COMMAND_LINK_MISMATCH"));
    } finally {
      await fixture.cleanup();
    }
  });

  it("settles voicemail callbacks and persists one recording from committed commands", async () => {
    const fixture = await createFixture(prisma);

    try {
      const { greeting, initial, recordingCommandId } = await prepareVoicemailRecording(
        prisma,
        projector,
        fixture,
      );
      expect(
        await prisma.callCenterCommand.findUniqueOrThrow({
          where: { id: recordingCommandId },
        }),
      ).toMatchObject({
        callId: initial.callId,
        dependsOnCommandId: greeting.id,
        legId: initial.legId,
        status: "SENT",
        type: "START_RECORDING",
      });

      const recordingSaved = await fixture.processingEvent(
        "call.recording.saved",
        "recording-saved",
      );
      await expect(
        projector.projectAndComplete(
          recordingSaved,
          fixture.fact({
            canonicalCallId: initial.callId,
            canonicalLegId: initial.legId,
            eventType: "call.recording.saved",
            fromPhone: fixture.callerPhone,
            providerCommandId: recordingCommandId,
            providerCommandIdSource: "PAYLOAD",
            providerEventId: recordingSaved.providerEventId,
            recordingDurationSec: 17,
            recordingId: fixture.id("recording"),
            recordingUrl: "https://example.test/voicemail.mp3",
            toAddress: fixture.practicePhone,
            toPhone: fixture.practicePhone,
          }),
          new Date("2026-07-20T10:00:03.000Z"),
        ),
      ).resolves.toMatchObject({
        callId: initial.callId,
        callStatus: "VOICEMAIL",
        legId: initial.legId,
        legStatus: "ENDED",
      });

      expect(
        await prisma.callCenterCommand.findMany({
          orderBy: { createdAt: "asc" },
          where: { id: { in: [greeting.id, recordingCommandId] } },
        }),
      ).toMatchObject([
        { id: greeting.id, status: "CONFIRMED" },
        { id: recordingCommandId, status: "CONFIRMED" },
      ]);
      expect(
        await prisma.callCenterVoicemail.findUniqueOrThrow({
          where: { callCenterCallId: initial.callId },
        }),
      ).toMatchObject({
        durationSec: 17,
        recordingId: fixture.id("recording"),
        recordingUrl: "https://example.test/voicemail.mp3",
      });
      expect(
        await prisma.providerWebhookEvent.findUniqueOrThrow({
          where: { id: recordingSaved.id },
        }),
      ).toMatchObject({
        processingStatus: "PROCESSED",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps a failed recording callback recoverable without creating voicemail", async () => {
    const fixture = await createFixture(prisma);

    try {
      const { initial, recordingCommandId } = await prepareVoicemailRecording(
        prisma,
        projector,
        fixture,
      );
      const recordingError = await fixture.processingEvent(
        "call.recording.error",
        "recording-error",
      );
      await expect(
        projector.projectAndComplete(
          recordingError,
          fixture.fact({
            canonicalCallId: initial.callId,
            canonicalLegId: initial.legId,
            eventType: "call.recording.error",
            fromPhone: fixture.callerPhone,
            providerCommandId: recordingCommandId,
            providerCommandIdSource: "PAYLOAD",
            providerEventId: recordingError.providerEventId,
            toAddress: fixture.practicePhone,
            toPhone: fixture.practicePhone,
          }),
          new Date("2026-07-20T10:00:03.000Z"),
        ),
      ).resolves.toMatchObject({
        callId: initial.callId,
        callStatus: "VOICEMAIL",
        legId: initial.legId,
        legStatus: "ANSWERED",
      });
      expect(
        await prisma.callCenterCommand.findUniqueOrThrow({
          where: { id: recordingCommandId },
        }),
      ).toMatchObject({
        errorCode: "PROVIDER_CALLBACK_FAILED",
        status: "FAILED",
      });
      expect(
        await prisma.callCenterVoicemail.count({
          where: { callCenterCallId: initial.callId },
        }),
      ).toBe(0);
      expect(
        await prisma.callCenterCall.findUniqueOrThrow({
          where: { id: initial.callId },
        }),
      ).toMatchObject({
        deadlineAt: occurredAt,
        status: "VOICEMAIL",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("rolls back every voicemail mutation when checkpoint completion fails", async () => {
    const fixture = await createFixture(prisma);

    try {
      const { initial, recordingCommandId } = await prepareVoicemailRecording(
        prisma,
        projector,
        fixture,
      );
      await fixture.createIngressHandoff(initial.callId, "rollback");
      const before = await prisma.callCenterCall.findUniqueOrThrow({
        include: { legs: true, tasks: true },
        where: { id: initial.callId },
      });
      const eventCount = await prisma.callCenterEvent.count({
        where: { aggregateId: initial.callId },
      });
      const event = await fixture.processingEvent(
        "call.recording.saved",
        "rollback-recording",
      );

      await expect(
        projector.projectAndComplete(
          { ...event, attemptCount: 2 },
          fixture.fact({
            canonicalCallId: initial.callId,
            canonicalLegId: initial.legId,
            eventType: "call.recording.saved",
            fromPhone: fixture.callerPhone,
            providerCommandId: recordingCommandId,
            providerCommandIdSource: "PAYLOAD",
            providerEventId: event.providerEventId,
            recordingDurationSec: 23,
            recordingId: fixture.id("rollback-recording"),
            recordingUrl: "https://example.test/rollback.mp3",
            toAddress: fixture.practicePhone,
            toPhone: fixture.practicePhone,
          }),
          projectedAt,
        ),
      ).rejects.toEqual(new CanonicalProjectionError("CANONICAL_CLAIM_LOST"));

      expect(
        await prisma.callCenterCall.findUniqueOrThrow({
          include: { legs: true, tasks: true },
          where: { id: initial.callId },
        }),
      ).toMatchObject({
        deadlineAt: before.deadlineAt,
        legs: [{ id: initial.legId, status: "ANSWERED" }],
        status: "VOICEMAIL",
        tasks: before.tasks,
      });
      expect(
        await prisma.callCenterCommand.findUniqueOrThrow({
          where: { id: recordingCommandId },
        }),
      ).toMatchObject({
        status: "SENT",
      });
      expect(
        await prisma.callCenterVoicemail.count({
          where: { callCenterCallId: initial.callId },
        }),
      ).toBe(0);
      expect(
        await prisma.callCenterHandoff.findUniqueOrThrow({
          where: { callId: initial.callId },
        }),
      ).toMatchObject({
        connectedAt: null,
        failedAt: null,
        failureCode: null,
        status: "INGRESS_SEEN",
      });
      expect(
        await prisma.callCenterEvent.count({
          where: { aggregateId: initial.callId },
        }),
      ).toBe(eventCount);
      expect(
        await prisma.providerWebhookEvent.findUniqueOrThrow({
          where: { id: event.id },
        }),
      ).toMatchObject({
        processedAt: null,
        processingStatus: "PROCESSING",
      });
    } finally {
      await fixture.cleanup();
    }
  });
});

async function prepareVoicemailRecording(
  prisma: PrismaClient,
  projector: CanonicalCallProjector,
  fixture: Fixture,
) {
  const initiated = await fixture.processingEvent("call.initiated", "voicemail");
  const initial = await projector.projectAndComplete(
    initiated,
    fixture.fact({
      fromPhone: fixture.callerPhone,
      providerEventId: initiated.providerEventId,
      toAddress: fixture.practicePhone,
      toPhone: fixture.practicePhone,
    }),
    projectedAt,
  );
  const greeting = await prisma.callCenterCommand.findFirstOrThrow({
    where: {
      callId: initial.callId,
      type: "PLAY_VOICEMAIL_GREETING",
    },
  });
  await prisma.callCenterCommand.update({
    data: { attemptCount: 1, status: "SENT" },
    where: { id: greeting.id },
  });

  const greetingEnded = await fixture.processingEvent(
    "call.speak.ended",
    "greeting-ended",
  );
  const recordingProjection = await projector.projectAndComplete(
    greetingEnded,
    fixture.fact({
      canonicalCallId: initial.callId,
      canonicalLegId: initial.legId,
      eventType: "call.speak.ended",
      fromPhone: fixture.callerPhone,
      providerCommandId: greeting.id,
      providerCommandIdSource: "PAYLOAD",
      providerEventId: greetingEnded.providerEventId,
      toAddress: fixture.practicePhone,
      toPhone: fixture.practicePhone,
    }),
    new Date("2026-07-20T10:00:02.000Z"),
  );
  if (recordingProjection.commandIds.length !== 1) {
    throw new Error("voicemail projection did not create one recording command");
  }
  const recordingCommandId = recordingProjection.commandIds[0]!;
  await prisma.callCenterCommand.update({
    data: { attemptCount: 1, status: "SENT" },
    where: { id: recordingCommandId },
  });
  return { greeting, initial, recordingCommandId };
}

async function createFixture(prisma: PrismaClient) {
  const key = randomUUID().replaceAll("-", "");
  const id = (prefix: string) => `${prefix}-${key}`;
  const practiceId = id("practice");
  const locationId = id("location");
  const phoneId = id("phone");
  const numberId = id("number");
  const queueId = id("queue");
  const endpointId = id("endpoint");
  const callerPhone = `+1212${key.slice(0, 7).replace(/[a-f]/g, "1")}`;
  const practicePhone = `+1310${key.slice(0, 7).replace(/[a-f]/g, "2")}`;
  const userIds: string[] = [];

  await prisma.practice.create({
    data: { id: practiceId, name: `Projector ${key}` },
  });
  await prisma.practiceLocation.create({
    data: { id: locationId, name: "Projector location", practiceId },
  });
  await prisma.practicePhoneNumber.create({
    data: { id: phoneId, locationId, phoneNumber: practicePhone, practiceId },
  });
  await prisma.callCenterQueue.create({
    data: {
      id: queueId,
      name: "Projector queue",
      practiceId,
      voicemailGreeting: "Please leave a message.",
    },
  });
  await prisma.callCenterQueueLocation.create({
    data: { locationId, queueId },
  });
  await prisma.callCenterNumber.create({
    data: {
      enabled: true,
      id: numberId,
      inboundEnabled: true,
      inboundQueueId: queueId,
      outboundEnabled: true,
      practiceId,
      practicePhoneNumberId: phoneId,
    },
  });
  await prisma.callCenterEndpoint.create({
    data: {
      id: endpointId,
      label: "Projector endpoint",
      locationId,
      practiceId,
      providerCredentialId: id("credential"),
      sipUsername: id("sip"),
    },
  });

  return {
    callerPhone,
    async cleanup() {
      await prisma.providerWebhookEvent.deleteMany({
        where: { providerEventId: { startsWith: id("provider-event") } },
      });
      await prisma.practice.deleteMany({ where: { id: practiceId } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    },
    endpointId,
    async createEndpoint(suffix: string) {
      const created = await prisma.callCenterEndpoint.create({
        data: {
          id: id(`endpoint-${suffix}`),
          label: `Projector endpoint ${suffix}`,
          locationId,
          practiceId,
          providerCredentialId: id(`credential-${suffix}`),
          sipUsername: id(`sip-${suffix}`),
        },
      });
      return created.id;
    },
    async createIngressHandoff(callId: string, prefix: string) {
      return prisma.callCenterHandoff.create({
        data: {
          callId,
          callerPhone,
          createdAt: occurredAt,
          expiresAt: new Date("2026-07-20T10:05:00.000Z"),
          id: id(`${prefix}-handoff`),
          idempotencyKey: id(`${prefix}-handoff-key`),
          ingressSeenAt: occurredAt,
          numberId,
          practiceId,
          providerCallSessionId: id("session"),
          queueId,
          requestFingerprint: id(`${prefix}-fingerprint`),
          sourceCallId: id(`${prefix}-source-call`),
          sourceSystem: "ABITA",
          status: "INGRESS_SEEN",
          tokenHash: id(`${prefix}-token`),
        },
      });
    },
    async createOutboundCall(prefix: string) {
      const callId = id(`${prefix}-call`);
      const legId = id(`${prefix}-leg`);
      await prisma.callCenterCall.create({
        data: {
          direction: "OUTBOUND",
          fromPhone: practicePhone,
          id: callId,
          numberId,
          practiceId,
          receivedAt: occurredAt,
          status: "RECEIVED",
          toPhone: callerPhone,
        },
      });
      await prisma.callCenterCallLeg.create({
        data: {
          callId,
          endpointId,
          id: legId,
          kind: "AGENT",
          startedAt: occurredAt,
          status: "CREATED",
        },
      });
      return { callId, legId };
    },
    async createReadyAgent() {
      const userId = id("ready-user");
      const sessionId = id("ready-session");
      userIds.push(userId);
      await prisma.user.create({
        data: {
          email: `${key}@example.test`,
          id: userId,
          name: "Ready projector agent",
        },
      });
      await prisma.practiceMembership.create({
        data: { practiceId, userId },
      });
      await prisma.callCenterQueueMember.create({
        data: { queueId, userId },
      });
      await prisma.callCenterEndpoint.update({
        data: { userId },
        where: { id: endpointId },
      });
      await prisma.callCenterAgentSession.create({
        data: {
          audioReady: true,
          browserSessionId: id("browser"),
          connectionState: "READY",
          endpointId,
          id: sessionId,
          lastHeartbeatAt: occurredAt,
          leaseExpiresAt: new Date(occurredAt.getTime() + 60_000),
          microphoneReady: true,
          practiceId,
          presence: "AVAILABLE",
          readyAt: occurredAt,
          userId,
        },
      });
    },
    async createTransfer(prefix: string) {
      const callId = id(`${prefix}-call`);
      const sourceLegId = id(`${prefix}-source-leg`);
      const targetLegId = id(`${prefix}-target-leg`);
      const targetEndpointId = id(`${prefix}-target-endpoint`);
      const commandId = id(`${prefix}-command`);
      const sourceProviderLegId = id(`${prefix}-source-provider-leg`);
      await prisma.callCenterEndpoint.create({
        data: {
          id: targetEndpointId,
          label: `Projector ${prefix} target`,
          locationId,
          practiceId,
          providerCredentialId: id(`${prefix}-target-credential`),
          sipUsername: id(`${prefix}-target-sip`),
        },
      });
      await prisma.callCenterCall.create({
        data: {
          answeredAt: occurredAt,
          direction: "OUTBOUND",
          fromPhone: practicePhone,
          id: callId,
          numberId,
          practiceId,
          receivedAt: occurredAt,
          status: "CONNECTED",
          toPhone: callerPhone,
        },
      });
      await prisma.callCenterCallLeg.createMany({
        data: [
          {
            answeredAt: occurredAt,
            bridgedAt: occurredAt,
            callId,
            endpointId,
            id: sourceLegId,
            kind: "AGENT",
            providerCallControlId: id(`${prefix}-source-control`),
            providerCallLegId: sourceProviderLegId,
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
      await prisma.callCenterCall.update({
        data: { winningLegId: sourceLegId },
        where: { id: callId },
      });
      await prisma.callCenterCommand.create({
        data: {
          arguments: {
            endpointId: targetEndpointId,
            providerSourceLegId: sourceProviderLegId,
            sourceLegId,
          },
          attemptCount: 1,
          callId,
          id: commandId,
          idempotencyKey: id(`${prefix}-command-key`),
          legId: targetLegId,
          practiceId,
          status: "SENT",
          type: "TRANSFER_AGENT",
        },
      });
      return {
        callId,
        commandId,
        sourceLegId,
        sourceProviderLegId,
        targetEndpointId,
        targetLegId,
      };
    },
    fact(overrides: Partial<CanonicalTelnyxCallFact> = {}): CanonicalTelnyxCallFact {
      return {
        callerName: "Patient Name",
        canonicalCallId: null,
        canonicalLegId: null,
        clientQueueItemId: null,
        clientRingAttemptId: null,
        direction: "INBOUND",
        endpointId: null,
        eventType: "call.initiated",
        fromPhone: practicePhone,
        hangupCauseCode: null,
        legKind: "CUSTOMER",
        occurredAt,
        providerCallControlId: id("control"),
        providerCommandId: null,
        providerCommandIdSource: null,
        providerCallLegId: id("provider-leg"),
        providerCallSessionId: id("session"),
        providerEventId: id("provider-event"),
        playbackStatus: null,
        recordingDurationSec: 0,
        recordingId: null,
        recordingUrl: null,
        toAddress: callerPhone,
        toPhone: callerPhone,
        ...overrides,
      };
    },
    id,
    numberId,
    practiceId,
    practicePhone,
    queueId,
    async processingEvent(
      eventType: string,
      suffix = eventType,
    ): Promise<ProviderWebhookRecord> {
      const event = {
        attemptCount: 1,
        directHandoffTokenHash: null,
        errorCode: null,
        eventType,
        id: id(`inbox-${suffix}`),
        nextAttemptAt: null,
        payload: {},
        processedAt: null,
        processingStatus: "PROCESSING" as const,
        providerCallSessionId: id("session"),
        providerEventId: id(`provider-event-${suffix}`),
        receivedAt: occurredAt,
        updatedAt: occurredAt,
      };
      await prisma.providerWebhookEvent.create({
        data: {
          attemptCount: event.attemptCount,
          eventType: event.eventType,
          id: event.id,
          payload: event.payload,
          processingStatus: event.processingStatus,
          provider: "TELNYX",
          providerCallSessionId: event.providerCallSessionId,
          providerEventId: event.providerEventId,
        },
      });
      return event;
    },
  };
}
