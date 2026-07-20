import { Prisma } from "@/generated/prisma/client";
import type {
  ProviderCommandDispatchStore,
  ProviderCommandRejectedClaim,
  ProviderCommandSettledClaim,
} from "@/lib/call-center/application/dispatch-provider-command";
import { UNBRIDGED_LIVE_CANONICAL_LEG_STATUSES } from "@/lib/call-center/domain/canonical-call-state";
import {
  decideProviderCommandMarkSent,
  type ProviderCommandClaim,
} from "@/lib/call-center/domain/provider-command";
import { lockCallCenterPractice } from "@/lib/call-center/infrastructure/prisma-call-center-practice-lock";
import { settleCanonicalCallLegs } from "@/lib/call-center/infrastructure/prisma-call-resource-settlement";
import { reconcileActiveInboundCallInTransaction } from "@/lib/call-center/infrastructure/prisma-active-inbound-lifecycle-store";
import { failProviderCommandDependents } from "@/lib/call-center/infrastructure/prisma-provider-command-failures";
import { reconcileFailedTransferWithEndedSource } from "@/lib/call-center/infrastructure/prisma-failed-transfer-reconciliation";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
export type ProviderCommandTransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;
type ReconcileActiveInbound = typeof reconcileActiveInboundCallInTransaction;
type ProviderCommandBacklogDelegate = Pick<typeof prisma.callCenterCommand, "findMany">;

type TerminalProviderCommand = {
  callId: string;
  id: string;
  leg: { id: string; kind: "AGENT" | "CUSTOMER" } | null;
  practiceId: string;
  type: string;
};

function recordArguments(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function dialAgentArguments(value: Prisma.JsonValue) {
  const record = recordArguments(value);
  if (!record) return null;
  const { agentSessionId, endpointId } = record;
  return typeof agentSessionId === "string" &&
    agentSessionId.length > 0 &&
    typeof endpointId === "string" &&
    endpointId.length > 0
    ? { agentSessionId, endpointId }
    : null;
}

function transferAgentArguments(value: Prisma.JsonValue) {
  const record = recordArguments(value);
  if (!record) return null;
  const { agentSessionId, endpointId, providerSourceLegId, sourceLegId } = record;
  return typeof agentSessionId === "string" &&
    agentSessionId.length > 0 &&
    typeof endpointId === "string" &&
    endpointId.length > 0 &&
    typeof providerSourceLegId === "string" &&
    providerSourceLegId.length > 0 &&
    typeof sourceLegId === "string" &&
    sourceLegId.length > 0
    ? { agentSessionId, endpointId, providerSourceLegId, sourceLegId }
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
    status: "PENDING" | "SENDING" | "SENT" | "CONFIRMED" | "FAILED";
    updatedAt: Date;
  },
  staleBefore: Date,
) {
  if (command.status === "PENDING") return true;
  return command.status === "SENDING" && command.updatedAt <= staleBefore;
}

async function settleTerminalProviderCommand(
  transaction: Transaction,
  command: TerminalProviderCommand,
  errorCode: string,
  now: Date,
  reconcileActiveInbound: ReconcileActiveInbound,
) {
  const leg =
    ["DIAL_AGENT", "TRANSFER_AGENT"].includes(command.type) &&
    command.leg?.kind === "AGENT"
      ? command.leg
      : null;
  if (leg) {
    await transaction.callCenterCallLeg.updateMany({
      data: { errorCode, status: "FAILED" },
      where: {
        id: leg.id,
        status: { in: [...UNBRIDGED_LIVE_CANONICAL_LEG_STATUSES] },
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
        idempotencyKey: `${command.id}:terminal-failure`,
        occurredAt: now,
        practiceId: command.practiceId,
        type:
          command.type === "TRANSFER_AGENT"
            ? "CALL_TRANSFER_FAILED"
            : "CALL_AGENT_DIAL_FAILED",
      },
    });
  }
  await failProviderCommandDependents(transaction, {
    commandId: command.id,
    now,
  });
  if (command.type === "TRANSFER_AGENT") {
    const transfer = await reconcileFailedTransferWithEndedSource(
      transaction,
      {
        commandId: command.id,
        now,
      },
      settleCanonicalCallLegs,
    );
    return transfer.commandIds;
  }
  const lifecycle = await reconcileActiveInbound(
    transaction,
    {
      callId: command.callId,
      practiceId: command.practiceId,
      processedBridgeLegId: null,
    },
    now,
  );
  return lifecycle?.commandIds ?? [];
}

