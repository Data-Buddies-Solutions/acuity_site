import type { ProviderCommandDispatchResult } from "@/lib/call-center/application/dispatch-provider-command";
import {
  executeIdempotentOperation,
  type OperationReceipt,
  type OperationReceiptTransaction,
} from "@/lib/call-center/application/operation-receipts";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

const CALL_HOLD_MUSIC_REQUESTED_EVENT = "CALL_HOLD_MUSIC_REQUESTED";

export type HoldMusicAction = "START" | "STOP";

export type SetCallHoldMusicInput = {
  action: HoldMusicAction;
  callId: string;
  expectedStateVersion: number;
  idempotencyKey: string;
};

export type SetCallHoldMusicReceipt = Omit<OperationReceipt, "status"> & {
  action: HoldMusicAction;
  callId: string;
  commandId: string;
  operationType: "HOLD_MUSIC";
  status: "CONFIRMED";
};

export interface SetCallHoldMusicTransaction extends OperationReceiptTransaction {
  createHoldMusicCommand(
    actor: QueueAccessActor,
    input: SetCallHoldMusicInput,
    now: Date,
  ): Promise<{
    action: HoldMusicAction;
    callId: string;
    commandId: string;
    operationType: "HOLD_MUSIC";
    status: "QUEUED";
  }>;
}

export interface SetCallHoldMusicStore {
  waitForCommandSettlement(
    commandId: string,
  ): Promise<"CONFIRMED" | "FAILED" | "TIMEOUT">;
  transaction<T>(
    operation: (transaction: SetCallHoldMusicTransaction) => Promise<T>,
  ): Promise<T>;
}

export class SetCallHoldMusicError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SetCallHoldMusicError";
  }
}

function dispatched(result: ProviderCommandDispatchResult) {
  return result.status === "DISPATCHED" || result.status === "SETTLED";
}

export async function setCallHoldMusic(
  store: SetCallHoldMusicStore,
  dispatch: (commandId: string) => Promise<ProviderCommandDispatchResult>,
  actor: QueueAccessActor,
  input: SetCallHoldMusicInput,
  now = new Date(),
): Promise<SetCallHoldMusicReceipt> {
  const receipt = await store.transaction((transaction) =>
    executeIdempotentOperation(
      transaction,
      {
        actorUserId: actor.userId,
        aggregateId: input.callId,
        aggregateType: "CALL",
        idempotencyKey: input.idempotencyKey,
        practiceId: actor.practiceId,
        targetFingerprint: JSON.stringify({
          action: input.action,
          callId: input.callId,
          expectedStateVersion: input.expectedStateVersion,
        }),
        type: CALL_HOLD_MUSIC_REQUESTED_EVENT,
      },
      (current) => current.createHoldMusicCommand(actor, input, now),
      now,
    ),
  );
  const commandId = String(receipt.commandId ?? "");
  if (!commandId) {
    throw new SetCallHoldMusicError("Hold music command was not created", 503);
  }
  const result = await dispatch(commandId);
  if (!dispatched(result)) {
    throw new SetCallHoldMusicError("Hold music command could not be completed", 503);
  }
  if ((await store.waitForCommandSettlement(commandId)) !== "CONFIRMED") {
    throw new SetCallHoldMusicError("Hold music command could not be confirmed", 503);
  }
  return {
    ...receipt,
    action: input.action,
    callId: input.callId,
    commandId,
    operationType: "HOLD_MUSIC",
    status: "CONFIRMED",
  } as SetCallHoldMusicReceipt;
}
