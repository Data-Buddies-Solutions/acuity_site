import { Prisma } from "@/generated/prisma/client";
import {
  advanceCanonicalCall,
  advanceCanonicalLeg,
  normalizeCanonicalCallState,
  reconcileCanonicalCallOutcome,
  terminalCallObservation,
} from "@/lib/call-center/domain/canonical-call-state";
import { canonicalVoicemailRecordingDeadline } from "@/lib/call-center/domain/canonical-voicemail-lifecycle";
import { settleCanonicalCallLegs } from "@/lib/call-center/infrastructure/prisma-call-resource-settlement";
import type { ProviderWebhookRecord } from "@/lib/call-center/infrastructure/provider-webhook-inbox";
import {
  failProviderCommandDependents,
  settleProviderCommandsForTerminalLeg,
} from "@/lib/call-center/infrastructure/prisma-provider-command-failures";
import {
  CanonicalVoicemailPersistenceError,
  persistCanonicalVoicemail,
} from "@/lib/call-center/infrastructure/prisma-canonical-voicemail";
import { lockCallCenterPractice } from "@/lib/call-center/infrastructure/prisma-call-center-practice-lock";
import { routeActiveInboundCallInTransaction } from "@/lib/call-center/infrastructure/prisma-active-inbound-routing-store";
import { settleCompetingAgentOffers } from "@/lib/call-center/infrastructure/prisma-agent-offer-settlement";
import { reconcileActiveInboundCallInTransaction } from "@/lib/call-center/infrastructure/prisma-active-inbound-lifecycle-store";
import {
  resolveCanonicalTelnyxCallObservations,
  resolveCanonicalTelnyxLegKind,
  type CanonicalTelnyxCallFact,
  type ResolvedCanonicalTelnyxCallFact,
} from "@/lib/call-center/infrastructure/telnyx-canonical-call-fact";
import { phoneLookupVariants } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

const OUTBOUND_RING_TIMEOUT_MS = 60_000;

export class CanonicalProjectionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CanonicalProjectionError";
  }
}

type CanonicalProjectionResult = {
  callId: string;
  callStatus: string;
  commandIds: string[];
  legId: string;
  legStatus: string;
  practiceId: string;
};

export function directHandoffLifecycleProjection(callStatus: string, projectedAt: Date) {
  if (callStatus === "CONNECTED" || callStatus === "COMPLETED") {
    return {
      data: {
        connectedAt: projectedAt,
        failedAt: null,
        failureCode: null,
        status: "CONNECTED" as const,
      },
      fromStatus: ["FAILED", "INGRESS_SEEN"] as Array<"FAILED" | "INGRESS_SEEN">,
    };
  }
  if (["ABANDONED", "FAILED", "VOICEMAIL"].includes(callStatus)) {
    return {
      data: {
        failedAt: projectedAt,
        failureCode: `CALL_${callStatus}`,
        status: "FAILED" as const,
      },
      fromStatus: ["INGRESS_SEEN"] as Array<"INGRESS_SEEN">,
    };
  }
  return null;
}

export function shouldPlanCanonicalInboundRouting(input: {
  direction: "INBOUND" | "OUTBOUND" | null;
  eventType: string;
  legKind: "AGENT" | "CUSTOMER";
}) {
  return (
    input.direction === "INBOUND" &&
    input.eventType === "call.initiated" &&
    input.legKind === "CUSTOMER"
  );
}

export function shouldReconcileCanonicalInboundLifecycle(input: {
  callDirection: "INBOUND" | "OUTBOUND";
  eventType: string;
  initialRoutingHadNoAgents: boolean;
  legKind: "AGENT" | "CUSTOMER";
}) {
  return (
    input.callDirection === "INBOUND" &&
    (input.legKind === "AGENT" ||
      input.initialRoutingHadNoAgents ||
      input.eventType === "call.playback.ended")
  );
}

export function shouldConfirmDialAgentCommand(input: {
  eventType: string;
  legKind: "AGENT" | "CUSTOMER";
  mediaCommandCallback: boolean;
  settledCommand: boolean;
}) {
  return (
    input.legKind === "AGENT" &&
    !input.settledCommand &&
    !input.mediaCommandCallback &&
    input.eventType !== "call.hangup"
  );
}
export type CanonicalCallProjector = {
  projectAndComplete(
    event: ProviderWebhookRecord,
    fact: CanonicalTelnyxCallFact,
    projectedAt: Date,
  ): Promise<CanonicalProjectionResult>;
};

type Transaction = Prisma.TransactionClient;

export async function pendingDialAgentCommandIdsForCustomerCallback(
  tx: Transaction,
  input: {
    callDirection: "INBOUND" | "OUTBOUND";
    callId: string;
    eventType: string;
    legKind: "AGENT" | "CUSTOMER";
    practiceId: string;
  },
) {
  if (
    input.callDirection !== "INBOUND" ||
    input.legKind !== "CUSTOMER" ||
    !["call.answered", "call.playback.started"].includes(input.eventType)
  ) {
    return [];
  }
  const commands = await tx.callCenterCommand.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
    where: {
      callId: input.callId,
      practiceId: input.practiceId,
      status: "PENDING",
      type: "DIAL_AGENT",
    },
  });
  return commands.map(({ id }) => id);
}

