import { describe, expect, it } from "bun:test";

import {
  advanceCanonicalCall,
  advanceCanonicalLeg,
  normalizeCanonicalCallState,
  terminalCallObservation,
  type CanonicalCallStatus,
  type CanonicalCallState,
  type CanonicalLegState,
} from "../canonical-call-state";

const at = (value: string) => new Date(value);
const startedAt = at("2026-07-11T10:00:00.000Z");

function call(): CanonicalCallState {
  return {
    answeredAt: null,
    endedAt: null,
    firstRingAt: null,
    queuedAt: null,
    stateVersion: 0,
    status: "RECEIVED",
    voicemailStartedAt: null,
  };
}

function leg(): CanonicalLegState {
  return {
    answeredAt: null,
    bridgedAt: null,
    endedAt: null,
    status: "CREATED",
  };
}

function permutations<T>(values: ReadonlyArray<T>): T[][] {
  if (values.length < 2) return [values.slice()];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map((rest) => [
      value,
      ...rest,
    ]),
  );
}

describe("passive canonical call state", () => {
  it("reads rollback-only wrap-up calls as completed", () => {
    expect(normalizeCanonicalCallState({ status: "WRAP_UP" }).status).toBe("COMPLETED");
  });

  it("converges under duplicate and out-of-order non-terminal observations", () => {
    const forward: ReadonlyArray<readonly [CanonicalCallStatus, string]> = [
      ["QUEUED", "2026-07-11T10:00:00.000Z"],
      ["RINGING", "2026-07-11T10:00:01.000Z"],
      ["CONNECTED", "2026-07-11T10:00:05.000Z"],
    ];
    const reduce = (observations: typeof forward) =>
      observations.reduce(
        (state, [status, occurredAt]) =>
          advanceCanonicalCall(state, status, at(occurredAt)),
        call(),
      );

    const outOfOrder = reduce([forward[2], forward[0], forward[1]]);
    expect(outOfOrder.status).toBe("CONNECTED");
    expect(outOfOrder.queuedAt).toEqual(startedAt);
    expect(outOfOrder.firstRingAt).toEqual(at("2026-07-11T10:00:01.000Z"));
    expect(outOfOrder.answeredAt).toEqual(at("2026-07-11T10:00:05.000Z"));
    expect(advanceCanonicalCall(outOfOrder, "CONNECTED", at(forward[2][1]))).toBe(
      outOfOrder,
    );
  });

  it("keeps terminal outcomes closed while accepting stronger late evidence", () => {
    const abandoned = advanceCanonicalCall(call(), "ABANDONED", startedAt);
    const voicemail = advanceCanonicalCall(
      abandoned,
      "VOICEMAIL",
      at("2026-07-11T10:00:10.000Z"),
    );
    const lateBridge = advanceCanonicalCall(
      abandoned,
      "CONNECTED",
      at("2026-07-11T09:59:59.000Z"),
      { hasBridgeEvidence: true },
    );

    expect(lateBridge.status).toBe("COMPLETED");
    expect(voicemail.status).toBe("VOICEMAIL");
    expect(
      advanceCanonicalCall(voicemail, "CONNECTED", at("2026-07-11T10:00:05.000Z")).status,
    ).toBe("VOICEMAIL");
  });

  it("converges to completed for every bridge and hangup delivery order", () => {
    type Observation = readonly [CanonicalCallStatus | "HANGUP", string];
    const observations: ReadonlyArray<Observation> = [
      ["QUEUED", "2026-07-11T10:00:00.000Z"],
      ["RINGING", "2026-07-11T10:00:01.000Z"],
      ["CONNECTED", "2026-07-11T10:00:05.000Z"],
      ["HANGUP", "2026-07-11T10:02:00.000Z"],
    ];
    for (const ordered of permutations(observations)) {
      let hasBridgeEvidence = false;
      const final = ordered.reduce<CanonicalCallState>(
        (state, [observed, occurredAt]) => {
          hasBridgeEvidence ||= observed === "CONNECTED";
          const status =
            observed === "HANGUP" ? terminalCallObservation(state.status) : observed;
          return advanceCanonicalCall(state, status, at(occurredAt), {
            hasBridgeEvidence,
          });
        },
        call(),
      );

      expect(final.status).toBe("COMPLETED");
      expect(final.answeredAt).toEqual(at("2026-07-11T10:00:05.000Z"));
      expect(final.endedAt).toEqual(at("2026-07-11T10:02:00.000Z"));
    }
  });

  it("never lets voicemail override a winning bridge in either delivery order", () => {
    const apply = (order: ReadonlyArray<"BRIDGE" | "VOICEMAIL">) => {
      let hasBridgeEvidence = false;
      return order.reduce((state, fact) => {
        hasBridgeEvidence ||= fact === "BRIDGE";
        return advanceCanonicalCall(
          state,
          fact === "BRIDGE" ? "CONNECTED" : "VOICEMAIL",
          fact === "BRIDGE"
            ? at("2026-07-11T10:00:05.000Z")
            : at("2026-07-11T10:02:00.000Z"),
          { hasBridgeEvidence },
        );
      }, call());
    };

    for (const order of [
      ["BRIDGE", "VOICEMAIL"],
      ["VOICEMAIL", "BRIDGE"],
    ] as const) {
      const final = apply(order);
      expect(final.status).toBe("COMPLETED");
      expect(final.answeredAt).toEqual(at("2026-07-11T10:00:05.000Z"));
      expect(final.voicemailStartedAt).toEqual(at("2026-07-11T10:02:00.000Z"));
    }
  });

  it("keeps terminal leg outcomes sticky while retaining late timestamps", () => {
    const ended = advanceCanonicalLeg(leg(), "ENDED", at("2026-07-11T10:02:00Z"));
    const lateBridge = advanceCanonicalLeg(ended, "BRIDGED", at("2026-07-11T10:00:05Z"));

    expect(lateBridge).toMatchObject({
      answeredAt: at("2026-07-11T10:00:05Z"),
      bridgedAt: at("2026-07-11T10:00:05Z"),
      status: "ENDED",
    });
  });
});
