import { Prisma } from "@/generated/prisma/client";
import type { ProviderCommandDispatchStore } from "@/lib/call-center/application/dispatch-provider-command";
import {
  decideProviderCommandMarkSent,
  type ProviderCommandClaim,
} from "@/lib/call-center/domain/provider-command";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
export type ProviderCommandTransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;
export type ProviderCommandPrismaDelegate = Pick<
  typeof prisma.callCenterCommand,
  "findMany" | "findUnique" | "updateMany"
>;

export class ProviderCommandClaimError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProviderCommandClaimError";
  }
}

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

async function loadDialAgentClaim(
  tx: Transaction,
  commandId: string,
  input: { maxAttempts: number; now: Date; staleBefore: Date },
): Promise<ProviderCommandClaim | null> {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_command" WHERE "id" = ${commandId} FOR UPDATE`,
  );
  const command = await tx.callCenterCommand.findUnique({
    include: {
      call: {
        include: {
          number: { include: { practicePhoneNumber: true } },
          queue: { select: { ringTimeoutSec: true, routingMode: true } },
        },
      },
      leg: { include: { endpoint: true } },
      practice: { include: { callCenterSettings: true } },
    },
    where: { id: commandId },
  });
  if (!command || !isClaimable(command, input)) return null;
  if (command.type !== "DIAL_AGENT") {
    throw new ProviderCommandClaimError("COMMAND_TYPE_UNSUPPORTED");
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
    throw new ProviderCommandClaimError("COMMAND_AGENT_LEG_INVALID");
  }
  if (command.call.queue?.routingMode !== "ACTIVE") {
    throw new ProviderCommandClaimError("COMMAND_QUEUE_NOT_ACTIVE");
  }
  if (["COMPLETED", "VOICEMAIL", "ABANDONED", "FAILED"].includes(command.call.status)) {
    throw new ProviderCommandClaimError("COMMAND_CALL_TERMINAL");
  }
  const endpoint = leg.endpoint;
  const settings = command.practice.callCenterSettings;
  if (!endpoint?.enabled || !endpoint.sipUsername || !settings?.enabled) {
    throw new ProviderCommandClaimError("COMMAND_PROVIDER_TARGET_INVALID");
  }
  const connectionId = settings.telnyxConnectionId?.trim();
  const from = command.call.number.practicePhoneNumber.phoneNumber.trim();
  if (!connectionId || !from) {
    throw new ProviderCommandClaimError("COMMAND_PROVIDER_CONFIGURATION_INVALID");
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
    throw new ProviderCommandClaimError("COMMAND_CUSTOMER_LEG_AMBIGUOUS");
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
    const result = await this.commands.updateMany({
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
    return result.count === 1;
  }

  async markSent(input: { attemptCount: number; commandId: string; now: Date }) {
    const updated = await this.commands.updateMany({
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
    if (updated.count === 1) return "MARKED" as const;

    const command = await this.commands.findUnique({
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