export function sipEndpointIdentityCandidates(address: string) {
  const value = address.trim().replace(/^<|>$/g, "");
  if (!value || /^\+?[\d\s().-]+$/.test(value)) return [];
  if (!/^sips?:/i.test(value) && !value.includes("@")) return [value];

  const authority =
    value
      .replace(/^sips?:/i, "")
      .split(/[;?]/, 1)[0]
      ?.trim() ?? "";
  if (!authority) return [];
  const username = authority.split("@", 1)[0]?.trim() ?? "";

  return [...new Set([value, `sip:${authority}`, authority, username])].filter(Boolean);
}

type ProviderCommandLink = {
  arguments?: Prisma.JsonValue;
  callId: string;
  id: string;
  legId: string | null;
  practiceId: string;
  status: "PENDING" | "SENDING" | "SENT" | "CONFIRMED" | "FAILED";
  type:
    | "ANSWER_CUSTOMER"
    | "START_RINGBACK"
    | "DIAL_AGENT"
    | "STOP_PLAYBACK"
    | "START_HOLD_MUSIC"
    | "STOP_HOLD_MUSIC"
    | "BRIDGE_LEGS"
    | "HANGUP_LEG"
    | "PLAY_VOICEMAIL_GREETING"
    | "START_RECORDING";
};

export function selectCanonicalProviderCommand(
  candidates: ProviderCommandLink[],
  target: { callId: string; legId: string; practiceId: string },
) {
  if (candidates.length > 1) {
    throw new CanonicalProjectionError("CANONICAL_COMMAND_CORRELATION_AMBIGUOUS");
  }
  const command = candidates[0] ?? null;
  if (
    command &&
    (command.practiceId !== target.practiceId ||
      command.callId !== target.callId ||
      command.legId !== target.legId ||
      command.type !== "DIAL_AGENT")
  ) {
    throw new CanonicalProjectionError("CANONICAL_COMMAND_LINK_MISMATCH");
  }
  return command;
}

export function assertCanonicalProviderLegIdentity(
  existing: {
    providerCallControlId: string | null;
    providerCallLegId: string | null;
    providerCallSessionId: string | null;
  },
  supplied: Pick<
    CanonicalTelnyxCallFact,
    "providerCallControlId" | "providerCallLegId" | "providerCallSessionId"
  >,
) {
  if (
    (supplied.providerCallControlId &&
      existing.providerCallControlId &&
      supplied.providerCallControlId !== existing.providerCallControlId) ||
    (supplied.providerCallLegId &&
      existing.providerCallLegId &&
      supplied.providerCallLegId !== existing.providerCallLegId) ||
    (supplied.providerCallSessionId &&
      existing.providerCallSessionId &&
      supplied.providerCallSessionId !== existing.providerCallSessionId)
  ) {
    throw new CanonicalProjectionError("CANONICAL_LEG_IDENTITY_MISMATCH");
  }
}

async function existingLeg(tx: Transaction, fact: CanonicalTelnyxCallFact) {
  const identity = [
    ...(fact.canonicalLegId ? [{ id: fact.canonicalLegId }] : []),
    ...(fact.providerCallControlId
      ? [{ providerCallControlId: fact.providerCallControlId }]
      : []),
    ...(fact.providerCallLegId ? [{ providerCallLegId: fact.providerCallLegId }] : []),
    ...(!fact.providerCallControlId &&
    !fact.providerCallLegId &&
    (fact.eventType === "call.recording.saved" ||
      fact.eventType === "calls.voicemail.completed") &&
    fact.providerCallSessionId
      ? [
          {
            kind: "CUSTOMER" as const,
            providerCallSessionId: fact.providerCallSessionId,
          },
        ]
      : []),
  ];
  const matches = await tx.callCenterCallLeg.findMany({
    include: { call: true },
    take: 2,
    where: {
      OR: identity,
    },
  });

  if (matches.length > 1) {
    throw new CanonicalProjectionError("CANONICAL_LEG_IDENTITY_AMBIGUOUS");
  }
  const match = matches[0] ?? null;
  if (match) {
    assertCanonicalProviderLegIdentity(match, fact);
    if (
      (fact.canonicalLegId && fact.canonicalLegId !== match.id) ||
      (fact.canonicalCallId && fact.canonicalCallId !== match.call.id) ||
      (fact.endpointId && fact.endpointId !== match.endpointId)
    ) {
      throw new CanonicalProjectionError("CANONICAL_AGENT_LINK_MISMATCH");
    }
  }
  return match;
}

export async function resolveCanonicalPeerAgentLeg(
  tx: Transaction,
  fact: CanonicalTelnyxCallFact,
) {
  if (fact.canonicalCallId || fact.canonicalLegId || fact.endpointId) {
    return null;
  }

  const sipIdentities = sipEndpointIdentityCandidates(fact.toAddress);
  if (!sipIdentities.length) return null;

  const endpoints = await tx.callCenterEndpoint.findMany({
    select: { id: true, practiceId: true },
    take: 2,
    where: { sipUsername: { in: sipIdentities } },
  });
  if (!endpoints.length) return null;
  if (endpoints.length > 1) {
    throw new CanonicalProjectionError("CANONICAL_ENDPOINT_SIP_AMBIGUOUS");
  }
  if (!fact.providerCallSessionId) {
    throw new CanonicalProjectionError("CANONICAL_CALL_SESSION_MISSING");
  }

  const endpoint = endpoints[0]!;
  const call = await tx.callCenterCall.findUnique({
    where: { providerCallSessionId: fact.providerCallSessionId },
  });
  if (!call) throw new CanonicalProjectionError("CANONICAL_CALL_NOT_FOUND");
  if (call.practiceId !== endpoint.practiceId) {
    throw new CanonicalProjectionError("CANONICAL_CALL_OWNER_MISMATCH");
  }

  const leg = await tx.callCenterCallLeg.findFirst({
    orderBy: { startedAt: "desc" },
    where: {
      callId: call.id,
      endpointId: endpoint.id,
      kind: "AGENT",
      startedAt: { lte: fact.occurredAt },
    },
  });
  if (!leg) {
    throw new CanonicalProjectionError("CANONICAL_PEER_AGENT_LEG_NOT_FOUND");
  }

  return { call, leg };
}

