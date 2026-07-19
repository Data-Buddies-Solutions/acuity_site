import { describe, expect, it } from "bun:test";

import type { OperationReceiptEvent } from "../operation-receipts";
import {
  FailedBrowserOfferRecoveryError,
  recoverFailedBrowserOffer,
  replaceFailedBrowserOffer,
  type FailedBrowserOfferRecoveryContext,
  type FailedBrowserOfferRecoveryStore,
  type FailedBrowserOfferRecoveryTransaction,
} from "../replace-failed-browser-offer";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const input = {
  agentSessionId: "session-1",
  callId: "call-1",
  callLegId: "leg-1",
  clientInstanceId: "browser-1",
  idempotencyKey: "recover-1",
  reason: "CALL_DOES_NOT_EXIST" as const,
  recoveryGeneration: 2,
};
const now = new Date("2026-07-19T12:00:10.000Z");

function context(
  update: Partial<FailedBrowserOfferRecoveryContext> = {},
): FailedBrowserOfferRecoveryContext {
  return {
    call: {
      deadlineAt: new Date("2026-07-19T12:00:20.000Z"),
      direction: "INBOUND",
      id: "call-1",
      practiceId: "practice-1",
      queueId: "queue-1",
      status: "RINGING",
      voicemailStartedAt: null,
      winningLegId: null,
    },
    leg: {
      agentSessionId: "session-1",
      attemptNumber: 1,
      endpointId: "endpoint-1",
      id: "leg-1",
      isCurrent: true,
      kind: "AGENT",
      providerCallControlId: "control-1",
      status: "RINGING",
    },
    session: {
      browserSessionId: "browser-1",
      endpointId: "endpoint-1",
      id: "session-1",
      leaseExpiresAt: new Date("2026-07-19T12:01:00.000Z"),
      userId: "user-1",
    },
    ...update,
  };
}

function fakeStore(initial = context()) {
  let revision = BigInt(0);
  let replacementCount = 0;
  let transactionTail = Promise.resolve();
  const receipts = new Map<string, OperationReceiptEvent>();
  const replacement = {
    dialCommandId: "dial-command-1",
    hangupCommandId: "hangup-command-1",
    newCallLegId: "leg-2",
    stateVersion: 8,
  };
  const transaction: FailedBrowserOfferRecoveryTransaction = {
    async appendReceipt(receiptInput, data, occurredAt) {
      const event = {
        actorUserId: receiptInput.actorUserId,
        aggregateId: receiptInput.aggregateId,
        aggregateType: receiptInput.aggregateType,
        data,
        occurredAt,
        revision: ++revision,
      };
      receipts.set(receiptInput.idempotencyKey, event);
      return event;
    },
    async createReplacement() {
      replacementCount += 1;
      return replacement;
    },
    async findReceipt(_practiceId, _type, idempotencyKey) {
      return receipts.get(idempotencyKey) ?? null;
    },
    async loadContext() {
      return initial;
    },
    async lockReceiptKey() {},
  };
  const store: FailedBrowserOfferRecoveryStore = {
    async withTransaction(work) {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await work(transaction);
      } finally {
        release();
      }
    },
  };
  return { replacement, replacementCount: () => replacementCount, store };
}

