import { Prisma } from "@/generated/prisma/client";
import type { ProviderCommandDispatchStore } from "@/lib/call-center/application/dispatch-provider-command";
import {
  decideProviderCommandMarkSent,
  type ProviderCommandClaim,
} from "@/lib/call-center/domain/provider-command";
import { releaseAgentSessionReservation } from "@/lib/call-center/infrastructure/prisma-agent-session-reservation";
import { appendCommandOperationStatus } from "@/lib/call-center/infrastructure/prisma-command-operation-events";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
export type ProviderCommandTransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;
export type ProviderCommandPrismaDelegate = Pick<
  typeof prisma.callCenterCommand,
  "findMany" | "findUnique" | "updateMany"
>;

function commandArguments(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { agentSessionId, endpointId } = value as Record<string, unknown>;
  return typeof agentSessionId === "string" && typeof endpointId === "string"
    ? { agentSessionId, endpointId }
    : null;
}

function sipUri(username: string) {
  if (username.startsWith("sip:")) return username;
  return username.includes("@") ? `sip:${username}` : `sip:${username}@sip.telnyx.com`;
}

function isClaimable(
  command: {
    attemptCount: number;
    nextAttemptAt: Date | null;
    status: "PENDING" | "SENDING" | "SENT" | "CONFIRMED" | "FAILED";
    updatedAt: Date;
  },
  input: { maxAttempts: number; now: Date; staleBefore: Date },
) {
  if (command.attemptCount >= input.maxAttempts) return false;
  if (command.status === "PENDING") return true;
  if (command.status === "FAILED") {
    return Boolean(command.nextAttemptAt && command.nextAttemptAt <= input.now);
  }
  return command.status === "SENDING" && command.updatedAt <= input.staleBefore;
}

async function rejectDialAgentClaim(
  transaction: Transaction,
  command: {
    attemptCount: number;
    callId: string;
    id: string;
    leg: { agentSessionId: string | null; id: string } | null;
    practiceId: string;
    status: "PENDING" | "SENDING" | "SENT" | "CONFIRMED" | "FAILED";
  },
  errorCode: string,
  now: Date,
  rejectLeg = false,
) {
  const rejected = await transaction.callCenterCommand.updateMany({
    data: { errorCode, nextAttemptAt: null, status: "FAILED", updatedAt: now },
    where: {
      attemptCount: command.attemptCount,
      id: command.id,
      status: command.status,
    },
  });
  if (rejected.count !== 1) return null;

  const leg = rejectLeg ? command.leg : null;
  if (leg) {
    await transaction.callCenterCallLeg.updateMany({
      data: { errorCode, status: "FAILED" },
      where: {
        id: leg.id,
        status: { in: ["CREATED", "DIALING", "RINGING"] },
      },
    });
    await transaction.callCenterCall.update({
      data: { stateVersion: { increment: 1 } },
      where: { id: command.callId },
    });
    await transaction.callCenterEvent.create({
      data: {
        aggregateId: command.callId,
        aggregateType: "CALL",
        data: { commandId: command.id, errorCode, legId: leg.id },
        idempotencyKey: `${command.id}:claim-rejected`,
        occurredAt: now,
        practiceId: command.practiceId,
        type: "CALL_AGENT_DIAL_FAILED",
      },
    });
    if (leg.agentSessionId) {
      await releaseAgentSessionReservation(transaction, {
        agentSessionId: leg.agentSessionId,
        callId: command.callId,
        idempotencyKey: `${command.id}:release`,
        now,
        reason: errorCode,
      });
    }
  }
  await appendCommandOperationStatus(transaction, {
    attemptCount: command.attemptCount,
    commandId: command.id,
    now,
    status: "FAILED",
  });
  return null;
}