async function resolveAgentContext(
  tx: Transaction,
  fact: ResolvedCanonicalTelnyxCallFact,
) {
  if (fact.canonicalCallId || fact.canonicalLegId) {
    if (!fact.canonicalCallId || !fact.canonicalLegId) {
      throw new CanonicalProjectionError("CANONICAL_AGENT_LINK_INCOMPLETE");
    }
    const leg = await tx.callCenterCallLeg.findFirst({
      include: { call: true },
      where: {
        callId: fact.canonicalCallId,
        id: fact.canonicalLegId,
        kind: "AGENT",
      },
    });
    if (!leg) throw new CanonicalProjectionError("CANONICAL_AGENT_LEG_NOT_FOUND");
    if (fact.endpointId && leg.endpointId !== fact.endpointId) {
      throw new CanonicalProjectionError("CANONICAL_ENDPOINT_LINK_MISMATCH");
    }
    if (!leg.endpointId) {
      throw new CanonicalProjectionError("CANONICAL_ENDPOINT_NOT_FOUND");
    }
    return { call: leg.call, endpointId: leg.endpointId };
  }

  throw new CanonicalProjectionError("CANONICAL_AGENT_LINK_NOT_FOUND");
}

export async function confirmProviderCommand(
  tx: Transaction,
  fact: ResolvedCanonicalTelnyxCallFact,
  input: { callId: string; legId: string; practiceId: string },
) {
  const explicit = fact.providerCommandId
    ? await tx.callCenterCommand.findUnique({
        select: {
          arguments: true,
          callId: true,
          id: true,
          legId: true,
          practiceId: true,
          status: true,
          type: true,
        },
        where: { id: fact.providerCommandId },
      })
    : null;

  if (fact.providerCommandId && !explicit) {
    if (fact.canonicalCallId || fact.canonicalLegId) {
      throw new CanonicalProjectionError("CANONICAL_COMMAND_NOT_FOUND");
    }
    return;
  }

  let candidates: ProviderCommandLink[] = explicit ? [explicit] : [];
  if (!explicit) {
    candidates = await tx.callCenterCommand.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        arguments: true,
        callId: true,
        id: true,
        legId: true,
        practiceId: true,
        status: true,
        type: true,
      },
      take: 2,
      where: {
        callId: input.callId,
        legId: input.legId,
        practiceId: input.practiceId,
        type: "DIAL_AGENT",
      },
    });
  }

  const command = selectCanonicalProviderCommand(candidates, input);
  if (!command) return;
  if (command.status === "PENDING") {
    throw new CanonicalProjectionError("CANONICAL_COMMAND_NOT_SENT");
  }

  await tx.callCenterCommand.updateMany({
    data: {
      errorCode: null,
      status: "CONFIRMED",
    },
    where: {
      id: command.id,
      status: { in: ["SENDING", "SENT", "FAILED"] },
    },
  });
  return command;
}

export async function confirmExactProviderCommand(
  tx: Transaction,
  fact: ResolvedCanonicalTelnyxCallFact,
  input: {
    callId: string;
    expectedType: ProviderCommandLink["type"];
    legId: string;
    practiceId: string;
  },
) {
  if (!fact.providerCommandId) {
    throw new CanonicalProjectionError("CANONICAL_COMMAND_ID_MISSING");
  }
  const command = await tx.callCenterCommand.findUnique({
    select: {
      callId: true,
      id: true,
      legId: true,
      practiceId: true,
      status: true,
      type: true,
    },
    where: { id: fact.providerCommandId },
  });
  if (!command) throw new CanonicalProjectionError("CANONICAL_COMMAND_NOT_FOUND");
  if (
    command.callId !== input.callId ||
    command.legId !== input.legId ||
    command.practiceId !== input.practiceId ||
    command.type !== input.expectedType
  ) {
    throw new CanonicalProjectionError("CANONICAL_COMMAND_LINK_MISMATCH");
  }
  if (command.status === "PENDING") {
    throw new CanonicalProjectionError("CANONICAL_COMMAND_NOT_SENT");
  }

  await tx.callCenterCommand.updateMany({
    data: { errorCode: null, status: "CONFIRMED" },
    where: {
      id: command.id,
      status: { in: ["SENDING", "SENT", "FAILED"] },
    },
  });
  return command;
}

