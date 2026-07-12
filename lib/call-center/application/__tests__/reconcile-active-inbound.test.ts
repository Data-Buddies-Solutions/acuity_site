import { describe, expect, it } from "bun:test";

import type { ActiveInboundLifecycleDecision } from "@/lib/call-center/domain/active-inbound-lifecycle";

import {
  createActiveInboundLifecycleRecovery,
  reconcileActiveInboundCall,
  type ActiveInboundReconciliationStore,
} from "../reconcile-active-inbound";

const now = new Date("2026-07-12T12:00:00.000Z");

function decision(
  disposition: ActiveInboundLifecycleDecision["disposition"],
): ActiveInboundLifecycleDecision {
  return {
    deadlineAt: now,
    disposition,
    intents: [],
    pendingReplacementLegIds: [],
    queueDeadlineAt: now,
    status: disposition === "ABANDONED" ? "ABANDONED" : "QUEUED",
    winningLegId: null,
  };
}

describe("ACTIVE inbound lifecycle application", () => {
  it("passes a callback to the store without provider effects", async () => {
    const calls: unknown[] = [];
    const store: ActiveInboundReconciliationStore = {
      reconcile: async (input, at) => {
        calls.push({ at, input });
        return {
          callId: input.callId,
          commandIds: ["command-1"],
          decision: decision("CONNECTED"),
          status: "APPLIED",
        };
      },
      reconcileDue: async () => [],
    };

    await expect(
      reconcileActiveInboundCall(
        store,
        {
          callId: "call-1",
          practiceId: "practice-1",
          processedBridgeLegId: "leg-1",
        },
        now,
      ),
    ).resolves.toMatchObject({ commandIds: ["command-1"], status: "APPLIED" });
    expect(calls).toEqual([
      {
        at: now,
        input: {
          callId: "call-1",
          practiceId: "practice-1",
          processedBridgeLegId: "leg-1",
        },
      },
    ]);
  });

  it("recovers one bounded aggregate batch", async () => {
    let requested: unknown;
    const store: ActiveInboundReconciliationStore = {
      reconcile: async () => {
        throw new Error("not used");
      },
      reconcileDue: async (input) => {
        requested = input;
        return [
          {
            callId: "1",
            commandIds: [],
            decision: decision("OVERFLOW"),
            status: "APPLIED",
          },
          {
            callId: "2",
            commandIds: [],
            decision: decision("VOICEMAIL"),
            status: "APPLIED",
          },
          {
            callId: "3",
            commandIds: [],
            decision: null,
            status: "SKIPPED",
          },
          {
            callId: "4",
            commandIds: [],
            decision: null,
            errorCode: "ACTIVE_INBOUND_RECONCILIATION_FAILED",
            status: "FAILED",
          },
        ];
      },
    };

    const recover = createActiveInboundLifecycleRecovery({ clock: () => now, store });

    await expect(recover()).resolves.toEqual({
      abandoned: 0,
      connected: 0,
      failed: 1,
      overflowed: 1,
      selected: 4,
      skipped: 1,
      voicemail: 1,
      waiting: 0,
    });
    expect(requested).toEqual({ limit: 5, now });
  });
});