async function rejectProviderCommandClaim(
  transaction: Transaction,
  command: {
    attemptCount: number;
    callId: string;
    id: string;
    leg: {
      agentSessionId: string | null;
      id: string;
      kind: "AGENT" | "CUSTOMER";
    } | null;
    practiceId: string;
    status: "PENDING" | "SENDING" | "SENT" | "CONFIRMED" | "FAILED";
    type: string;
  },
  errorCode: string,
  now: Date,
  reconcileActiveInbound: ReconcileActiveInbound,
): Promise<ProviderCommandRejectedClaim | null> {
  const rejected = await transaction.callCenterCommand.updateMany({
    data: { errorCode, status: "FAILED", updatedAt: now },
    where: {
      attemptCount: command.attemptCount,
      id: command.id,
      status: command.status,
    },
  });
  if (rejected.count !== 1) return null;

  const followUpCommandIds = await settleTerminalProviderCommand(
    transaction,
    command,
    errorCode,
    now,
    reconcileActiveInbound,
  );
  return {
    commandId: command.id,
    errorCode,
    followUpCommandIds,
    rejected: true,
  };
}

async function loadProviderCommandClaim(
  tx: Transaction,
  commandId: string,
  input: { now: Date; staleBefore: Date },
  reconcileActiveInbound: ReconcileActiveInbound,
): Promise<
  ProviderCommandClaim | ProviderCommandRejectedClaim | ProviderCommandSettledClaim | null