export async function settleProviderCommandCallback(
  tx: Transaction,
  fact: ResolvedCanonicalTelnyxCallFact,
  input: { callId: string; legId: string; practiceId: string },
) {
  const callback = (() => {
    switch (fact.eventType) {
      case "call.answered":
        return {
          expectedTypes: ["ANSWER_CUSTOMER"] as const,
          outcome: "CONFIRMED" as const,
        };
      case "call.playback.started":
        return {
          expectedTypes: ["START_RINGBACK", "START_HOLD_MUSIC"] as const,
          outcome: "CONFIRMED" as const,
        };
      case "call.playback.ended":
        return {
          expectedTypes: [
            "START_RINGBACK",
            "STOP_PLAYBACK",
            "START_HOLD_MUSIC",
            "STOP_HOLD_MUSIC",
          ] as const,
          outcome: "CONFIRMED" as const,
        };
      case "call.speak.started":
      case "call.speak.ended":
        return {
          expectedTypes: ["PLAY_VOICEMAIL_GREETING"] as const,
          outcome: "CONFIRMED" as const,
        };
      case "call.recording.saved":
        return {
          expectedTypes: ["START_RECORDING"] as const,
          outcome: "CONFIRMED" as const,
        };
      case "call.recording.error":
        return {
          expectedTypes: ["START_RECORDING"] as const,
          outcome: "FAILED" as const,
        };
      case "call.hangup":
        return {
          expectedTypes: ["HANGUP_LEG"] as const,
          ignoreOtherTypes: true,
          outcome: "CONFIRMED" as const,
        };
      default:
        return null;
    }
  })();
  if (!callback) return null;
  const ignoreOtherTypes =
    "ignoreOtherTypes" in callback && callback.ignoreOtherTypes === true;
  if (!fact.providerCommandId) {
    if (ignoreOtherTypes) return null;
    throw new CanonicalProjectionError("CANONICAL_COMMAND_ID_MISSING");
  }

  const command = await tx.callCenterCommand.findUnique({
    select: {
      callId: true,
      errorCode: true,
      id: true,
      legId: true,
      practiceId: true,
      status: true,
      type: true,
    },
    where: { id: fact.providerCommandId },
  });
  if (!command) throw new CanonicalProjectionError("CANONICAL_COMMAND_NOT_FOUND");
  if (
    command.callId !== input.callId ||
    command.legId !== input.legId ||
    command.practiceId !== input.practiceId
  ) {
    throw new CanonicalProjectionError("CANONICAL_COMMAND_LINK_MISMATCH");
  }
  if (!callback.expectedTypes.includes(command.type as never)) {
    if (ignoreOtherTypes || fact.providerCommandIdSource === "CLIENT_STATE") {
      return null;
    }
    throw new CanonicalProjectionError("CANONICAL_COMMAND_LINK_MISMATCH");
  }
  if (command.status === "PENDING") {
    throw new CanonicalProjectionError("CANONICAL_COMMAND_NOT_SENT");
  }
  const playbackFailed =
    command.type === "START_HOLD_MUSIC" &&
    fact.eventType === "call.playback.ended" &&
    ["failed", "file_not_found", "unknown"].includes(fact.playbackStatus ?? "");
  const outcome = playbackFailed ? ("FAILED" as const) : callback.outcome;
  if (
    outcome === "CONFIRMED" &&
    command.status === "FAILED" &&
    command.errorCode === "PROVIDER_PLAYBACK_FAILED"
  ) {
    return command;
  }

  const updated = await tx.callCenterCommand.updateMany({
    data:
      outcome === "CONFIRMED"
        ? { errorCode: null, status: "CONFIRMED" }
        : {
            errorCode: playbackFailed
              ? "PROVIDER_PLAYBACK_FAILED"
              : "PROVIDER_CALLBACK_FAILED",
            status: "FAILED",
          },
    where: {
      id: command.id,
      status: {
        in:
          outcome === "FAILED"
            ? ["SENDING", "SENT", "CONFIRMED"]
            : ["SENDING", "SENT", "FAILED"],
      },
    },
  });
  if (updated.count === 1) {
    if (outcome === "FAILED") {
      await failProviderCommandDependents(tx, {
        commandId: command.id,
        now: fact.occurredAt,
      });
    }
  }
  return command;
}

export async function createStartRecordingAfterGreeting(
  tx: Transaction,
  fact: ResolvedCanonicalTelnyxCallFact,
  input: { callId: string; legId: string; practiceId: string },
) {
  const greeting = await confirmExactProviderCommand(tx, fact, {
    ...input,
    expectedType: "PLAY_VOICEMAIL_GREETING",
  });
  const identity = {
    idempotencyKey: `voicemail-recording:${greeting.id}`,
    practiceId: input.practiceId,
    type: "START_RECORDING" as const,
  };
  const existing = await tx.callCenterCommand.findUnique({
    select: { id: true },
    where: { practiceId_type_idempotencyKey: identity },
  });
  const command = await tx.callCenterCommand.upsert({
    create: {
      arguments: {},
      callId: input.callId,
      dependsOnCommandId: greeting.id,
      idempotencyKey: identity.idempotencyKey,
      legId: input.legId,
      practiceId: input.practiceId,
      type: "START_RECORDING",
    },
    select: { id: true },
    update: {},
    where: {
      practiceId_type_idempotencyKey: {
        ...identity,
      },
    },
  });
  return { ...command, created: !existing };
}

export function terminalSettlementIncludesCustomerLegs(status: string) {
  return status !== "VOICEMAIL";
}

function customerPhones(
  fact: CanonicalTelnyxCallFact,
  direction: "INBOUND" | "OUTBOUND",
) {
  return direction === "INBOUND"
    ? { callerPhone: fact.fromPhone, practicePhone: fact.toPhone }
    : { callerPhone: fact.toPhone, practicePhone: fact.fromPhone };
}

