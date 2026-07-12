import { describe, expect, it } from "bun:test";

import {
  recordShadowRoutingDecision,
  type ShadowRoutingContext,
  type ShadowRoutingDecisionEvent,
  type ShadowRoutingStore,
  type ShadowRoutingTransaction,
} from "../shadow-routing";

const now = new Date("2026-07-12T12:00:00.000Z");

function context(
  routingMode: "LEGACY" | "SHADOW" | "ACTIVE" = "SHADOW",
): ShadowRoutingContext {
  return {
    callId: "call-1",
    direction: "INBOUND",
    practiceId: "practice-1",
    queue: {
      enabled: true,
      id: "queue-1",
      locationIds: ["location-1"],
      members: [
        {
          enabled: true,
          userId: "user-1",
          sessions: [
            {
              audioReady: true,
              connectionState: "READY",
              currentCallId: null,
              endpoint: {
                configured: true,
                enabled: true,
                id: "endpoint-1",
                locationId: "location-1",
              },
              id: "session-1",
              leaseExpiresAt: new Date(now.getTime() + 30_000),
              microphoneReady: true,
              presence: "AVAILABLE",
            },
          ],
        },
      ],
      routingMode,
    },
    status: "RECEIVED",
  };
}

class MemoryShadowStore implements ShadowRoutingStore, ShadowRoutingTransaction {
  appendCount = 0;
  private event: ShadowRoutingDecisionEvent | null = null;
  private lock = Promise.resolve();

  constructor(readonly routingContext: ShadowRoutingContext) {}

  async appendDecision(
    _context: ShadowRoutingContext,
    decision: Parameters<ShadowRoutingTransaction["appendDecision"]>[1],
    occurredAt: Date,
  ) {
    this.appendCount += 1;
    this.event = { data: decision, occurredAt, revision: BigInt(42) };
    return this.event;
  }

  async findDecision() {
    return this.event;
  }

  async loadContext() {
    return this.routingContext;
  }

  withCallLock<T>(
    _practiceId: string,
    _callId: string,
    work: (transaction: ShadowRoutingTransaction) => Promise<T>,
  ): Promise<T> {
    const result = this.lock.then(() => work(this));
    this.lock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

describe("shadow routing receipt", () => {
  it("persists one decision and returns the original receipt on retry", async () => {
    const store = new MemoryShadowStore(context());
    const first = await recordShadowRoutingDecision(
      store,
      { callId: "call-1", practiceId: "practice-1" },
      now,
    );
    const replay = await recordShadowRoutingDecision(
      store,
      { callId: "call-1", practiceId: "practice-1" },
      new Date(now.getTime() + 10_000),
    );

    expect(first).toMatchObject({ replayed: false, revision: "42" });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(store.appendCount).toBe(1);
  });

  it("serializes concurrent retries into one immutable event", async () => {
    const store = new MemoryShadowStore(context());
    const receipts = await Promise.all(
      Array.from({ length: 12 }, () =>
        recordShadowRoutingDecision(
          store,
          { callId: "call-1", practiceId: "practice-1" },
          now,
        ),
      ),
    );

    expect(store.appendCount).toBe(1);
    expect(
      receipts.filter((receipt) => "replayed" in receipt && !receipt.replayed),
    ).toHaveLength(1);
    expect(
      receipts.every((receipt) => "revision" in receipt && receipt.revision === "42"),
    ).toBe(true);
  });

  for (const mode of ["LEGACY", "ACTIVE"] as const) {
    it(`does not evaluate or persist a ${mode} queue`, async () => {
      const routingContext = context(mode);
      Object.defineProperty(routingContext.queue, "members", {
        get() {
          throw new Error("routing decision must not run");
        },
      });
      const store = new MemoryShadowStore(routingContext);

      await expect(
        recordShadowRoutingDecision(
          store,
          { callId: "call-1", practiceId: "practice-1" },
          now,
        ),
      ).resolves.toEqual({
        callId: "call-1",
        reason: "ROUTING_MODE_NOT_SHADOW",
        status: "SKIPPED",
      });
      expect(store.appendCount).toBe(0);
    });
  }

  it("replays the immutable receipt after the queue leaves shadow", async () => {
    const store = new MemoryShadowStore(context());
    const first = await recordShadowRoutingDecision(
      store,
      { callId: "call-1", practiceId: "practice-1" },
      now,
    );
    store.routingContext.queue!.routingMode = "LEGACY";

    await expect(
      recordShadowRoutingDecision(
        store,
        { callId: "call-1", practiceId: "practice-1" },
        now,
      ),
    ).resolves.toEqual({ ...first, replayed: true });
  });

  it("does not create a late decision after the call becomes terminal", async () => {
    const routingContext = context();
    routingContext.status = "COMPLETED";
    const store = new MemoryShadowStore(routingContext);

    await expect(
      recordShadowRoutingDecision(
        store,
        { callId: "call-1", practiceId: "practice-1", source: "RECOVERY" },
        now,
      ),
    ).resolves.toEqual({
      callId: "call-1",
      reason: "CALL_TERMINAL",
      status: "SKIPPED",
    });
    expect(store.appendCount).toBe(0);
  });

  it("labels recovery evidence separately from inline evidence", async () => {
    const store = new MemoryShadowStore(context());

    await expect(
      recordShadowRoutingDecision(
        store,
        { callId: "call-1", practiceId: "practice-1", source: "RECOVERY" },
        now,
      ),
    ).resolves.toMatchObject({ source: "RECOVERY" });
  });
});