async function loadDialAgentClaim(
  tx: Transaction,
  commandId: string,
  input: { maxAttempts: number; now: Date; staleBefore: Date },
): Promise<ProviderCommandClaim | null> {
  const target = await tx.callCenterCommand.findUnique({
    select: { callId: true },
    where: { id: commandId },
  });
  if (!target) return null;
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "id" = ${target.callId} FOR UPDATE`,
  );
  const callTarget = await tx.callCenterCall.findUnique({
    select: { queueId: true },
    where: { id: target.callId },
  });
  if (!callTarget) return null;
  if (callTarget.queueId) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_queue" WHERE "id" = ${callTarget.queueId} FOR UPDATE`,
    );
  }
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_command" WHERE "id" = ${commandId} FOR UPDATE`,
  );
  const command = await tx.callCenterCommand.findUnique({
    include: {
      call: {
        include: {
          number: { include: { practicePhoneNumber: true } },
          queue: {
            select: {
              id: true,
              enabled: true,
              locations: { select: { locationId: true } },
              members: {
                select: { userId: true },
                where: { enabled: true, role: "AGENT" },
              },
              ringTimeoutSec: true,
              routingMode: true,
            },
          },
        },
      },
      leg: { include: { agentSession: true, endpoint: true } },
      practice: { include: { callCenterSettings: true } },
    },
    where: { id: commandId },
  });
  if (!command || !isClaimable(command, input)) return null;
  if (command.type !== "DIAL_AGENT") {
    return rejectDialAgentClaim(tx, command, "COMMAND_TYPE_UNSUPPORTED", input.now);
  }
  const args = commandArguments(command.arguments);
  const leg = command.leg;
  if (
    !args ||
    !leg ||
    leg.kind !== "AGENT" ||
    leg.callId !== command.callId ||
    leg.endpointId !== args.endpointId ||
    leg.agentSessionId !== args.agentSessionId
  ) {
    return rejectDialAgentClaim(tx, command, "COMMAND_AGENT_LEG_INVALID", input.now);
  }
  if (!command.call.queue?.enabled || command.call.queue.routingMode !== "ACTIVE") {
    return rejectDialAgentClaim(tx, command, "COMMAND_QUEUE_NOT_ACTIVE", input.now, true);
  }
  if (["COMPLETED", "VOICEMAIL", "ABANDONED", "FAILED"].includes(command.call.status)) {
    return rejectDialAgentClaim(tx, command, "COMMAND_CALL_TERMINAL", input.now, true);
  }
  const endpoint = leg.endpoint;
  const session = leg.agentSession;
  const settings = command.practice.callCenterSettings;
  if (!endpoint?.enabled || !endpoint.sipUsername || !settings?.enabled) {
    return rejectDialAgentClaim(
      tx,
      command,
      "COMMAND_PROVIDER_TARGET_INVALID",
      input.now,
      true,
    );
  }
  if (
    !session ||
    session.id !== args.agentSessionId ||
    session.endpointId !== args.endpointId ||
    session.currentCallId !== command.callId ||
    session.connectionState !== "READY" ||
    session.presence !== "BUSY" ||
    !session.microphoneReady ||
    !session.audioReady ||
    session.leaseExpiresAt <= input.now
  ) {
    return rejectDialAgentClaim(
      tx,
      command,
      "COMMAND_AGENT_SESSION_NOT_READY",
      input.now,
      true,
    );
  }
  if (!command.call.queue.members.some(({ userId }) => userId === session.userId)) {
    return rejectDialAgentClaim(
      tx,
      command,
      "COMMAND_AGENT_MEMBERSHIP_INVALID",
      input.now,
      true,
    );
  }
  const practiceMembership = await tx.practiceMembership.findUnique({
    select: {
      locationScope: true,
      locations: {
        select: { locationId: true },
        where: { location: { practiceId: command.practiceId } },
      },
    },
    where: {
      practiceId_userId: {
        practiceId: command.practiceId,
        userId: session.userId,
      },
    },
  });
  const allowedLocationIds = new Set(
    practiceMembership?.locations.map(({ locationId }) => locationId) ?? [],
  );
  const queueLocationIds = new Set(
    command.call.queue.locations.map(({ locationId }) => locationId),
  );
  const numberLocationId = command.call.number.practicePhoneNumber.locationId;
  if (
    !practiceMembership ||
    (practiceMembership.locationScope === "SELECTED" &&
      (!endpoint.locationId ||
        !allowedLocationIds.has(endpoint.locationId) ||
        !numberLocationId ||
        !allowedLocationIds.has(numberLocationId)))
  ) {
    return rejectDialAgentClaim(
      tx,
      command,
      "COMMAND_AGENT_LOCATION_ACCESS_INVALID",
      input.now,
      true,
    );
  }
  if (
    queueLocationIds.size > 0 &&
    (!endpoint.locationId ||
      !queueLocationIds.has(endpoint.locationId) ||
      !numberLocationId ||
      !queueLocationIds.has(numberLocationId))
  ) {
    return rejectDialAgentClaim(
      tx,
      command,
      "COMMAND_LOCATION_SCOPE_INVALID",
      input.now,
      true,
    );
  }
  const connectionId = settings.telnyxConnectionId?.trim();
  const from = command.call.number.practicePhoneNumber.phoneNumber.trim();
  if (!connectionId || !from) {
    return rejectDialAgentClaim(
      tx,
      command,
      "COMMAND_PROVIDER_CONFIGURATION_INVALID",
      input.now,
      true,
    );
  }
  const customerLegs = await tx.callCenterCallLeg.findMany({
    orderBy: { startedAt: "asc" },
    select: { providerCallControlId: true },
    take: 2,
    where: {
      callId: command.callId,
      kind: "CUSTOMER",
      providerCallControlId: { not: null },
    },
  });
  if (customerLegs.length !== 1 || !customerLegs[0]?.providerCallControlId) {
    return rejectDialAgentClaim(
      tx,
      command,
      "COMMAND_CUSTOMER_LEG_AMBIGUOUS",
      input.now,
      true,
    );
  }

  const claimed = await tx.callCenterCommand.update({
    data: {
      attemptCount: { increment: 1 },
      errorCode: null,
      nextAttemptAt: null,
      status: "SENDING",
    },
    select: { attemptCount: true },
    where: { id: command.id },
  });
  return {
    attemptCount: claimed.attemptCount,
    command: {
      arguments: args,
      callId: command.callId,
      commandId: command.id,
      idempotencyKey: command.idempotencyKey,
      legId: leg.id,
      practiceId: command.practiceId,
      provider: {
        connectionId,
        from,
        linkTo: customerLegs[0].providerCallControlId,
        sipUri: sipUri(endpoint.sipUsername.trim()),
        timeoutSeconds: command.call.queue.ringTimeoutSec,
      },
      type: "DIAL_AGENT",
    },
  };
}

