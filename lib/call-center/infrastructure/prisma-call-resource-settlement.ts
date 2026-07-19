import { Prisma } from "@/generated/prisma/client";
import { LIVE_CANONICAL_LEG_STATUSES } from "@/lib/call-center/domain/canonical-call-state";
import { reconcileFailedTransferWithEndedSource } from "@/lib/call-center/infrastructure/prisma-failed-transfer-reconciliation";
import { settleProviderCommandsForTerminalLeg } from "@/lib/call-center/infrastructure/prisma-provider-command-failures";

type Transaction = Prisma.TransactionClient;

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
  if (legs.length === 0) return [];

  const call = await transaction.callCenterCall.findUnique({
    select: { practiceId: true },
    where: { id: input.callId },
  });
  if (!call) return [];

  const commandIds: string[] = [];
  for (const leg of legs) {
    const failedCommandIds = await settleProviderCommandsForTerminalLeg(transaction, {
      exceptTypes: ["HANGUP_LEG"],
      legId: leg.id,
      now: input.now,
    });
    for (const commandId of failedCommandIds) {
      const transfer = await reconcileFailedTransferWithEndedSource(
        transaction,
        { commandId, now: input.now },
        settleCanonicalCallLegs,
      );
      commandIds.push(...transfer.commandIds);
    }

    if (
      leg.providerCallControlId &&
      (LIVE_CANONICAL_LEG_STATUSES.includes(leg.status as never) ||
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

    if (LIVE_CANONICAL_LEG_STATUSES.includes(leg.status as never)) {
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

  return [...new Set(commandIds)];
}