export function earliestObservedAt(current: Date, observed: Date) {
  return observed.getTime() < current.getTime() ? observed : current;
}

export function processedWinningAgentLegId(
  currentWinnerId: string | null,
  processedLeg: { id: string; kind: "AGENT" | "CUSTOMER"; status: string },
) {
  if (currentWinnerId) return currentWinnerId;
  return processedLeg.kind === "AGENT" && processedLeg.status === "BRIDGED"
    ? processedLeg.id
    : null;
}

export function enrichCanonicalCallIdentity(
  call: {
    callerName: string | null;
    direction: "INBOUND" | "OUTBOUND";
    fromPhone: string;
    receivedAt: Date;
    toPhone: string;
  },
  fact: CanonicalTelnyxCallFact,
  legKind: "AGENT" | "CUSTOMER",
) {
  if (legKind === "AGENT") return call;

  const identity = customerPhones(fact, call.direction);
  return {
    ...call,
    callerName: call.callerName || fact.callerName,
    fromPhone:
      call.fromPhone ||
      (call.direction === "INBOUND" ? identity.callerPhone : identity.practicePhone),
    receivedAt: earliestObservedAt(call.receivedAt, fact.occurredAt),
    toPhone:
      call.toPhone ||
      (call.direction === "INBOUND" ? identity.practicePhone : identity.callerPhone),
  };
}

export async function resolveCanonicalCustomerCall(
  tx: Transaction,
  fact: ResolvedCanonicalTelnyxCallFact,
) {
  if (!fact.providerCallSessionId) {
    throw new CanonicalProjectionError("CANONICAL_CALL_SESSION_MISSING");
  }

  const existing = await tx.callCenterCall.findUnique({
    where: { providerCallSessionId: fact.providerCallSessionId },
  });
  if (existing) {
    await lockCallCenterPractice(tx, existing.practiceId);
    return existing;
  }

  if (!fact.direction) throw new CanonicalProjectionError("CANONICAL_DIRECTION_MISSING");
  const { callerPhone, practicePhone } = customerPhones(fact, fact.direction);
  if (!practicePhone) {
    throw new CanonicalProjectionError("CANONICAL_PRACTICE_PHONE_MISSING");
  }

  const numbers = await tx.callCenterNumber.findMany({
    include: { inboundQueue: { select: { enabled: true, practiceId: true } } },
    orderBy: { id: "asc" },
    take: 2,
    where: {
      enabled: true,
      ...(fact.direction === "INBOUND"
        ? { inboundEnabled: true }
        : { outboundEnabled: true }),
      practicePhoneNumber: {
        phoneNumber: { in: phoneLookupVariants(practicePhone) },
      },
    },
  });

  if (numbers.length === 0) {
    throw new CanonicalProjectionError("CANONICAL_NUMBER_NOT_FOUND");
  }
  if (numbers.length > 1) {
    throw new CanonicalProjectionError("CANONICAL_NUMBER_AMBIGUOUS");
  }

  const number = numbers[0];
  if (
    fact.direction === "INBOUND" &&
    (!number.inboundQueueId ||
      !number.inboundQueue?.enabled ||
      number.inboundQueue.practiceId !== number.practiceId)
  ) {
    throw new CanonicalProjectionError("CANONICAL_QUEUE_NOT_CONFIGURED");
  }

  await lockCallCenterPractice(tx, number.practiceId);
  const raced = await tx.callCenterCall.findUnique({
    where: { providerCallSessionId: fact.providerCallSessionId },
  });
  if (raced) return raced;

  return tx.callCenterCall.create({
    data: {
      callerName: fact.callerName,
      direction: fact.direction,
      fromPhone: fact.direction === "INBOUND" ? callerPhone : practicePhone,
      numberId: number.id,
      practiceId: number.practiceId,
      providerCallSessionId: fact.providerCallSessionId,
      queueId: fact.direction === "INBOUND" ? number.inboundQueueId : null,
      receivedAt: fact.occurredAt,
      status: "RECEIVED",
      toPhone: fact.direction === "INBOUND" ? practicePhone : callerPhone,
    },
  });
}

async function resolveProjectionCall(
  tx: Transaction,
  fact: ResolvedCanonicalTelnyxCallFact,
  leg: Awaited<ReturnType<typeof existingLeg>>,
) {
  if (!leg && fact.legKind === "CUSTOMER") {
    return {
      call: await resolveCanonicalCustomerCall(tx, fact),
      endpointId: null,
    };
  }

  const resolved = leg
    ? { call: leg.call, endpointId: leg.endpointId }
    : await resolveAgentContext(tx, fact);
  await lockCallCenterPractice(tx, resolved.call.practiceId);
  return resolved;
}

