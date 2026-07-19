import type { Prisma } from "@/generated/prisma/client";
import { UNBRIDGED_LIVE_CANONICAL_LEG_STATUSES } from "@/lib/call-center/domain/canonical-call-state";

type Transaction = Prisma.TransactionClient;

const unsettledWhere: Prisma.CallCenterCommandWhereInput = {
  status: { in: ["PENDING", "SENDING", "SENT"] },
};

const commandFailureSelect = {
  attemptCount: true,
  callId: true,
  id: true,
  leg: { select: { id: true } },
  practiceId: true,
  status: true,
  type: true,
} satisfies Prisma.CallCenterCommandSelect;

type UnsettledCommand = Prisma.CallCenterCommandGetPayload<{
  select: typeof commandFailureSelect;
}>;

function unsettledCommands(
  transaction: Transaction,
  where: Prisma.CallCenterCommandWhereInput,
) {
  return transaction.callCenterCommand.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: commandFailureSelect,
    where: { AND: [where, unsettledWhere] },
  });
}

async function failOne(
  transaction: Transaction,
  command: UnsettledCommand,
  errorCode: string,
  now: Date,
) {
  const failed = await transaction.callCenterCommand.updateMany({
    data: { errorCode, status: "FAILED", updatedAt: now },
    where: {
      id: command.id,
      status: command.status,
    },
  });
  if (failed.count !== 1) return false;

  if (["DIAL_AGENT", "TRANSFER_AGENT"].includes(command.type) && command.leg) {
    const leg = await transaction.callCenterCallLeg.updateMany({
      data: { errorCode, status: "FAILED" },
      where: {
        id: command.leg.id,
        status: { in: [...UNBRIDGED_LIVE_CANONICAL_LEG_STATUSES] },
      },
    });
    if (leg.count === 1 || command.type === "TRANSFER_AGENT") {
      await transaction.callCenterCall.update({
        data: { stateVersion: { increment: 1 } },
        where: { id: command.callId },
      });
      const eventData = {
        aggregateId: command.callId,
        aggregateType: "CALL" as const,
        data: { commandId: command.id, errorCode, legId: command.leg.id },
        idempotencyKey: `${command.id}:${errorCode}`,
        occurredAt: now,
        practiceId: command.practiceId,
        type:
          command.type === "TRANSFER_AGENT"
            ? "CALL_TRANSFER_FAILED"
            : "CALL_AGENT_DIAL_FAILED",
      };
      if (command.type === "TRANSFER_AGENT") {
        await transaction.callCenterEvent.upsert({
          create: eventData,
          update: {},
          where: {
            practiceId_type_idempotencyKey: {
              idempotencyKey: eventData.idempotencyKey,
              practiceId: eventData.practiceId,
              type: eventData.type,
            },
          },
        });
      } else {
        await transaction.callCenterEvent.create({ data: eventData });
      }
    }
  }

  return true;
}

async function confirmSatisfiedOne(
  transaction: Transaction,
  command: UnsettledCommand,
  now: Date,
) {
  const confirmed = await transaction.callCenterCommand.updateMany({
    data: { errorCode: null, status: "CONFIRMED", updatedAt: now },
    where: {
      id: command.id,
      status: command.status,
    },
  });
  if (confirmed.count !== 1) return false;

  return true;
}

async function failCommandsAndDescendants(
  transaction: Transaction,
  commands: UnsettledCommand[],
  errorCode: string,
  now: Date,
) {
  let frontier = commands;
  const failedIds: string[] = [];
  const visited = new Set<string>();

  while (frontier.length > 0) {
    const settled: string[] = [];
    for (const command of frontier) {
      if (visited.has(command.id)) continue;
      visited.add(command.id);
      if (await failOne(transaction, command, errorCode, now)) {
        failedIds.push(command.id);
        settled.push(command.id);
      }
    }
    frontier =
      settled.length === 0
        ? []
        : await unsettledCommands(transaction, {
            dependsOnCommandId: { in: settled },
          });
  }
  return failedIds;
}

/** Fails every unsettled descendant after a prerequisite becomes terminal. */
export async function failProviderCommandDependents(
  transaction: Transaction,
  input: { commandId: string; now: Date },
) {
  const commands = await unsettledCommands(transaction, {
    dependsOnCommandId: input.commandId,
  });
  return failCommandsAndDescendants(
    transaction,
    commands,
    "COMMAND_DEPENDENCY_FAILED",
    input.now,
  );
}

/** Settles commands whose effect is already true and fails the rest. */
export async function settleProviderCommandsForTerminalLeg(
  transaction: Transaction,
  input: {
    exceptTypes?: Array<"HANGUP_LEG">;
    legId: string;
    now: Date;
  },
) {
  const commands = await unsettledCommands(transaction, {
    legId: input.legId,
    ...(input.exceptTypes?.length ? { type: { notIn: input.exceptTypes } } : {}),
  });
  const satisfiedTypes = new Set(["STOP_PLAYBACK", "STOP_HOLD_MUSIC", "HANGUP_LEG"]);
  for (const command of commands) {
    if (satisfiedTypes.has(command.type)) {
      await confirmSatisfiedOne(transaction, command, input.now);
    }
  }
  return failCommandsAndDescendants(
    transaction,
    commands.filter((command) => !satisfiedTypes.has(command.type)),
    "COMMAND_LEG_TERMINAL",
    input.now,
  );
}
