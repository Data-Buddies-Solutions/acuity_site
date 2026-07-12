import { describe, expect, it } from "bun:test";

import type {
  ProviderCommandClaim,
  ProviderCommandMarkSentResult,
  ProviderSendErrorClassification,
} from "@/lib/call-center/domain/provider-command";

import {
  createProviderCommandDispatcher,
  type ProviderCommandDispatchStore,
} from "../dispatch-provider-command";

const now = new Date("2026-07-12T12:00:00.000Z");
const claim: ProviderCommandClaim = {
  attemptCount: 1,
  command: {
    arguments: {
      agentSessionId: "session-1",
      endpointId: "endpoint-1",
    },
    callId: "call-1",
    commandId: "command-1",
    idempotencyKey: "dial:leg-1",
    legId: "leg-1",
    practiceId: "practice-1",
    provider: {
      connectionId: "connection-1",
      from: "+17865550101",
      linkTo: "customer-control-1",
      sipUri: "sip:agent-1@example.test",
      timeoutSeconds: 20,
    },
    type: "DIAL_AGENT",
  },
};

function setup({
  claimed = claim,
  enabled = true,
  errorClassification = {
    category: "RETRYABLE",
    code: "SENDING_OUTCOME_AMBIGUOUS",
  } as const,
  failResult = true,
  markSentResult = "MARKED" as ProviderCommandMarkSentResult,
}: {
  claimed?: ProviderCommandClaim | null;
  enabled?: boolean;
  errorClassification?: ProviderSendErrorClassification;
  failResult?: boolean;
  markSentResult?: ProviderCommandMarkSentResult;
} = {}) {
  const calls = {
    claim: [] as Array<Parameters<ProviderCommandDispatchStore["claim"]>[0]>,
    fail: [] as Array<Parameters<ProviderCommandDispatchStore["fail"]>[0]>,
    markSent: [] as Array<Parameters<ProviderCommandDispatchStore["markSent"]>[0]>,
    send: [] as ProviderCommandClaim["command"][],
  };
  const store: ProviderCommandDispatchStore = {
    claim: async (input) => {
      calls.claim.push(input);
      return claimed;
    },
    fail: async (input) => {
      calls.fail.push(input);
      return failResult;
    },
    markSent: async (input) => {
      calls.markSent.push(input);
      return markSentResult;
    },
  };
  let sendError: unknown;
  const dispatch = createProviderCommandDispatcher({
    classifyError: { classify: () => errorClassification },
    clock: () => now,
    enabled,
    sender: {
      send: async (command) => {
        calls.send.push(command);
        if (sendError) throw sendError;
      },
    },
    store,
  });

  return {
    calls,
    dispatch,
    throwOnSend(error: unknown) {
      sendError = error;
    },
  };
}

describe("provider command dispatcher", () => {
  it("is disabled by default before claim or send", async () => {
    let claims = 0;
    const dispatch = createProviderCommandDispatcher({
      classifyError: {
        classify: () => ({ category: "UNKNOWN", code: "PROVIDER_UNKNOWN" }),
      },
      sender: { send: async () => {} },
      store: {
        claim: async () => {
          claims += 1;
          return claim;
        },
        fail: async () => true,
        markSent: async () => "MARKED",
      },
    });

    await expect(dispatch("command-1")).resolves.toEqual({ status: "DISABLED" });
    expect(claims).toBe(0);
  });

  it("returns without sending when another worker owns the claim", async () => {
    const { calls, dispatch } = setup({ claimed: null });

    await expect(dispatch("command-1")).resolves.toEqual({ status: "NOT_CLAIMED" });
    expect(calls.send).toHaveLength(0);
  });

  it("sends the typed command and atomically marks the claimed attempt", async () => {
    const { calls, dispatch } = setup();

    await expect(dispatch("command-1")).resolves.toEqual({
      commandId: "command-1",
      markSent: "MARKED",
      status: "DISPATCHED",
    });
    expect(calls.claim).toEqual([
      {
        commandId: "command-1",
        maxAttempts: 5,
        now,
        staleBefore: new Date(now.getTime() - 60_000),
      },
    ]);
    expect(calls.send).toEqual([claim.command]);
    expect(calls.markSent).toEqual([{ attemptCount: 1, commandId: "command-1", now }]);
  });

  it("accepts a callback that confirms the command before mark-sent", async () => {
    const { calls, dispatch } = setup({ markSentResult: "ALREADY_CONFIRMED" });

    await expect(dispatch("command-1")).resolves.toEqual({
      commandId: "command-1",
      markSent: "ALREADY_CONFIRMED",
      status: "DISPATCHED",
    });
    expect(calls.fail).toHaveLength(0);
  });

  it("schedules a bounded retry for a classified transient failure", async () => {
    const { calls, dispatch, throwOnSend } = setup();
    throwOnSend(new Error("sanitized only by classifier"));

    await expect(dispatch("command-1")).resolves.toEqual({
      commandId: "command-1",
      errorCode: "SENDING_OUTCOME_AMBIGUOUS",
      nextAttemptAt: new Date(now.getTime() + 2_000),
      retryScheduled: true,
      status: "FAILED",
    });
    expect(calls.fail).toEqual([
      {
        attemptCount: 1,
        commandId: "command-1",
        errorCode: "SENDING_OUTCOME_AMBIGUOUS",
        nextAttemptAt: new Date(now.getTime() + 2_000),
        now,
      },
    ]);
    expect(calls.markSent).toHaveLength(0);
  });

  it("stops retrying at the attempt bound", async () => {
    const exhausted = { ...claim, attemptCount: 5 };
    const { calls, dispatch, throwOnSend } = setup({ claimed: exhausted });
    throwOnSend(new Error("timeout"));

    await expect(dispatch("command-1")).resolves.toMatchObject({
      nextAttemptAt: null,
      retryScheduled: false,
      status: "FAILED",
    });
    expect(calls.fail[0]?.nextAttemptAt).toBeNull();
  });

  it("does not overwrite a callback or a newer claim", async () => {
    const failed = setup({ failResult: false });
    failed.throwOnSend(new Error("timeout"));
    await expect(failed.dispatch("command-1")).resolves.toEqual({
      commandId: "command-1",
      phase: "FAIL",
      status: "STALE",
    });

    const sent = setup({ markSentResult: "STALE" });
    await expect(sent.dispatch("command-1")).resolves.toEqual({
      commandId: "command-1",
      phase: "MARK_SENT",
      status: "STALE",
    });
  });

  it("fails closed when error classification itself fails", async () => {
    const calls: Array<Parameters<ProviderCommandDispatchStore["fail"]>[0]> = [];
    const dispatch = createProviderCommandDispatcher({
      classifyError: {
        classify: () => {
          throw new Error("bad classifier");
        },
      },
      clock: () => now,
      enabled: true,
      sender: {
        send: async () => {
          throw new Error("provider failure");
        },
      },
      store: {
        claim: async () => claim,
        fail: async (input) => {
          calls.push(input);
          return true;
        },
        markSent: async () => "MARKED",
      },
    });

    await expect(dispatch("command-1")).resolves.toMatchObject({
      errorCode: "PROVIDER_UNKNOWN",
      nextAttemptAt: null,
      retryScheduled: false,
      status: "FAILED",
    });
    expect(calls[0]?.errorCode).toBe("PROVIDER_UNKNOWN");
  });
});
