import { Prisma } from "@/generated/prisma/client";
import type { ProviderCommandDispatchStore } from "@/lib/call-center/application/dispatch-provider-command";
import {
  decideProviderCommandMarkSent,
  type ProviderCommandClaim,
} from "@/lib/call-center/domain/provider-command";
import { releaseAgentSessionReservation } from "@/lib/call-center/infrastructure/prisma-agent-session-reservation";
import { appendCommandOperationStatus } from "@/lib/call-center/infrastructure/prisma-command-operation-events";
import { failProviderCommandDependents } from "@/lib/call-center/infrastructure/prisma-provider-command-failures";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
export type ProviderCommandTransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;
export type ProviderCommandPrismaDelegate = Pick<
  typeof prisma.callCenterCommand,
  "findMany" | "findUnique" | "updateMany"
>;

function recordArguments(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function dialAgentArguments(value: Prisma.JsonValue) {
  const record = recordArguments(value);
  if (!record) return null;
  const { agentSessionId, endpointId, replacesLegId } = record;
  if (
    replacesLegId !== undefined &&
    (typeof replacesLegId !== "string" || replacesLegId.length === 0)
  ) {
    return null;
  }
  return typeof agentSessionId === "string" &&
    agentSessionId.length > 0 &&
    typeof endpointId === "string" &&
    endpointId.length > 0
    ? {
        agentSessionId,
        endpointId,
        ...(typeof replacesLegId === "string" ? { replacesLegId } : {}),
      }
    : null;
}

function startRingbackArguments(value: Prisma.JsonValue) {
  const record = recordArguments(value);
  const timeoutSeconds = record?.timeoutSeconds;
  return typeof timeoutSeconds === "number" &&
    Number.isInteger(timeoutSeconds) &&
    timeoutSeconds >= 1 &&
    timeoutSeconds <= 120
    ? { timeoutSeconds }
    : null;
}

function voicemailGreetingArguments(value: Prisma.JsonValue) {
  const record = recordArguments(value);
  const greeting = record?.greeting;
  if (typeof greeting !== "string") return null;
  const sanitized = greeting.trim();
  return sanitized.length > 0 && sanitized.length <= 2_000
    ? { greeting: sanitized }
    : null;
}

function emptyArguments(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.keys(value).length === 0 ? ({} as Record<string, never>) : null;
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

async function rejectProviderCommandClaim(
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
  await failProviderCommandDependents(transaction, {
    commandId: command.id,
    now,
  });
  return null;
}

async function loadProviderCommandClaim(
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
            },
          },
        },
      },
      dependsOnCommand: {
        select: { callId: true, nextAttemptAt: true, practiceId: true, status: true },
      },
      leg: { include: { agentSession: true, endpoint: true } },
      practice: { include: { callCenterSettings: true } },
    },
    where: { id: commandId },
  });
  if (!command || !isClaimable(command, input)) return null;
  const isDialAgent = command.type === "DIAL_AGENT";
  if (command.call.effectOwner !== "CANONICAL") {
    return rejectProviderCommandClaim(
      tx,
      command,
      "COMMAND_CALL_NOT_CANONICAL",
      input.now,
      isDialAgent,
    );
  }

  const dependency = command.dependsOnCommand;
  if (
    dependency &&
    (dependency.callId !== command.callId || dependency.practiceId !== command.practiceId)
  ) {
    return rejectProviderCommandClaim(
      tx,
      command,
      "COMMAND_DEPENDENCY_INVALID",
      input.now,
      isDialAgent,
    );
  }
  if (dependency?.status === "FAILED" && dependency.nextAttemptAt === null) {
    await rejectProviderCommandClaim(
      tx,
      command,
      "COMMAND_DEPENDENCY_FAILED",
      input.now,
      isDialAgent,
    );
    return null;
  }
  if (dependency && !["SENT", "CONFIRMED"].includes(dependency.status)) {
    return null;
  }

  if (command.type === "BRIDGE_LEGS") {
    return rejectProviderCommandClaim(tx, command, "COMMAND_TYPE_UNSUPPORTED", input.now);
  }

  const leg = command.leg;
  if (!leg || leg.callId !== command.callId || ["ENDED", "FAILED"].includes(leg.status)) {
    return rejectProviderCommandClaim(
      tx,
      command,
      "COMMAND_PROVIDER_LEG_INVALID",
      input.now,
      isDialAgent,
    );
  }
  if (!isDialAgent && !leg.providerCallControlId) {
    return rejectProviderCommandClaim(
      tx,
      command,
      "COMMAND_PROVIDER_LEG_INVALID",
      input.now,
    );
  }

  const allowedAfterTerminal =
    command.type === "HANGUP_LEG" ||
    (command.call.status === "VOICEMAIL" &&
      [
        "ANSWER_CUSTOMER",
        "START_RINGBACK",
        "STOP_PLAYBACK",
        "PLAY_VOICEMAIL_GREETING",
        "START_RECORDING",
      ].includes(command.type)) ||
    (command.call.status === "ABANDONED" &&
      ["ANSWER_CUSTOMER", "START_RINGBACK", "STOP_PLAYBACK"].includes(command.type));
  const terminalCall = ["COMPLETED", "VOICEMAIL", "ABANDONED", "FAILED"].includes(
    command.call.status,
  );
  if (terminalCall && !allowedAfterTerminal) {
    return rejectProviderCommandClaim(
      tx,
      command,
      "COMMAND_CALL_TERMINAL",
      input.now,
      isDialAgent,
    );
  }

  const customerLegCommand = [
    "ANSWER_CUSTOMER",
    "START_RINGBACK",
    "STOP_PLAYBACK",
    "PLAY_VOICEMAIL_GREETING",
    "START_RECORDING",
  ].includes(command.type);
  if (customerLegCommand && leg.kind !== "CUSTOMER") {
    return rejectProviderCommandClaim(
      tx,
      command,
      "COMMAND_CUSTOMER_LEG_INVALID",
      input.now,
    );
  }

  let dispatchArguments:
    | Record<string, never>
    | { timeoutSeconds: number }
    | { greeting: string }
    | { agentSessionId: string; endpointId: string; replacesLegId?: string }
    | null;
  switch (command.type) {
    case "START_RINGBACK":
      dispatchArguments = startRingbackArguments(command.arguments);
      break;
    case "PLAY_VOICEMAIL_GREETING":
      dispatchArguments = voicemailGreetingArguments(command.arguments);
      break;
    case "DIAL_AGENT":
      dispatchArguments = dialAgentArguments(command.arguments);
      break;
    default:
      dispatchArguments = emptyArguments(command.arguments);
  }
  if (!dispatchArguments) {
    return rejectProviderCommandClaim(
      tx,
      command,
      "COMMAND_ARGUMENTS_INVALID",
      input.now,
      isDialAgent,
    );
  }

  if (command.type === "DIAL_AGENT") {
    const args = dispatchArguments as {
      agentSessionId: string;
      endpointId: string;
      replacesLegId?: string;
    };
    if (
      leg.kind !== "AGENT" ||
      leg.endpointId !== args.endpointId ||
      leg.agentSessionId !== args.agentSessionId
    ) {
      return rejectProviderCommandClaim(
        tx,
        command,
        "COMMAND_AGENT_LEG_INVALID",
        input.now,
      );
    }
    if (!command.call.queue?.enabled) {
      return rejectProviderCommandClaim(
        tx,
        command,
        "COMMAND_QUEUE_NOT_ENABLED",
        input.now,
        true,
      );
    }
    if (args.replacesLegId) {
      if (
        command.call.status !== "CONNECTED" ||
        command.call.winningLegId !== args.replacesLegId
      ) {
        return rejectProviderCommandClaim(
          tx,
          command,
          "COMMAND_TRANSFER_SOURCE_CHANGED",
          input.now,
          true,
        );
      }
      const source = await tx.callCenterCallLeg.findFirst({
        select: { id: true },
        where: {
          callId: command.callId,
          id: args.replacesLegId,
          kind: "AGENT",
          status: "BRIDGED",
        },
      });
      if (!source) {
        return rejectProviderCommandClaim(
          tx,
          command,
          "COMMAND_TRANSFER_SOURCE_INVALID",
          input.now,
          true,
        );
      }
    }
    const endpoint = leg.endpoint;
    const session = leg.agentSession;
    const settings = command.practice.callCenterSettings;
    if (!endpoint?.enabled || !endpoint.sipUsername || !settings?.enabled) {
      return rejectProviderCommandClaim(
        tx,
        command,
        "COMMAND_PROVIDER_TARGET_INVALID",
        input.now,
        true,
      );
    }
    const offered =
      session?.offeredCallId === command.callId &&
      session?.currentCallId === null &&
      session?.presence === "AVAILABLE";
    const active =
      session?.offeredCallId === null &&
      session?.currentCallId === command.callId &&
      session?.presence === "BUSY";
    if (
      !session ||
      session.id !== args.agentSessionId ||
      session.endpointId !== args.endpointId ||
      (!offered && !active) ||
      session.connectionState !== "READY" ||
      !session.microphoneReady ||
      !session.audioReady ||
      session.leaseExpiresAt <= input.now
    ) {
      return rejectProviderCommandClaim(
        tx,
        command,
        "COMMAND_AGENT_SESSION_NOT_READY",
        input.now,
        true,
      );
    }
    if (!command.call.queue.members.some(({ userId }) => userId === session.userId)) {
      return rejectProviderCommandClaim(
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
      return rejectProviderCommandClaim(
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
      return rejectProviderCommandClaim(
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
      return rejectProviderCommandClaim(
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
      return rejectProviderCommandClaim(
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
  const base = {
    callId: command.callId,
    commandId: command.id,
    idempotencyKey: command.idempotencyKey,
    legId: leg.id,
    practiceId: command.practiceId,
    provider: { callControlId: leg.providerCallControlId! },
  };
  let dispatchCommand: ProviderCommandClaim["command"];
  switch (command.type) {
    case "ANSWER_CUSTOMER":
      dispatchCommand = { ...base, arguments: {}, type: "ANSWER_CUSTOMER" };
      break;
    case "START_RINGBACK":
      dispatchCommand = {
        ...base,
        arguments: dispatchArguments as { timeoutSeconds: number },
        type: "START_RINGBACK",
      };
      break;
    case "STOP_PLAYBACK":
      dispatchCommand = { ...base, arguments: {}, type: "STOP_PLAYBACK" };
      break;
    case "HANGUP_LEG":
      dispatchCommand = { ...base, arguments: {}, type: "HANGUP_LEG" };
      break;
    case "PLAY_VOICEMAIL_GREETING":
      dispatchCommand = {
        ...base,
        arguments: dispatchArguments as { greeting: string },
        type: "PLAY_VOICEMAIL_GREETING",
      };
      break;
    case "START_RECORDING":
      dispatchCommand = { ...base, arguments: {}, type: "START_RECORDING" };
      break;
    default:
      throw new Error("Unsupported provider command reached dispatch");
  }
  return {
    attemptCount: claimed.attemptCount,
    command: dispatchCommand,
  };
}

export class PrismaProviderCommandStore implements ProviderCommandDispatchStore {
  constructor(
    private readonly runTransaction: ProviderCommandTransactionRunner = (operation) =>
      prisma.$transaction(operation),
    private readonly commands: ProviderCommandPrismaDelegate = prisma.callCenterCommand,
  ) {}

  claim(input: { commandId: string; maxAttempts: number; now: Date; staleBefore: Date }) {
    return this.runTransaction((tx) =>
      loadProviderCommandClaim(tx, input.commandId, input),
    );
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
          type: true,
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

      if (!input.nextAttemptAt && target.type === "DIAL_AGENT") {
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
      if (!input.nextAttemptAt) {
        await failProviderCommandDependents(transaction, {
          commandId: input.commandId,
          now: input.now,
        });
      }
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
        AND: [
          {
            OR: [
              { dependsOnCommandId: null },
              {
                dependsOnCommand: {
                  is: { status: { in: ["SENT", "CONFIRMED"] } },
                },
              },
            ],
          },
        ],
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