describe("failed browser offer replacement", () => {
  it("commits one replacement graph without extending the original deadline", async () => {
    const fake = fakeStore();

    const receipt = await replaceFailedBrowserOffer(fake.store, actor, input, now);

    expect(receipt).toMatchObject({
      callId: "call-1",
      deadlineAt: "2026-07-19T12:00:20.000Z",
      dialCommandId: fake.replacement.dialCommandId,
      hangupCommandId: fake.replacement.hangupCommandId,
      newCallLegId: fake.replacement.newCallLegId,
      oldCallLegId: "leg-1",
      operationType: "BROWSER_OFFER_REPLACEMENT",
      reason: "CALL_DOES_NOT_EXIST",
      replayed: false,
      stateVersion: 8,
    });
    expect(fake.replacementCount()).toBe(1);
  });

  it("replays the same recovery identity without creating another leg", async () => {
    const fake = fakeStore();

    const first = await replaceFailedBrowserOffer(fake.store, actor, input, now);
    const replay = await replaceFailedBrowserOffer(fake.store, actor, input, now);

    expect(replay).toEqual({ ...first, replayed: true });
    expect(fake.replacementCount()).toBe(1);
  });

  it("serializes concurrent reports into one replacement attempt", async () => {
    const fake = fakeStore();

    const receipts = await Promise.all([
      replaceFailedBrowserOffer(fake.store, actor, input, now),
      replaceFailedBrowserOffer(fake.store, actor, input, now),
    ]);

    expect(receipts.map(({ replayed }) => replayed).sort()).toEqual([false, true]);
    expect(fake.replacementCount()).toBe(1);
  });

  it("retries the same committed commands without creating another provider leg", async () => {
    const fake = fakeStore();
    const dispatched: string[] = [];
    let deferred = true;
    const dispatch = async (commandId: string) => {
      dispatched.push(commandId);
      return deferred
        ? ({
            commandId,
            errorCode: "PROVIDER_RATE_LIMITED",
            status: "DEFERRED",
          } as const)
        : ({
            commandId,
            markSent: "MARKED",
            status: "DISPATCHED",
          } as const);
    };

    const first = await recoverFailedBrowserOffer(
      fake.store,
      actor,
      input,
      now,
      dispatch,
    );
    deferred = false;
    const replay = await recoverFailedBrowserOffer(
      fake.store,
      actor,
      input,
      now,
      dispatch,
    );

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(fake.replacementCount()).toBe(1);
    expect(dispatched.sort()).toEqual(
      [
        fake.replacement.dialCommandId,
        fake.replacement.dialCommandId,
        fake.replacement.hangupCommandId,
        fake.replacement.hangupCommandId,
      ].sort(),
    );
  });

  it("rejects replacement after the fixed deadline or after a winner exists", async () => {
    const expired = fakeStore(
      context({
        call: {
          ...context().call,
          deadlineAt: now,
        },
      }),
    );
    const won = fakeStore(
      context({
        call: {
          ...context().call,
          winningLegId: "leg-other",
        },
      }),
    );

    await expect(
      replaceFailedBrowserOffer(expired.store, actor, input, now),
    ).rejects.toBeInstanceOf(FailedBrowserOfferRecoveryError);
    await expect(
      replaceFailedBrowserOffer(won.store, actor, input, now),
    ).rejects.toBeInstanceOf(FailedBrowserOfferRecoveryError);
    expect(expired.replacementCount()).toBe(0);
    expect(won.replacementCount()).toBe(0);
  });

  it("rejects a superseded or terminal agent leg", async () => {
    const superseded = fakeStore(
      context({
        leg: {
          ...context().leg,
          isCurrent: false,
        },
      }),
    );
    const terminal = fakeStore(
      context({
        leg: {
          ...context().leg,
          status: "FAILED",
        },
      }),
    );

    await expect(
      replaceFailedBrowserOffer(superseded.store, actor, input, now),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      replaceFailedBrowserOffer(terminal.store, actor, input, now),
    ).rejects.toMatchObject({ status: 409 });
    expect(superseded.replacementCount()).toBe(0);
    expect(terminal.replacementCount()).toBe(0);
  });

  it("rejects an Agent Session, endpoint, or browser ownership mismatch", async () => {
    const mismatched = fakeStore(
      context({
        session: {
          ...context().session,
          browserSessionId: "browser-other",
        },
      }),
    );

    await expect(
      replaceFailedBrowserOffer(mismatched.store, actor, input, now),
    ).rejects.toMatchObject({ status: 403 });
    expect(mismatched.replacementCount()).toBe(0);
  });
});
