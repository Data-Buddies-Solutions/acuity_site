import { Prisma } from "@/generated/prisma/client";
import {
  SetCallHoldMusicError,
  type SetCallHoldMusicInput,
  type SetCallHoldMusicStore,
  type SetCallHoldMusicTransaction,
} from "@/lib/call-center/application/set-call-hold-music";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { resolveQueueAccess } from "@/lib/call-center/auth/queue-access";
import { PrismaOperationReceiptTransaction } from "@/lib/call-center/infrastructure/prisma-operation-receipts";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
const HOLD_MUSIC_CONFIRMATION_TIMEOUT_MS = 5_000;
const HOLD_MUSIC_CONFIRMATION_POLL_MS = 100;

export class PrismaSetCallHoldMusicTransaction implements SetCallHoldMusicTransaction {
  private readonly receipts: PrismaOperationReceiptTransaction;

  constructor(private readonly transaction: Transaction) {
    this.receipts = new PrismaOperationReceiptTransaction(transaction);
  }

  appendReceipt(
    ...input: Parameters<PrismaOperationReceiptTransaction["appendReceipt"]>
  ) {
    return this.receipts.appendReceipt(...input);
  }

  findReceipt(...input: Parameters<PrismaOperationReceiptTransaction["findReceipt"]>) {
    return this.receipts.findReceipt(...input);
  }

  lockReceiptKey(
    ...input: Parameters<PrismaOperationReceiptTransaction["lockReceiptKey"]>
  ) {
    return this.receipts.lockReceiptKey(...input);
  }

  async createHoldMusicCommand(
    actor: QueueAccessActor,
    input: SetCallHoldMusicInput,
    now: Date,
  ) {
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "id" = ${input.callId} AND "practiceId" = ${actor.practiceId} FOR UPDATE`,
    );
    const call = await this.transaction.callCenterCall.findFirst({
      select: {
        direction: true,
        effectOwner: true,
        id: true,
        legs: {
          orderBy: [{ startedAt: "asc" }, { id: "asc" }],
          select: {
            agentSession: { select: { userId: true } },
            endpoint: { select: { locationId: true, userId: true } },
            id: true,
            kind: true,
            providerCallControlId: true,
            status: true,
          },
          where: {
            agentSession: { userId: actor.userId },
            kind: "AGENT",
            status: { in: ["ANSWERED", "BRIDGED"] },
          },
        },
        number: {
          select: { practicePhoneNumber: { select: { locationId: true } } },
        },
        practiceId: true,
        queueId: true,
        stateVersion: true,
        status: true,
        winningLegId: true,
      },
      where: { id: input.callId, practiceId: actor.practiceId },
    });
    if (!call || call.effectOwner !== "CANONICAL") {
      throw new SetCallHoldMusicError("Canonical call not found", 404);
    }
    if (call.queueId) {
      await resolveQueueAccess(actor, call.queueId, this.transaction);
    }
    const locationId = call.number.practicePhoneNumber.locationId;
    if (
      !actor.hasAllLocationAccess &&
      (!locationId || !actor.allowedLocationIds.includes(locationId))
    ) {
      throw new SetCallHoldMusicError("Canonical call not found", 404);
    }
    if (call.stateVersion !== input.expectedStateVersion) {
      throw new SetCallHoldMusicError("Call changed; refresh and try again", 409);
    }
    if (call.status !== "CONNECTED") {
      throw new SetCallHoldMusicError("Call is not connected", 409);
    }
    const leg = call.legs.length === 1 ? call.legs[0] : null;
    if (
      !leg ||
      leg.kind !== "AGENT" ||
      leg.agentSession?.userId !== actor.userId ||
      leg.endpoint?.userId !== actor.userId ||
      !leg.providerCallControlId ||
      (call.direction === "INBOUND" &&
        (call.winningLegId !== leg.id || leg.status !== "BRIDGED"))
    ) {
      throw new SetCallHoldMusicError("Call is not connected", 409);
    }
    if (
      !actor.hasAllLocationAccess &&
      (!leg.endpoint.locationId ||
        !actor.allowedLocationIds.includes(leg.endpoint.locationId))
    ) {
      throw new SetCallHoldMusicError("Canonical call not found", 404);
    }

    const latest = await this.transaction.callCenterCommand.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true, type: true },
      where: {
        callId: call.id,
        type: { in: ["START_HOLD_MUSIC", "STOP_HOLD_MUSIC"] },
      },
    });
    if (
      input.action === "START" &&
      latest?.status !== "FAILED" &&
      latest?.type === "START_HOLD_MUSIC"
    ) {
      throw new SetCallHoldMusicError("Call hold state changed", 409);
    }

    const type = input.action === "START" ? "START_HOLD_MUSIC" : "STOP_HOLD_MUSIC";
    const supersedeUncertainCommand =
      input.action === "STOP" && latest?.status === "SENDING";
    if (supersedeUncertainCommand) {
      await this.transaction.callCenterCommand.updateMany({
        data: {
          errorCode: "COMMAND_SUPERSEDED",
          status: "FAILED",
          updatedAt: now,
        },
        where: { id: latest.id, status: "SENDING" },
      });
    }
    const command = await this.transaction.callCenterCommand.create({
      data: {
        arguments: {},
        callId: call.id,
        dependsOnCommandId:
          input.action === "STOP" || latest?.status === "FAILED" ? null : latest?.id,
        idempotencyKey: `hold-music:${input.idempotencyKey}`,
        legId: leg.id,
        practiceId: actor.practiceId,
        type,
      },
      select: { id: true },
    });
    return {
      action: input.action,
      callId: call.id,
      commandId: command.id,
      operationType: "HOLD_MUSIC" as const,
      status: "QUEUED" as const,
    };
  }
}

export class PrismaSetCallHoldMusicStore implements SetCallHoldMusicStore {
  constructor(
    private readonly run = <T>(operation: (transaction: Transaction) => Promise<T>) =>
      prisma.$transaction(operation),
  ) {}

  async waitForCommandSettlement(commandId: string) {
    const deadline = Date.now() + HOLD_MUSIC_CONFIRMATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const command = await prisma.callCenterCommand.findUnique({
        select: { status: true },
        where: { id: commandId },
      });
      if (!command || command.status === "FAILED") return "FAILED" as const;
      if (command.status === "CONFIRMED") return "CONFIRMED" as const;
      await new Promise((resolve) =>
        setTimeout(resolve, HOLD_MUSIC_CONFIRMATION_POLL_MS),
      );
    }
    return "TIMEOUT" as const;
  }

  transaction<T>(operation: (transaction: SetCallHoldMusicTransaction) => Promise<T>) {
    return this.run((transaction) =>
      operation(new PrismaSetCallHoldMusicTransaction(transaction)),
    );
  }
}

export const prismaSetCallHoldMusicStore = new PrismaSetCallHoldMusicStore();
