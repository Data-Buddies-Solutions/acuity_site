import { describe, expect, it } from "bun:test";

import type {
  ProviderCommandClaim,
  ProviderCommandMarkSentResult,
  ProviderSendErrorClassification,
} from "@/lib/call-center/domain/provider-command";

import {
  createProviderCommandDispatcher,
  dispatchProviderCommandGraph,
  type ProviderCommandDispatchStore,
  type ProviderCommandRejectedClaim,
  type ProviderCommandSettledClaim,
} from "../dispatch-provider-command";

const now = new Date("2026-07-12T12:00:00.000Z");
const claim: ProviderCommandClaim = {
  attemptCount: 1,
  command: {
    arguments: {
      agentSessionId: "session-1",
      endpointId: "endpoint-1",
      timeoutSeconds: 20,
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
    code: "SENDING_OUTCOME_AMBIGUOUS",
  } as const,
  failResult = { commandIds: [] } as { commandIds: string[] } | null,
  markSentResult = "MARKED" as ProviderCommandMarkSentResult,
}: {
  claimed?:
    | ProviderCommandClaim
    | ProviderCommandRejectedClaim
    | ProviderCommandSettledClaim
    | null;
  enabled?: boolean;
  errorClassification?: ProviderSendErrorClassification;
  failResult?: { commandIds: string[] } | null;
  markSentResult?: ProviderCommandMarkSentResult;
} = {}) {
  const calls = {
    claim: [] as Array<Parameters<ProviderCommandDispatchStore["claim"]>[0]>,
    fail: [] as Array<Parameters<ProviderCommandDispatchStore["fail"]>[0]>,
    markConfirmed: [] as Array<
      Parameters<ProviderCommandDispatchStore["markConfirmed"]>[0]
    >,
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
    markConfirmed: async (input) => {
      calls.markConfirmed.push(input);
      return "MARKED";
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
  it("dispatches every committed inline command without the recovery batch cap", async () => {
    const commandIds = Array.from({ length: 502 }, (_, index) => `command-${index}`);

    await expect(
      dispatchProviderCommandGraph({
        commandIds,
        dispatch: async (commandId) => ({
          commandId,
          markSent: "MARKED",
          status: "DISPATCHED",
        }),
      }),
    ).resolves.toMatchObject({
      attempted: 502,
      deferred: [],
      dispatched: 502,
      failures: [],
    });
  });

  it("reports commands left behind by an explicit recovery batch cap", async () => {
    await expect(
      dispatchProviderCommandGraph({
        commandIds: ["command-1", "command-2", "command-3"],
        dispatch: async (commandId) => ({
          commandId,
          markSent: "MARKED",
          status: "DISPATCHED",
        }),
        limit: 2,
      }),
    ).resolves.toEqual({
      attempted: 2,
      deferred: ["command-3"],
      dispatched: 2,
      failures: [],
    });
  });

  it("retries dependency-blocked commands in concurrent progress rounds", async () => {
    let prerequisiteSent = false;
    const attempts: string[] = [];

    await expect(
      dispatchProviderCommandGraph({
        commandIds: ["answer-command", "dial-command"],
        dispatch: async (commandId) => {
          attempts.push(commandId);
          if (commandId === "answer-command") {
            await Promise.resolve();
            prerequisiteSent = true;
            return {
              commandId,
              markSent: "MARKED",
              status: "DISPATCHED",
            };
          }
          return prerequisiteSent
            ? {
                commandId,
                markSent: "MARKED",
                status: "DISPATCHED",
              }
            : { status: "NOT_CLAIMED" };
        },
      }),
    ).resolves.toEqual({
      attempted: 2,
      deferred: [],
      dispatched: 2,
      failures: [],
    });
    expect(attempts).toEqual(["answer-command", "dial-command", "dial-command"]);
  });

  it("is disabled by default before claim or send", async () => {
    let claims = 0;
    const dispatch = createProviderCommandDispatcher({
      classifyError: {
        classify: () => ({ code: "PROVIDER_UNKNOWN" }),
      },
      sender: { send: async () => {} },
      store: {
        claim: async () => {
          claims += 1;
          return claim;
        },
        fail: async () => ({ commandIds: [] }),
        markConfirmed: async () => "MARKED",
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

  it("recognizes a command that a prior idempotent request already settled", async () => {
    const { calls, dispatch } = setup({
      claimed: { commandId: "command-1", settled: true },
    });

    await expect(dispatch("command-1")).resolves.toEqual({
      commandId: "command-1",
      status: "SETTLED",
    });
    expect(calls.send).toHaveLength(0);
  });

  it("returns follow-up commands from a terminal claim rejection", async () => {
    const { calls, dispatch } = setup({
      claimed: {
        commandId: "command-1",
        errorCode: "COMMAND_ARGUMENTS_INVALID",
        followUpCommandIds: ["voicemail-command"],
        rejected: true,
      },
    });

    await expect(dispatch("command-1")).resolves.toEqual({
      commandId: "command-1",
      errorCode: "COMMAND_ARGUMENTS_INVALID",
      followUpCommandIds: ["voicemail-command"],
      status: "REJECTED",
    });
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

  it("confirms a stop that the provider reports was already settled", async () => {
    const calls: Array<Parameters<ProviderCommandDispatchStore["markConfirmed"]>[0]> = [];
    const dispatch = createProviderCommandDispatcher({
      classifyError: { classify: () => ({ code: "PROVIDER_UNKNOWN" }) },
      clock: () => now,
      enabled: true,
      sender: { send: async () => ({ alreadySettled: true }) },
      store: {
        claim: async () => claim,
        fail: async () => ({ commandIds: [] }),
        markConfirmed: async (input) => {
          calls.push(input);
          return "MARKED";
        },
        markSent: async () => "MARKED",
      },
    });

    await expect(dispatch("command-1")).resolves.toEqual({
      commandId: "command-1",
      status: "SETTLED",
    });
    expect(calls).toEqual([{ attemptCount: 1, commandId: "command-1", now }]);
  });

  it("leaves an ambiguous send for the stale-command recovery owner", async () => {
    const { calls, dispatch, throwOnSend } = setup();
    throwOnSend(new Error("sanitized only by classifier"));

    await expect(dispatch("command-1")).resolves.toEqual({
      commandId: "command-1",
      errorCode: "SENDING_OUTCOME_AMBIGUOUS",
      status: "DEFERRED",
    });
    expect(calls.fail).toHaveLength(0);
    expect(calls.markSent).toHaveLength(0);
  });

  it("defers rate limits to the same bounded recovery owner", async () => {
    const { calls, dispatch, throwOnSend } = setup({
      errorClassification: { code: "PROVIDER_RATE_LIMITED" },
    });
    throwOnSend(new Error("rate limited"));

    await expect(dispatch("command-1")).resolves.toEqual({
      commandId: "command-1",
      errorCode: "PROVIDER_RATE_LIMITED",
      status: "DEFERRED",
    });
    expect(calls.fail).toHaveLength(0);
  });

  it("does not overwrite a callback or a newer claim", async () => {
    const failed = setup({
      errorClassification: { code: "PROVIDER_UNKNOWN" },
      failResult: null,
    });
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
          return { commandIds: [] };
        },
        markConfirmed: async () => "MARKED",
        markSent: async () => "MARKED",
      },
    });

    await expect(dispatch("command-1")).resolves.toMatchObject({
      errorCode: "PROVIDER_UNKNOWN",
      status: "FAILED",
    });
    expect(calls[0]?.errorCode).toBe("PROVIDER_UNKNOWN");
  });
});