async function lockCall(tx: Transaction, callId: string) {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "id" = ${callId} FOR UPDATE`,
  );
  return tx.callCenterCall.findUniqueOrThrow({ where: { id: callId } });
}

export function canonicalCallObservation(
  fact: ResolvedCanonicalTelnyxCallFact,
  call: {
    direction: "INBOUND" | "OUTBOUND";
    status: Parameters<typeof terminalCallObservation>[0];
    winningLegId: string | null;
  },
  processedLegId: string,
) {
  if (
    call.direction === "INBOUND" &&
    fact.eventType === "call.bridged" &&
    fact.legKind === "CUSTOMER"
  ) {
    return null;
  }
  if (fact.legKind === "AGENT") {
    if (call.direction === "OUTBOUND" && fact.eventType === "call.answered") {
      return "CONNECTED" as const;
    }
    if (fact.eventType === "call.hangup") {
      if (call.winningLegId === processedLegId) {
        return terminalCallObservation(call.status);
      }
      if (call.direction === "OUTBOUND" && call.winningLegId === null) {
        return terminalCallObservation(call.status);
      }
      return null;
    }
  }
  return fact.callObservation === "HANGUP"
    ? terminalCallObservation(call.status)
    : fact.callObservation;
}

export function projectedCallDeadline(
  call: { deadlineAt: Date | null; direction: "INBOUND" | "OUTBOUND" },
  fact: Pick<ResolvedCanonicalTelnyxCallFact, "eventType" | "occurredAt">,
) {
  if (call.direction === "OUTBOUND") {
    if (fact.eventType === "call.initiated") {
      return new Date(fact.occurredAt.getTime() + OUTBOUND_RING_TIMEOUT_MS);
    }
    if (fact.eventType === "call.answered" || fact.eventType === "call.hangup") {
      return null;
    }
  }
  if (
    fact.eventType === "call.recording.saved" ||
    fact.eventType === "calls.voicemail.completed"
  ) {
    return null;
  }
  if (fact.eventType === "call.recording.error") return fact.occurredAt;
  return call.deadlineAt;
}

export function hasCanonicalAgentBridgeEvidence(
  winningLegId: string | null,
  bridgedLegs: ReadonlyArray<{
    id: string;
    kind: "AGENT" | "CUSTOMER";
  }>,
) {
  return Boolean(
    winningLegId &&
    bridgedLegs.some((leg) => leg.id === winningLegId && leg.kind === "AGENT"),
  );
}

function isCanonicalVoicemailCallback(eventType: string) {
  return eventType === "call.speak.ended" || eventType === "call.recording.saved";
}

async function completeProjectionCheckpoint(
  tx: Transaction,
  event: ProviderWebhookRecord,
  projectedAt: Date,
) {
  const completed = await tx.providerWebhookEvent.updateMany({
    data: {
      errorCode: null,
      nextAttemptAt: null,
      processedAt: projectedAt,
      processingStatus: "PROCESSED",
    },
    where: {
      attemptCount: event.attemptCount,
      id: event.id,
      processingStatus: "PROCESSING",
    },
  });
  if (completed.count !== 1) {
    throw new CanonicalProjectionError("CANONICAL_CLAIM_LOST");
  }
}

export const prismaCanonicalCallProjector: CanonicalCallProjector = {
  async projectAndComplete(event, fact, projectedAt) {
    return prisma.$transaction(async (tx) => {
      let leg = await existingLeg(tx, fact);
      const peerAgent = !leg ? await resolveCanonicalPeerAgentLeg(tx, fact) : null;
      if (peerAgent) {
        await completeProjectionCheckpoint(tx, event, projectedAt);
        return {
          callId: peerAgent.call.id,
          callStatus: peerAgent.call.status,
          commandIds: [],
          legId: peerAgent.leg.id,
          legStatus: peerAgent.leg.status,
          practiceId: peerAgent.call.practiceId,
        };
      }

      const legKind = resolveCanonicalTelnyxLegKind(leg?.kind ?? null, fact.legKind);
      const observations = resolveCanonicalTelnyxCallObservations(
        fact.eventType,
        legKind,
        fact.direction,
      );
      if (!observations) {
        throw new CanonicalProjectionError("CANONICAL_EVENT_UNSUPPORTED");
      }
      const resolvedFact: ResolvedCanonicalTelnyxCallFact = {
        ...fact,
        ...observations,
        legKind,
      };
      if (isCanonicalVoicemailCallback(resolvedFact.eventType) && !leg) {
        throw new CanonicalProjectionError("CANONICAL_CUSTOMER_LEG_NOT_FOUND");
      }
      const resolved = await resolveProjectionCall(tx, resolvedFact, leg);
      let call = normalizeCanonicalCallState(await lockCall(tx, resolved.call.id));

      if (call.practiceId !== resolved.call.practiceId) {
        throw new CanonicalProjectionError("CANONICAL_CALL_OWNER_MISMATCH");
      }
      if (!leg) {
        leg = await tx.callCenterCallLeg.create({
          data: {
            callId: call.id,
            endpointId: resolved.endpointId,
            kind: resolvedFact.legKind,
            providerCallControlId: resolvedFact.providerCallControlId,
            providerCallLegId: resolvedFact.providerCallLegId,
            providerCallSessionId: resolvedFact.providerCallSessionId,
            startedAt: resolvedFact.occurredAt,
            status: "CREATED",
          },
          include: { call: true },
        });
      }

      let nextLeg = advanceCanonicalLeg(
        leg,
        resolvedFact.legObservation,
        resolvedFact.occurredAt,
      );
      let preemptedCommandIds: string[] = [];
      if (
        leg.kind === "AGENT" &&
        leg.endpointId &&
        (nextLeg.status === "ANSWERED" || nextLeg.status === "BRIDGED")
      ) {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "call_center_endpoint" WHERE "id" = ${leg.endpointId} FOR UPDATE`,
        );
        const occupied = await tx.callCenterCallLeg.findFirst({
          select: { id: true },
          where: {
            endpointId: leg.endpointId,
            id: { not: leg.id },
            kind: "AGENT",
            status: { in: ["ANSWERED", "BRIDGED"] },
          },
        });
        if (occupied) {
          preemptedCommandIds = await settleCanonicalCallLegs(tx, {
            callId: call.id,
            legIds: [leg.id],
            now: resolvedFact.occurredAt,
            reason: "AGENT_ALREADY_ACTIVE",
          });
          leg = await tx.callCenterCallLeg.findUniqueOrThrow({
            include: { call: true },
            where: { id: leg.id },
          });
          nextLeg = leg;
        }
      }
      leg = await tx.callCenterCallLeg.update({
        data: {
          answeredAt: nextLeg.answeredAt,
          bridgedAt: nextLeg.bridgedAt,
          endedAt: nextLeg.endedAt,
          endpointId: leg.endpointId ?? resolved.endpointId,
          hangupCauseCode: resolvedFact.hangupCauseCode ?? leg.hangupCauseCode,
          providerCallControlId:
            leg.providerCallControlId ?? resolvedFact.providerCallControlId,
          providerCallLegId: leg.providerCallLegId ?? resolvedFact.providerCallLegId,
          providerCallSessionId:
            leg.providerCallSessionId ?? resolvedFact.providerCallSessionId,
          startedAt: earliestObservedAt(leg.startedAt, resolvedFact.occurredAt),
          status: nextLeg.status,
        },
        include: { call: true },
        where: { id: leg.id },
      });

      const mediaCommandCallback = [
        "call.playback.started",
        "call.playback.ended",
        "call.speak.started",
        "call.speak.ended",
        "call.recording.saved",
        "call.recording.error",
      ].includes(resolvedFact.eventType);
      const settledCommand =
        resolvedFact.legKind === "CUSTOMER" ||
        resolvedFact.eventType === "call.hangup" ||
        mediaCommandCallback
          ? await settleProviderCommandCallback(tx, resolvedFact, {
              callId: call.id,
              legId: leg.id,
              practiceId: call.practiceId,
            })
          : null;
      if (
        shouldConfirmDialAgentCommand({
          eventType: resolvedFact.eventType,
          legKind: resolvedFact.legKind,
          mediaCommandCallback,
          settledCommand: Boolean(settledCommand),
        })
      ) {
        await confirmProviderCommand(tx, resolvedFact, {
          callId: call.id,
          legId: leg.id,
          practiceId: call.practiceId,
        });
      }
      if (leg.status === "ENDED" || leg.status === "FAILED") {
        await settleProviderCommandsForTerminalLeg(tx, {
          legId: leg.id,
          now: resolvedFact.occurredAt,
        });
        if (
          resolvedFact.legKind === "AGENT" &&
          resolvedFact.eventType !== "call.hangup" &&
          leg.providerCallControlId
        ) {
          preemptedCommandIds.push(
            ...(await settleCanonicalCallLegs(tx, {
              callId: call.id,
              includeTerminalProviderLegs: true,
              legIds: [leg.id],
              now: resolvedFact.occurredAt,
              reason: "LATE_AGENT_LEG",
            })),
          );
        }
      }

      const bridgedLegs = await tx.callCenterCallLeg.findMany({
        select: { bridgedAt: true, id: true, kind: true },
        where: { bridgedAt: { not: null }, callId: call.id },
      });
      const previousWinningLegId = call.winningLegId;
      const winningLegId = processedWinningAgentLegId(previousWinningLegId, leg);
      const hasBridgeEvidence = hasCanonicalAgentBridgeEvidence(
        winningLegId,
        bridgedLegs,
      );
      const observedCall = canonicalCallObservation(resolvedFact, call, leg.id);
      const nextCall = observedCall
        ? advanceCanonicalCall(call, observedCall, resolvedFact.occurredAt, {
            hasBridgeEvidence,
          })
        : reconcileCanonicalCallOutcome(call, {
            hasBridgeEvidence,
          });
      const identity = enrichCanonicalCallIdentity(
        call,
        resolvedFact,
        resolvedFact.legKind,
      );
      const callProjectionChanged =
        nextCall !== call ||
        winningLegId !== call.winningLegId ||
        identity.callerName !== call.callerName ||
        identity.fromPhone !== call.fromPhone ||
        identity.toPhone !== call.toPhone ||
        identity.receivedAt.getTime() !== call.receivedAt.getTime();

      call = normalizeCanonicalCallState(
        await tx.callCenterCall.update({
          data: {
            answeredAt: nextCall.answeredAt,
            callerName: identity.callerName,
            deadlineAt: projectedCallDeadline(call, resolvedFact),
            endedAt: nextCall.endedAt,
            firstRingAt: nextCall.firstRingAt,
            fromPhone: identity.fromPhone,
            queuedAt: nextCall.queuedAt,
            receivedAt: identity.receivedAt,
            stateVersion:
              callProjectionChanged && nextCall.stateVersion === call.stateVersion
                ? call.stateVersion + 1
                : nextCall.stateVersion,
            status: nextCall.status,
            toPhone: identity.toPhone,
            voicemailStartedAt: nextCall.voicemailStartedAt,
            winningLegId,
          },
          where: { id: call.id },
        }),
      );

      const commandIds: string[] = [
        ...preemptedCommandIds,
        ...(await pendingDialAgentCommandIdsForCustomerCallback(tx, {
          callDirection: call.direction,
          callId: call.id,
          eventType: resolvedFact.eventType,
          legKind: resolvedFact.legKind,
          practiceId: call.practiceId,
        })),
      ];

      const projectionEvent = await tx.callCenterEvent.create({
        data: {
          aggregateId: call.id,
          aggregateType: "CALL",
          data: {
            callStatus: call.status,
            legId: leg.id,
            legStatus: leg.status,
            providerEventId: event.providerEventId,
          },
          idempotencyKey: `telnyx:${event.providerEventId}`,
          occurredAt: resolvedFact.occurredAt,
          practiceId: call.practiceId,
          type: resolvedFact.eventType.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
        },
      });
      if (resolvedFact.eventType === "call.speak.ended") {
        if (resolvedFact.legKind !== "CUSTOMER") {
          throw new CanonicalProjectionError("CANONICAL_CUSTOMER_LEG_NOT_FOUND");
        }
        const command = await createStartRecordingAfterGreeting(tx, resolvedFact, {
          callId: call.id,
          legId: leg.id,
          practiceId: call.practiceId,
        });
        commandIds.push(command.id);
        if (command.created) {
          await tx.callCenterCall.updateMany({
            data: {
              deadlineAt: canonicalVoicemailRecordingDeadline(resolvedFact.occurredAt),
              stateVersion: { increment: 1 },
            },
            where: { deadlineAt: { not: null }, id: call.id, status: "VOICEMAIL" },
          });
        }
      }
      if (
        resolvedFact.eventType === "call.recording.saved" ||
        resolvedFact.eventType === "calls.voicemail.completed"
      ) {
        if (
          resolvedFact.legKind !== "CUSTOMER" ||
          !resolvedFact.recordingId ||
          !resolvedFact.recordingUrl
        ) {
          throw new CanonicalProjectionError("CANONICAL_RECORDING_INVALID");
        }
        if (resolvedFact.eventType === "call.recording.saved") {
          await confirmExactProviderCommand(tx, resolvedFact, {
            callId: call.id,
            expectedType: "START_RECORDING",
            legId: leg.id,
            practiceId: call.practiceId,
          });
        }
        try {
          await persistCanonicalVoicemail(tx, {
            call: {
              callerName: call.callerName,
              fromPhone: call.fromPhone,
              id: call.id,
              practiceId: call.practiceId,
            },
            occurredAt: resolvedFact.occurredAt,
            recording: {
              durationSec: resolvedFact.recordingDurationSec,
              id: resolvedFact.recordingId,
              url: resolvedFact.recordingUrl,
            },
            sourceEventRevision: projectionEvent.revision,
          });
        } catch (error) {
          if (error instanceof CanonicalVoicemailPersistenceError) {
            throw new CanonicalProjectionError(error.code);
          }
          throw error;
        }
      }
      let initialRoutingHadNoAgents = false;
      if (
        shouldPlanCanonicalInboundRouting({
          direction: resolvedFact.direction,
          eventType: resolvedFact.eventType,
          legKind: resolvedFact.legKind,
        })
      ) {
        const routing = await routeActiveInboundCallInTransaction(
          tx,
          {
            callId: call.id,
            practiceId: call.practiceId,
            routingKey: `initial:${call.id}`,
          },
          resolvedFact.occurredAt,
        );
        if ("commandIds" in routing) {
          commandIds.push(...routing.commandIds);
          initialRoutingHadNoAgents = routing.routed.length === 0;
        }
      }
      if (
        shouldReconcileCanonicalInboundLifecycle({
          callDirection: call.direction,
          eventType: resolvedFact.eventType,
          initialRoutingHadNoAgents,
          legKind: resolvedFact.legKind,
        })
      ) {
        const lifecycle = await reconcileActiveInboundCallInTransaction(
          tx,
          {
            callId: call.id,
            practiceId: call.practiceId,
            processedBridgeLegId:
              resolvedFact.legKind === "AGENT" &&
              resolvedFact.eventType === "call.bridged"
                ? leg.id
                : null,
          },
          resolvedFact.occurredAt,
        );
        commandIds.push(...lifecycle.commandIds);
        call = normalizeCanonicalCallState(
          await tx.callCenterCall.findUniqueOrThrow({ where: { id: call.id } }),
        );
      }
      if (!previousWinningLegId && winningLegId === leg.id && leg.endpointId) {
        commandIds.push(
          ...(await settleCompetingAgentOffers(tx, {
            endpointId: leg.endpointId,
            now: resolvedFact.occurredAt,
            practiceId: call.practiceId,
            winningCallId: call.id,
          })),
        );
      }
      if (["ABANDONED", "COMPLETED", "FAILED", "VOICEMAIL"].includes(call.status)) {
        commandIds.push(
          ...(await settleCanonicalCallLegs(tx, {
            callId: call.id,
            includeCustomerLegs: terminalSettlementIncludesCustomerLegs(call.status),
            now: resolvedFact.occurredAt,
            reason: "CALL_TERMINAL",
          })),
        );
      }
      const handoffProjection = directHandoffLifecycleProjection(
        call.status,
        projectedAt,
      );
      if (handoffProjection) {
        await tx.callCenterHandoff.updateMany({
          data: handoffProjection.data,
          where: { callId: call.id, status: { in: handoffProjection.fromStatus } },
        });
      }

      await completeProjectionCheckpoint(tx, event, projectedAt);

      return {
        callId: call.id,
        callStatus: call.status,
        commandIds: [...new Set(commandIds)],
        legId: leg.id,
        legStatus: leg.status,
        practiceId: call.practiceId,
      };
    });
  },
};