export class PrismaProviderCommandStore implements ProviderCommandDispatchStore {
  constructor(
    private readonly runTransaction: ProviderCommandTransactionRunner = (operation) =>
      prisma.$transaction(operation),
    private readonly commands: ProviderCommandPrismaDelegate = prisma.callCenterCommand,
  ) {}

  claim(input: { commandId: string; maxAttempts: number; now: Date; staleBefore: Date }) {
    return this.runTransaction((tx) => loadDialAgentClaim(tx, input.commandId, input));
  }

  async fail(input: {
    attemptCount: number;
    commandId: string;
    errorCode:
      | "PROVIDER_RATE_LIMITED"
      | "SENDING_OUTCOME_AMBIGUOUS"
      | "PROVIDER_AUTHORIZATION_FAILED"
      | "PROVIDER_VALIDATION_FAILED"
      | "PROVIDER_UNKNOWN";
    nextAttemptAt: Date | null;
    now: Date;
  }) {
    return this.runTransaction(async (transaction) => {
      const target = await transaction.callCenterCommand.findUnique({
        select: {
          callId: true,
          leg: { select: { agentSessionId: true, id: true } },
          practiceId: true,
        },
        where: { id: input.commandId },
      });
      if (!target) return false;
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "id" = ${target.callId} FOR UPDATE`,
      );
      const result = await transaction.callCenterCommand.updateMany({
        data: {
          errorCode: input.errorCode,
          nextAttemptAt: input.nextAttemptAt,
          status: "FAILED",
          updatedAt: input.now,
        },
        where: {
          attemptCount: input.attemptCount,
          id: input.commandId,
          status: "SENDING",
        },
      });
      if (result.count !== 1) return false;

      if (!input.nextAttemptAt) {
        if (target.leg) {
          await transaction.callCenterCallLeg.updateMany({
            data: { errorCode: input.errorCode, status: "FAILED" },
            where: {
              id: target.leg.id,
              status: { in: ["CREATED", "DIALING", "RINGING"] },
            },
          });
          await transaction.callCenterCall.update({
            data: { stateVersion: { increment: 1 } },
            where: { id: target.callId },
          });
          await transaction.callCenterEvent.create({
            data: {
              aggregateId: target.callId,
              aggregateType: "CALL",
              data: {
                commandId: input.commandId,
                errorCode: input.errorCode,
                legId: target.leg.id,
              },
              idempotencyKey: `${input.commandId}:terminal-failure`,
              occurredAt: input.now,
              practiceId: target.practiceId,
              type: "CALL_AGENT_DIAL_FAILED",
            },
          });
          if (target.leg.agentSessionId) {
            await releaseAgentSessionReservation(transaction, {
              agentSessionId: target.leg.agentSessionId,
              callId: target.callId,
              idempotencyKey: `${input.commandId}:release`,
              now: input.now,
              reason: "DIAL_FAILED",
            });
          }
        }
      }
      await appendCommandOperationStatus(transaction, {
        attemptCount: input.attemptCount,
        commandId: input.commandId,
        now: input.now,
        status: input.nextAttemptAt ? "PENDING" : "FAILED",
      });
      return true;
    });
  }

  async markSent(input: { attemptCount: number; commandId: string; now: Date }) {
    return this.runTransaction(async (transaction) => {
      const updated = await transaction.callCenterCommand.updateMany({
        data: {
          errorCode: null,
          nextAttemptAt: null,
          status: "SENT",
          updatedAt: input.now,
        },
        where: {
          attemptCount: input.attemptCount,
          id: input.commandId,
          status: "SENDING",
        },
      });
      if (updated.count === 1) {
        await appendCommandOperationStatus(transaction, {
          attemptCount: input.attemptCount,
          commandId: input.commandId,
          now: input.now,
          status: "SENT",
        });
        return "MARKED" as const;
      }

      const command = await transaction.callCenterCommand.findUnique({
        select: { attemptCount: true, status: true },
        where: { id: input.commandId },
      });
      return command
        ? decideProviderCommandMarkSent(
            command.status,
            command.attemptCount,
            input.attemptCount,
          )
        : "STALE";
    });
  }

  listRecoverable(input: {
    limit: number;
    maxAttempts: number;
    now: Date;
    staleBefore: Date;
  }) {
    return this.commands.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: input.limit,
      where: {
        attemptCount: { lt: input.maxAttempts },
        OR: [
          { status: "PENDING" },
          { nextAttemptAt: { lte: input.now }, status: "FAILED" },
          { status: "SENDING", updatedAt: { lte: input.staleBefore } },
        ],
      },
    });
  }
}

export const prismaProviderCommandStore = new PrismaProviderCommandStore();
