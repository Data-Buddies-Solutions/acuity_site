import { describe, expect, it } from "bun:test";

import type { ProviderCommandDispatchData } from "@/lib/call-center/domain/provider-command";
import { TelnyxError } from "@/lib/telnyx";

import {
  canonicalCommandClientState,
  createTelnyxProviderCommandSender,
  telnyxProviderSendErrorClassifier,
} from "../telnyx-provider-command-sender";

const command: ProviderCommandDispatchData = {
  arguments: { agentSessionId: "session-1", endpointId: "endpoint-1" },
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
};

describe("Telnyx provider command sender", () => {
  it("encodes only stable canonical correlation IDs", () => {
    expect(
      JSON.parse(
        Buffer.from(canonicalCommandClientState(command), "base64").toString("utf8"),
      ),
    ).toEqual({
      callId: "call-1",
      canonicalCommand: true,
      commandId: "command-1",
      endpointId: "endpoint-1",
      internalAgentLeg: true,
      legId: "leg-1",
    });
  });

  it("classifies provider failures without persisting provider detail", () => {
    expect(
      telnyxProviderSendErrorClassifier.classify(
        new TelnyxError("secret response", 429, "secret detail"),
      ),
    ).toEqual({ code: "PROVIDER_RATE_LIMITED" });
    expect(
      telnyxProviderSendErrorClassifier.classify(
        new TelnyxError("secret response", 422, "secret detail"),
      ),
    ).toEqual({ code: "PROVIDER_VALIDATION_FAILED" });
    expect(
      telnyxProviderSendErrorClassifier.classify(
        new TelnyxError("secret response", 503, "secret detail"),
      ),
    ).toEqual({ code: "SENDING_OUTCOME_AMBIGUOUS" });
  });

  it("prevents a dial from creating a second bridge", async () => {
    const dials: Record<string, unknown>[] = [];
    const sender = createTelnyxProviderCommandSender({
      answer: async () => new Response(null, { status: 204 }),
      dial: async (input) => {
        dials.push(input as unknown as Record<string, unknown>);
        return {};
      },
      hangup: async () => new Response(null, { status: 204 }),
      playbackStart: async () => new Response(null, { status: 204 }),
      playbackStop: async () => new Response(null, { status: 204 }),
      recordStart: async () => new Response(null, { status: 204 }),
      ringbackContent: () => "ringback",
      speak: async () => new Response(null, { status: 204 }),
      transfer: async () => new Response(null, { status: 204 }),
    });
    await sender.send(command);

    const dialed = dials[0];
    expect(dialed).toMatchObject({
      bridgeOnAnswer: true,
      linkTo: "customer-control-1",
      preventDoubleBridge: true,
    });
    expect(
      JSON.parse(Buffer.from(String(dialed?.clientState), "base64").toString("utf8")),
    ).toEqual({
      callId: "call-1",
      canonicalCommand: true,
      commandId: "command-1",
      endpointId: "endpoint-1",
      internalAgentLeg: true,
      legId: "leg-1",
    });
  });

  it("originates the outbound customer as its own provider leg", async () => {
    const dials: Record<string, unknown>[] = [];
    const sender = createTelnyxProviderCommandSender({
      dial: async (input) => {
        dials.push(input as unknown as Record<string, unknown>);
        return {};
      },
    });

    await sender.send({
      arguments: {},
      callId: "call-1",
      commandId: "dial-customer-1",
      idempotencyKey: "outbound:customer",
      legId: "customer-leg-1",
      practiceId: "practice-1",
      provider: {
        connectionId: "connection-1",
        from: "+17865550101",
        timeoutSeconds: 60,
        to: "+17865550102",
      },
      type: "DIAL_CUSTOMER",
    });

    expect(dials).toEqual([
      {
        clientState: expect.any(String),
        commandId: "dial-customer-1",
        connectionId: "connection-1",
        from: "+17865550101",
        timeoutSecs: 60,
        to: "+17865550102",
      },
    ]);
    expect(
      JSON.parse(Buffer.from(String(dials[0]?.clientState), "base64").toString("utf8")),
    ).toEqual({
      callId: "call-1",
      canonicalCommand: true,
      commandId: "dial-customer-1",
      legId: "customer-leg-1",
    });
  });

  it("maps every initial lifecycle command to one idempotent Telnyx action", async () => {
    const calls: Array<[string, unknown]> = [];
    const response = () => new Response(null, { status: 204 });
    const sender = createTelnyxProviderCommandSender({
      answer: async (...args) => {
        calls.push(["answer", args]);
        return response();
      },
      dial: async (args) => {
        calls.push(["dial", args]);
        return {};
      },
      hangup: async (...args) => {
        calls.push(["hangup", args]);
        return response();
      },
      playbackStart: async (args) => {
        calls.push(["playbackStart", args]);
        return response();
      },
      playbackStop: async (...args) => {
        calls.push(["playbackStop", args]);
        return response();
      },
      recordStart: async (...args) => {
        calls.push(["recordStart", args]);
        return response();
      },
      ringbackContent: (timeoutSeconds) => `ringback:${timeoutSeconds}`,
      speak: async (args) => {
        calls.push(["speak", args]);
        return response();
      },
      transfer: async (args) => {
        calls.push(["transfer", args]);
        return response();
      },
      waitForHoldReplayWindow: async () => {},
    });
    const target = {
      callId: "call-1",
      commandId: "command-1",
      idempotencyKey: "effect-1",
      legId: "customer-leg-1",
      practiceId: "practice-1",
      provider: { callControlId: "customer-control-1" },
    };
    const agentTarget = {
      ...target,
      legId: "agent-leg-1",
      provider: { callControlId: "agent-control-1" },
    };

    await sender.send({ ...target, arguments: {}, type: "ANSWER_CUSTOMER" });
    await sender.send({
      ...target,
      arguments: { timeoutSeconds: 30 },
      type: "START_RINGBACK",
    });
    await sender.send({ ...target, arguments: {}, type: "STOP_PLAYBACK" });
    await sender.send({
      ...agentTarget,
      arguments: {},
      type: "START_HOLD_MUSIC",
    });
    await sender.send({
      ...agentTarget,
      arguments: {},
      type: "STOP_HOLD_MUSIC",
    });
    await sender.send({ ...target, arguments: {}, type: "HANGUP_LEG" });
    await sender.send({
      ...target,
      arguments: { greeting: "Please leave a message." },
      type: "PLAY_VOICEMAIL_GREETING",
    });
    await sender.send({ ...target, arguments: {}, type: "START_RECORDING" });
    await sender.send(command);
    await sender.send({
      arguments: {
        agentSessionId: "session-2",
        endpointId: "endpoint-2",
        providerSourceLegId: "customer-leg-1",
        sourceLegId: "leg-1",
      },
      callId: "call-1",
      commandId: "transfer-command-1",
      idempotencyKey: "transfer-1",
      legId: "leg-2",
      practiceId: "practice-1",
      provider: {
        callControlId: "customer-control-1",
        sipUri: "sip:agent-2@example.test",
        strategy: "TRANSFER",
        timeoutSeconds: 20,
      },
      type: "TRANSFER_AGENT",
    });

    expect(calls).toEqual([
      ["answer", ["customer-control-1", "command-1", undefined, expect.any(String)]],
      [
        "playbackStart",
        {
          callControlId: "customer-control-1",
          clientState: expect.any(String),
          commandId: "command-1",
          loop: 1,
          playbackContent: "ringback:30",
        },
      ],
      [
        "playbackStop",
        ["customer-control-1", "command-1", undefined, expect.any(String)],
      ],
      [
        "playbackStart",
        {
          audioType: "wav",
          callControlId: "agent-control-1",
          clientState: expect.any(String),
          commandId: "command-1",
          loop: "infinity",
          playbackContent: expect.any(String),
          targetLegs: "opposite",
        },
      ],
      ["playbackStop", ["agent-control-1", "command-1", undefined, expect.any(String)]],
      ["playbackStop", ["agent-control-1", undefined, undefined, expect.any(String)]],
      ["hangup", ["customer-control-1", "command-1", undefined, expect.any(String)]],
      [
        "speak",
        {
          callControlId: "customer-control-1",
          clientState: expect.any(String),
          commandId: "command-1",
          payload: "Please leave a message.",
        },
      ],
      [
        "recordStart",
        [
          {
            callControlId: "customer-control-1",
            clientState: expect.any(String),
            commandId: "command-1",
            playBeep: true,
          },
        ],
      ],
      [
        "dial",
        expect.objectContaining({
          commandId: "command-1",
          connectionId: "connection-1",
          linkTo: "customer-control-1",
          to: "sip:agent-1@example.test",
        }),
      ],
      [
        "transfer",
        expect.objectContaining({
          callControlId: "customer-control-1",
          commandId: "transfer-command-1",
          timeoutSecs: 20,
          to: "sip:agent-2@example.test",
        }),
      ],
    ]);
    const transfer = calls.at(-1)?.[1] as {
      clientState: string;
      targetLegClientState: string;
    };
    expect(
      JSON.parse(Buffer.from(transfer.clientState, "base64").toString("utf8")),
    ).toMatchObject({
      internalTransferSource: true,
      legId: "customer-leg-1",
    });
    expect(
      JSON.parse(Buffer.from(transfer.targetLegClientState, "base64").toString("utf8")),
    ).toMatchObject({ internalTransferTarget: true, legId: "leg-2" });
  });

  it("turns unsuccessful helper responses into classified errors", async () => {
    const sender = createTelnyxProviderCommandSender({
      answer: async () => new Response(null, { status: 422 }),
      dial: async () => ({}),
      hangup: async () => new Response(null, { status: 204 }),
      playbackStart: async () => new Response(null, { status: 204 }),
      playbackStop: async () => new Response(null, { status: 204 }),
      recordStart: async () => new Response(null, { status: 204 }),
      ringbackContent: () => "ringback",
      speak: async () => new Response(null, { status: 204 }),
      transfer: async () => new Response(null, { status: 204 }),
    });

    await expect(
      sender.send({
        arguments: {},
        callId: "call-1",
        commandId: "command-1",
        idempotencyKey: "answer-1",
        legId: "customer-leg-1",
        practiceId: "practice-1",
        provider: { callControlId: "customer-control-1" },
        type: "ANSWER_CUSTOMER",
      }),
    ).rejects.toMatchObject({ name: "TelnyxError", status: 422 });
  });

  it("continues when ringback already stopped", async () => {
    for (const status of [404, 422]) {
      const sender = createTelnyxProviderCommandSender({
        answer: async () => new Response(null, { status: 204 }),
        dial: async () => ({}),
        hangup: async () => new Response(null, { status: 204 }),
        playbackStart: async () => new Response(null, { status: 204 }),
        playbackStop: async () => new Response(null, { status }),
        recordStart: async () => new Response(null, { status: 204 }),
        ringbackContent: () => "ringback",
        speak: async () => new Response(null, { status: 204 }),
        transfer: async () => new Response(null, { status: 204 }),
      });

      await expect(
        sender.send({
          arguments: {},
          callId: "call-1",
          commandId: "command-1",
          idempotencyKey: "stop-ringback-1",
          legId: "customer-leg-1",
          practiceId: "practice-1",
          provider: { callControlId: "customer-control-1" },
          type: "STOP_PLAYBACK",
        }),
      ).resolves.toBeUndefined();
    }
  });

  it("settles hold music when playback is already stopped", async () => {
    const sender = createTelnyxProviderCommandSender({
      answer: async () => new Response(null, { status: 204 }),
      dial: async () => ({}),
      hangup: async () => new Response(null, { status: 204 }),
      holdMusicContent: () => "hold-music",
      playbackStart: async () => new Response(null, { status: 204 }),
      playbackStop: async () => new Response(null, { status: 404 }),
      recordStart: async () => new Response(null, { status: 204 }),
      ringbackContent: () => "ringback",
      speak: async () => new Response(null, { status: 204 }),
      waitForHoldReplayWindow: async () => {},
    });

    await expect(
      sender.send({
        arguments: {},
        callId: "call-1",
        commandId: "command-1",
        idempotencyKey: "stop-hold-1",
        legId: "agent-leg-1",
        practiceId: "practice-1",
        provider: { callControlId: "agent-control-1" },
        type: "STOP_HOLD_MUSIC",
      }),
    ).resolves.toEqual({ alreadySettled: true });
  });

  it("clears a hold replay that starts just after the first stop", async () => {
    const stops: Array<[string, string | undefined]> = [];
    const sender = createTelnyxProviderCommandSender({
      playbackStop: async (callControlId, commandId) => {
        stops.push([callControlId, commandId]);
        return new Response(null, { status: stops.length === 1 ? 404 : 204 });
      },
      waitForHoldReplayWindow: async () => {},
    });

    await expect(
      sender.send({
        arguments: {},
        callId: "call-1",
        commandId: "command-1",
        idempotencyKey: "stop-hold-race-1",
        legId: "agent-leg-1",
        practiceId: "practice-1",
        provider: { callControlId: "agent-control-1" },
        type: "STOP_HOLD_MUSIC",
      }),
    ).resolves.toBeUndefined();
    expect(stops).toEqual([
      ["agent-control-1", "command-1"],
      ["agent-control-1", undefined],
    ]);
  });

  it("settles when the guard confirms playback is gone", async () => {
    let stopCount = 0;
    const sender = createTelnyxProviderCommandSender({
      playbackStop: async () => {
        stopCount += 1;
        return new Response(null, { status: stopCount === 1 ? 204 : 404 });
      },
      waitForHoldReplayWindow: async () => {},
    });

    await expect(
      sender.send({
        arguments: {},
        callId: "call-1",
        commandId: "command-1",
        idempotencyKey: "stop-hold-guard-1",
        legId: "agent-leg-1",
        practiceId: "practice-1",
        provider: { callControlId: "agent-control-1" },
        type: "STOP_HOLD_MUSIC",
      }),
    ).resolves.toEqual({ alreadySettled: true });
  });

  it("continues when the provider leg is already hung up", async () => {
    for (const status of [404, 422]) {
      const sender = createTelnyxProviderCommandSender({
        answer: async () => new Response(null, { status: 204 }),
        dial: async () => ({}),
        hangup: async () => {
          throw new TelnyxError("already ended", status);
        },
        playbackStart: async () => new Response(null, { status: 204 }),
        playbackStop: async () => new Response(null, { status: 204 }),
        recordStart: async () => new Response(null, { status: 204 }),
        ringbackContent: () => "ringback",
        speak: async () => new Response(null, { status: 204 }),
        transfer: async () => new Response(null, { status: 204 }),
      });

      await expect(
        sender.send({
          arguments: {},
          callId: "call-1",
          commandId: "command-1",
          idempotencyKey: "hangup-1",
          legId: "customer-leg-1",
          practiceId: "practice-1",
          provider: { callControlId: "customer-control-1" },
          type: "HANGUP_LEG",
        }),
      ).resolves.toBeUndefined();
    }
  });
});
