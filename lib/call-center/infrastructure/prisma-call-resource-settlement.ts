import { Prisma } from "@/generated/prisma/client";
import { settleProviderCommandsForTerminalLeg } from "@/lib/call-center/infrastructure/prisma-provider-command-failures";
import { clearSettledTransferDeadline } from "@/lib/call-center/infrastructure/prisma-transfer-lifecycle";

type Transaction = Prisma.TransactionClient;

const LIVE_AGENT_LEG_STATUSES = [
  "CREATED",
  "DIALING",
  "RINGING",
  "ANSWERED",
  "BRIDGED",
] as const;

type SettlementInput = {
  callId: string;
  hangupIdempotencyKeys?: Readonly<Record<string, string>>;
  includeCustomerLegs?: boolean;
  includeTerminalProviderLegs?: boolean;
  legIds?: readonly string[];
  now: Date;
  reason: string;
  terminalLegStatus?: "ENDED" | "FAILED";
};

/**
 * Makes released canonical legs and provider effects agree.
 * The call row must already be locked by the owning transition.
 */
export async function settleCanonicalCallLegs(
  transaction: Transaction,
  input: SettlementInput,
) {
  const legs = await transaction.callCenterCallLeg.findMany({
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      providerCallControlId: true,
      status: true,
    },
    where: {
      callId: input.callId,
      ...(input.includeCustomerLegs ? {} : { kind: "AGENT" as const }),
      ...(input.legIds ? { id: { in: [...input.legIds] } } : {}),
    },
  });
  if (legs.length === 0) {
    await clearSettledTransferDeadline(transaction, input.callId);
    return [];
  }

  const call = await transaction.callCenterCall.findUnique({
    select: { practiceId: true },
    where: { id: input.callId },
  });
  if (!call) return [];

  const commandIds: string[] = [];
  for (const leg of legs) {
    await settleProviderCommandsForTerminalLeg(transaction, {
      exceptTypes: ["HANGUP_LEG"],
      legId: leg.id,
      now: input.now,
    });

    if (
      leg.providerCallControlId &&
      (LIVE_AGENT_LEG_STATUSES.includes(leg.status as never) ||
        input.includeTerminalProviderLegs)
    ) {
      const existing = await transaction.callCenterCommand.findFirst({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
        where: { legId: leg.id, type: "HANGUP_LEG" },
      });
      const command =
        existing ??
        (await transaction.callCenterCommand.upsert({
          create: {
            arguments: {},
            callId: input.callId,
            idempotencyKey:
              input.hangupIdempotencyKeys?.[leg.id] ??
              `settle:${input.callId}:hangup:${leg.id}`,
            legId: leg.id,
            practiceId: call.practiceId,
            type: "HANGUP_LEG",
          },
          select: { id: true },
          update: {},
          where: {
            practiceId_type_idempotencyKey: {
              idempotencyKey:
                input.hangupIdempotencyKeys?.[leg.id] ??
                `settle:${input.callId}:hangup:${leg.id}`,
              practiceId: call.practiceId,
              type: "HANGUP_LEG",
            },
          },
        }));
      commandIds.push(command.id);
    }

    if (LIVE_AGENT_LEG_STATUSES.includes(leg.status as never)) {
      await transaction.callCenterCallLeg.updateMany({
        data: {
          endedAt: input.now,
          errorCode: input.reason,
          status: input.terminalLegStatus ?? "ENDED",
        },
        where: { id: leg.id },
      });
    }
  }

  await clearSettledTransferDeadline(transaction, input.callId);
  return [...new Set(commandIds)];
}