> {
  const target = await tx.callCenterCommand.findUnique({
    select: { callId: true, practiceId: true },
    where: { id: commandId },
  });
  if (!target) return null;
  await lockCallCenterPractice(tx, target.practiceId);
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
            },
          },
        },
      },
      dependsOnCommand: {
        select: { callId: true, practiceId: true, status: true },
      },
      leg: { include: { agentSession: true, endpoint: true } },
      practice: { include: { callCenterSettings: true } },
    },
    where: { id: commandId },
  });
  if (!command) return null;
  if (command.status === "SENT" || command.status === "CONFIRMED") {
    return { commandId: command.id, settled: true };
  }
  if (command.status === "FAILED") {
    return {
      commandId: command.id,
      errorCode: command.errorCode ?? "COMMAND_FAILED",
      followUpCommandIds: [],
      rejected: true,
    };
  }
  if (!isClaimable(command, input.staleBefore)) return null;
  const reject = (errorCode: string): Promise<ProviderCommandRejectedClaim | null> =>
    rejectProviderCommandClaim(tx, command, errorCode, input.now, reconcileActiveInbound);
  const isDialAgent = command.type === "DIAL_AGENT";
  const isTransferAgent = command.type === "TRANSFER_AGENT";

  const dependency = command.dependsOnCommand;
  if (
    dependency &&
    (dependency.callId !== command.callId || dependency.practiceId !== command.practiceId)
  ) {
    return reject("COMMAND_DEPENDENCY_INVALID");
  }
  if (dependency?.status === "FAILED") {
    return reject("COMMAND_DEPENDENCY_FAILED");
  }
  if (dependency && !["SENT", "CONFIRMED"].includes(dependency.status)) {
    return null;
  }

  if (command.type === "BRIDGE_LEGS") {
    return reject("COMMAND_TYPE_UNSUPPORTED");
  }

  const leg = command.leg;
  const cleanupCommand = ["HANGUP_LEG", "STOP_HOLD_MUSIC"].includes(command.type);
  if (
    !leg ||
    leg.callId !== command.callId ||
    (!cleanupCommand && ["ENDED", "FAILED"].includes(leg.status))
  ) {
    return reject("COMMAND_PROVIDER_LEG_INVALID");
  }
  if (!isDialAgent && !isTransferAgent && !leg.providerCallControlId) {
    return reject("COMMAND_PROVIDER_LEG_INVALID");
  }

  const allowedAfterTerminal =
    command.type === "HANGUP_LEG" ||
    command.type === "STOP_HOLD_MUSIC" ||
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
    return reject("COMMAND_CALL_TERMINAL");
  }

  const customerLegCommand = [
    "ANSWER_CUSTOMER",
    "START_RINGBACK",
    "STOP_PLAYBACK",
    "PLAY_VOICEMAIL_GREETING",
    "START_RECORDING",
  ].includes(command.type);
  if (customerLegCommand && leg.kind !== "CUSTOMER") {
    return reject("COMMAND_CUSTOMER_LEG_INVALID");
  }
  const holdMusicCommand = ["START_HOLD_MUSIC", "STOP_HOLD_MUSIC"].includes(command.type);
  if (
    holdMusicCommand &&
    (leg.kind !== "AGENT" ||
      (command.type === "START_HOLD_MUSIC" &&
        (command.call.status !== "CONNECTED" ||
          !["ANSWERED", "BRIDGED"].includes(leg.status))))
  ) {
    return reject("COMMAND_AGENT_LEG_INVALID");
  }

  let dispatchArguments:
    | Record<string, never>
    | { timeoutSeconds: number }
    | { greeting: string }
    | { agentSessionId: string; endpointId: string }
    | {
        agentSessionId: string;
        endpointId: string;
        providerSourceLegId: string;
        sourceLegId: string;
      }
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
    case "TRANSFER_AGENT":
      dispatchArguments = transferAgentArguments(command.arguments);
      break;
    default:
      dispatchArguments = emptyArguments(command.arguments);
  }
  if (!dispatchArguments) {
    return reject("COMMAND_ARGUMENTS_INVALID");
  }

  if (command.type === "TRANSFER_AGENT") {
    const args = dispatchArguments as {
      agentSessionId: string;
      endpointId: string;
      providerSourceLegId: string;
      sourceLegId: string;
    };
    if (
      leg.kind !== "AGENT" ||
      leg.endpointId !== args.endpointId ||
      leg.agentSessionId !== args.agentSessionId ||
      command.call.status !== "CONNECTED"
    ) {
      return reject("COMMAND_TRANSFER_STATE_INVALID");
    }
    if (!command.call.queue?.enabled) {
      return reject("COMMAND_QUEUE_NOT_ENABLED");
    }
    const endpoint = leg.endpoint;
    const session = leg.agentSession;
    if (!endpoint?.enabled || !endpoint.sipUsername) {
      return reject("COMMAND_PROVIDER_TARGET_INVALID");
    }
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_endpoint" WHERE "id" = ${args.endpointId} FOR UPDATE`,
    );
    const source = await tx.callCenterCallLeg.findFirst({
      include: { endpoint: { select: { userId: true } } },
      where: {
        callId: command.callId,
        id: args.sourceLegId,
        kind: "AGENT",
        providerCallControlId: { not: null },
        status: { in: ["ANSWERED", "BRIDGED"] },
      },
    });
    const providerSource = await tx.callCenterCallLeg.findFirst({
      select: { id: true, kind: true, providerCallControlId: true },
      where: {
        callId: command.callId,
        id: args.providerSourceLegId,
        providerCallControlId: { not: null },
        status: { in: ["ANSWERED", "BRIDGED"] },
      },
    });
    const liveTarget = await tx.callCenterCallLeg.findFirst({
      select: { id: true },
      where: {
        id: leg.id,
        status: { in: [...UNBRIDGED_LIVE_CANONICAL_LEG_STATUSES] },
      },
    });
    const occupied = await tx.callCenterCallLeg.findFirst({
      select: { id: true },
      where: {
        endpointId: args.endpointId,
        id: { not: leg.id },
        kind: "AGENT",
        status: { in: ["ANSWERED", "BRIDGED"] },
      },
    });
    if (
      !source?.providerCallControlId ||
      !providerSource?.providerCallControlId ||
      (command.call.direction === "INBOUND" && providerSource.kind !== "CUSTOMER") ||
      (command.call.direction === "OUTBOUND" && providerSource.id !== source.id) ||
      (command.call.winningLegId !== source.id &&
        !(command.call.direction === "OUTBOUND" && !command.call.winningLegId)) ||
      source.endpointId === args.endpointId ||
      source.endpoint?.userId === session?.userId ||
      !session ||
      !liveTarget ||
      session.id !== args.agentSessionId ||
      session.endpointId !== args.endpointId ||
      session.presence !== "AVAILABLE" ||
      occupied ||
      session.connectionState !== "READY" ||
      !session.microphoneReady ||
      !session.audioReady ||
      session.leaseExpiresAt <= input.now
    ) {
      return reject("COMMAND_AGENT_SESSION_NOT_READY");
    }
    if (!command.call.queue.members.some(({ userId }) => userId === session.userId)) {
      return reject("COMMAND_AGENT_MEMBERSHIP_INVALID");
    }
    const numberLocationId = command.call.number.practicePhoneNumber.locationId;
    const queueLocationIds = new Set(
      command.call.queue.locations.map(({ locationId }) => locationId),
    );
    if (
      !numberLocationId ||
      endpoint.locationId !== numberLocationId ||
      (queueLocationIds.size > 0 && !queueLocationIds.has(numberLocationId))
    ) {
      return reject("COMMAND_LOCATION_SCOPE_INVALID");
    }
    const membership = await tx.practiceMembership.findUnique({
      select: {
        locationScope: true,
        locations: { select: { locationId: true } },
      },
      where: {
        practiceId_userId: {
          practiceId: command.practiceId,
          userId: session.userId,
        },
      },
    });
    if (
      !membership ||
      (membership.locationScope === "SELECTED" &&
        !membership.locations.some(({ locationId }) => locationId === numberLocationId))
    ) {
      return reject("COMMAND_AGENT_LOCATION_ACCESS_INVALID");
    }
    const transferProvider =
      command.call.direction === "OUTBOUND"
        ? command.practice.callCenterSettings?.telnyxConnectionId?.trim()
          ? {
              callControlId: providerSource.providerCallControlId,
              connectionId: command.practice.callCenterSettings.telnyxConnectionId.trim(),
              from: command.call.number.practicePhoneNumber.phoneNumber.trim(),
              sipUri: sipUri(endpoint.sipUsername.trim()),
              strategy: "DIAL_BRIDGE" as const,
              timeoutSeconds: 20,
            }
          : null
        : {
            callControlId: providerSource.providerCallControlId,
            sipUri: sipUri(endpoint.sipUsername.trim()),
            strategy: "TRANSFER" as const,
            timeoutSeconds: 20,
          };
    if (!transferProvider) {
      return reject("COMMAND_PROVIDER_CONFIGURATION_INVALID");
    }

    const claimed = await tx.callCenterCommand.update({
      data: {
        attemptCount: { increment: 1 },
        errorCode: null,
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
        provider: transferProvider,
        type: "TRANSFER_AGENT",
      },
    };
  }

  if (command.type === "DIAL_AGENT") {
    const args = dispatchArguments as {
      agentSessionId: string;
      endpointId: string;
    };
    if (
      leg.kind !== "AGENT" ||
      leg.endpointId !== args.endpointId ||
      leg.agentSessionId !== args.agentSessionId
    ) {
      return reject("COMMAND_AGENT_LEG_INVALID");
    }
    if (!command.call.queue?.enabled) {
      return reject("COMMAND_QUEUE_NOT_ENABLED");
    }
    const endpoint = leg.endpoint;
    const session = leg.agentSession;
    const settings = command.practice.callCenterSettings;
    if (!endpoint?.enabled || !endpoint.sipUsername || !settings) {
      return reject("COMMAND_PROVIDER_TARGET_INVALID");
    }
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_endpoint" WHERE "id" = ${args.endpointId} FOR UPDATE`,
    );
    const liveTarget = await tx.callCenterCallLeg.findFirst({
      select: { id: true },
      where: {
        id: leg.id,
        status: { in: ["CREATED", "DIALING", "RINGING"] },
      },
    });
    const occupied = await tx.callCenterCallLeg.findFirst({
      select: { id: true },
      where: {
        endpointId: args.endpointId,
        id: { not: leg.id },
        kind: "AGENT",
        status: { in: ["ANSWERED", "BRIDGED"] },
      },
    });
    if (
      !session ||
      !liveTarget ||
      session.id !== args.agentSessionId ||
      session.endpointId !== args.endpointId ||
      session.presence !== "AVAILABLE" ||
      occupied ||
      session.connectionState !== "READY" ||
      !session.microphoneReady ||
      !session.audioReady ||
      session.leaseExpiresAt <= input.now
    ) {
      return reject("COMMAND_AGENT_SESSION_NOT_READY");
    }
    if (!command.call.queue.members.some(({ userId }) => userId === session.userId)) {
      return reject("COMMAND_AGENT_MEMBERSHIP_INVALID");
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
      return reject("COMMAND_AGENT_LOCATION_ACCESS_INVALID");
    }
    if (
      queueLocationIds.size > 0 &&
      (!endpoint.locationId ||
        !queueLocationIds.has(endpoint.locationId) ||
        !numberLocationId ||
        !queueLocationIds.has(numberLocationId))
    ) {
      return reject("COMMAND_LOCATION_SCOPE_INVALID");
    }
    const connectionId = settings.telnyxConnectionId?.trim();
    const from = command.call.number.practicePhoneNumber.phoneNumber.trim();
    if (!connectionId || !from) {
      return reject("COMMAND_PROVIDER_CONFIGURATION_INVALID");
    }
    const linkedLeg = await tx.callCenterCallLeg.findFirst({
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      select: { providerCallControlId: true },
      where: {
        callId: command.callId,
        kind: "CUSTOMER",
        providerCallControlId: { not: null },
        status: { in: ["ANSWERED", "BRIDGED"] },
      },
    });
    const linkTo = linkedLeg?.providerCallControlId;
    if (!linkTo) return null;

    const claimed = await tx.callCenterCommand.update({
      data: {
        attemptCount: { increment: 1 },
        errorCode: null,
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
          linkTo,
          sipUri: sipUri(endpoint.sipUsername.trim()),
          timeoutSeconds: 20,
        },
        type: "DIAL_AGENT",
      },
    };
  }

  const claimed = await tx.callCenterCommand.update({
    data: {
      attemptCount: { increment: 1 },
      errorCode: null,
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
    case "START_HOLD_MUSIC":
      dispatchCommand = { ...base, arguments: {}, type: "START_HOLD_MUSIC" };
      break;
    case "STOP_HOLD_MUSIC":
      dispatchCommand = { ...base, arguments: {}, type: "STOP_HOLD_MUSIC" };
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
    private readonly reconcileActiveInbound: ReconcileActiveInbound = reconcileActiveInboundCallInTransaction,
    private readonly commands: ProviderCommandBacklogDelegate = prisma.callCenterCommand,
  ) {}

  claim(input: { commandId: string; now: Date; staleBefore: Date }) {
    return this.runTransaction((tx) =>
      loadProviderCommandClaim(tx, input.commandId, input, this.reconcileActiveInbound),
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
    now: Date;
  }) {
    return this.runTransaction(async (transaction) => {
      const target = await transaction.callCenterCommand.findUnique({
        select: {
          callId: true,
          leg: { select: { id: true, kind: true } },
          practiceId: true,
          type: true,
        },
        where: { id: input.commandId },
      });
      if (!target) return null;
      await lockCallCenterPractice(transaction, target.practiceId);
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "id" = ${target.callId} FOR UPDATE`,
      );
      const result = await transaction.callCenterCommand.updateMany({
        data: {
          errorCode: input.errorCode,
          status: "FAILED",
          updatedAt: input.now,
        },
        where: {
          attemptCount: input.attemptCount,
          id: input.commandId,
          status: "SENDING",
        },
      });
      if (result.count !== 1) return null;

      const commandIds = await settleTerminalProviderCommand(
        transaction,
        { ...target, id: input.commandId },
        input.errorCode,
        input.now,
        this.reconcileActiveInbound,
      );
      return { commandIds };
    });
  }

  async listDispatchable(input: { limit: number; staleBefore: Date }) {
    const commands = await this.commands.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: input.limit,
      where: {
        OR: [
          { status: "PENDING" },
          { status: "SENDING", updatedAt: { lte: input.staleBefore } },
        ],
      },
    });
    return commands.map(({ id }) => id);
  }

  private markDelivery(
    input: { attemptCount: number; commandId: string; now: Date },
    status: "CONFIRMED" | "SENT",
  ) {
    return this.runTransaction(async (transaction) => {
      const updated = await transaction.callCenterCommand.updateMany({
        data: {
          errorCode: null,
          status,
          updatedAt: input.now,
        },
        where: {
          attemptCount: input.attemptCount,
          id: input.commandId,
          status: "SENDING",
        },
      });
      if (updated.count === 1) return "MARKED" as const;

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

  markConfirmed(input: { attemptCount: number; commandId: string; now: Date }) {
    return this.markDelivery(input, "CONFIRMED");
  }

  markSent(input: { attemptCount: number; commandId: string; now: Date }) {
    return this.markDelivery(input, "SENT");
  }
}

export const prismaProviderCommandStore = new PrismaProviderCommandStore();
