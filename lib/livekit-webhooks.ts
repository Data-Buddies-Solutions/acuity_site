import { WebhookReceiver } from "livekit-server-sdk";

import { Prisma } from "@/generated/prisma/client";
import {
  CallIngestionError,
  resolveAgentForCall,
  resolvePracticeForCall,
} from "@/lib/call-ingestion";
import { toJsonCompatible } from "@/lib/call-normalization";
import { prisma } from "@/lib/prisma";

const TERMINAL_EVENTS = new Set([
  "room_finished",
  "participant_left",
  "participant_connection_aborted",
]);

type JsonRecord = Record<string, unknown>;

export type LiveKitWebhookEventLike = {
  createdAt?: bigint | number | string;
  event?: string;
  id?: string;
  participant?: {
    attributes?: Record<string, string>;
    identity?: string;
    joinedAt?: bigint | number | string;
    joinedAtMs?: bigint | number | string;
    metadata?: string;
    sid?: string;
  };
  room?: {
    creationTime?: bigint | number | string;
    creationTimeMs?: bigint | number | string;
    metadata?: string;
    name?: string;
    sid?: string;
  };
};

export type LiveKitAgentCallSkeleton = {
  agentId: string | null;
  callId: string;
  callerPhone: string;
  durationSec: number;
  endedAt: Date | null;
  eventId: string;
  eventType: string;
  livekitContext: {
    eventId: string;
    eventType: string;
    participantIdentity: string | null;
    participantSid: string | null;
    roomName: string | null;
    roomSid: string | null;
    sipCallId: string | null;
  };
  officePhone: string;
  practiceId: string | null;
  startedAt: Date;
  status: "IN_PROGRESS" | "FAILED";
};

type LiveKitWebhookProcessingResult = {
  agentCallId: string | null;
  eventId: string;
  eventType: string;
  processingStatus: "PROCESSED" | "IGNORED" | "FAILED";
};

export class LiveKitWebhookIngestionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "LiveKitWebhookIngestionError";
    this.status = status;
  }
}

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function getWebhookCredentials() {
  return {
    allowUnverified:
      env("LIVEKIT_ALLOW_UNVERIFIED_WEBHOOKS") === "true" &&
      process.env.NODE_ENV !== "production",
    apiKey: env("LIVEKIT_WEBHOOK_API_KEY") || env("LIVEKIT_API_KEY"),
    apiSecret: env("LIVEKIT_WEBHOOK_API_SECRET") || env("LIVEKIT_API_SECRET"),
  };
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseJsonObject(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function pickFirst(...values: Array<unknown>) {
  for (const value of values) {
    const text = asString(value);
    if (text) {
      return text;
    }
  }

  return "";
}

function dateFromSeconds(value: bigint | number | string | undefined) {
  if (value == null || value === "") {
    return null;
  }

  const seconds = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(seconds * 1000);
}

function dateFromMilliseconds(value: bigint | number | string | undefined) {
  if (value == null || value === "") {
    return null;
  }

  const milliseconds = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return null;
  }

  return new Date(milliseconds);
}

function eventCreatedAt(event: LiveKitWebhookEventLike) {
  return dateFromSeconds(event.createdAt) ?? new Date();
}

function metadataValue(metadata: JsonRecord | null, ...keys: string[]) {
  for (const key of keys) {
    const value = asString(metadata?.[key]);
    if (value) {
      return value;
    }
  }

  return "";
}

function eventStorageFields(event: LiveKitWebhookEventLike) {
  return {
    createdAtFromLiveKit: event.createdAt ? eventCreatedAt(event) : null,
    eventId: asString(event.id),
    eventType: asString(event.event),
    participantIdentity: asString(event.participant?.identity) || null,
    participantSid: asString(event.participant?.sid) || null,
    roomName: asString(event.room?.name) || null,
    roomSid: asString(event.room?.sid) || null,
  };
}

export function deriveLiveKitAgentCallSkeleton(
  event: LiveKitWebhookEventLike,
): LiveKitAgentCallSkeleton | null {
  const fields = eventStorageFields(event);
  if (!fields.eventId || !fields.eventType) {
    return null;
  }

  const attributes = event.participant?.attributes ?? {};
  const participantMetadata = parseJsonObject(event.participant?.metadata);
  const roomMetadata = parseJsonObject(event.room?.metadata);
  const sipCallId = pickFirst(
    attributes["sip.callID"],
    attributes["sip.callId"],
    metadataValue(participantMetadata, "sipCallId", "callId"),
    metadataValue(roomMetadata, "sipCallId", "callId"),
  );
  const callerPhone = pickFirst(
    attributes["sip.phoneNumber"],
    attributes["sip.from"],
    metadataValue(participantMetadata, "callerPhone", "fromPhone"),
    metadataValue(roomMetadata, "callerPhone", "fromPhone"),
  );
  const officePhone = pickFirst(
    attributes["sip.trunkPhoneNumber"],
    attributes["sip.to"],
    metadataValue(participantMetadata, "officePhone", "trunkPhone", "toPhone"),
    metadataValue(roomMetadata, "officePhone", "trunkPhone", "toPhone"),
  );
  const callId = pickFirst(
    sipCallId,
    metadataValue(participantMetadata, "callId"),
    metadataValue(roomMetadata, "callId"),
    fields.roomName,
    fields.participantIdentity,
    fields.roomSid,
  );

  if (!callId || !callerPhone || !officePhone) {
    return null;
  }

  const createdAt = eventCreatedAt(event);
  const startedAt =
    dateFromMilliseconds(event.room?.creationTimeMs) ??
    dateFromSeconds(event.room?.creationTime) ??
    dateFromMilliseconds(event.participant?.joinedAtMs) ??
    dateFromSeconds(event.participant?.joinedAt) ??
    createdAt;
  const isTerminal = TERMINAL_EVENTS.has(fields.eventType);
  const endedAt = isTerminal ? createdAt : null;

  return {
    agentId:
      metadataValue(participantMetadata, "agentId") ||
      metadataValue(roomMetadata, "agentId") ||
      null,
    callId,
    callerPhone,
    durationSec: endedAt
      ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
      : 0,
    endedAt,
    eventId: fields.eventId,
    eventType: fields.eventType,
    livekitContext: {
      eventId: fields.eventId,
      eventType: fields.eventType,
      participantIdentity: fields.participantIdentity,
      participantSid: fields.participantSid,
      roomName: fields.roomName,
      roomSid: fields.roomSid,
      sipCallId: sipCallId || null,
    },
    officePhone,
    practiceId:
      metadataValue(participantMetadata, "practiceId") ||
      metadataValue(roomMetadata, "practiceId") ||
      null,
    startedAt,
    status: isTerminal ? "FAILED" : "IN_PROGRESS",
  };
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return toJsonCompatible(value) as Prisma.InputJsonValue;
}

function safeProcessingError(error: unknown) {
  if (error instanceof CallIngestionError) {
    return "practice_resolution_failed";
  }

  return error instanceof Error ? error.name || "processing_error" : "processing_error";
}

function skeletonData(skeleton: LiveKitAgentCallSkeleton) {
  return {
    livekitContext: skeleton.livekitContext,
    source: "livekit-webhook",
    webhookFallback: {
      createdFromWebhook: true,
      lastEventAt: (skeleton.endedAt ?? skeleton.startedAt).toISOString(),
      lastEventId: skeleton.eventId,
      lastEventType: skeleton.eventType,
      runtimeFinalPayloadMissing: skeleton.status === "FAILED",
    },
  };
}

function mergeSkeletonData(
  existing: Prisma.JsonValue | null,
  skeleton: LiveKitAgentCallSkeleton,
) {
  const current = asRecord(existing);
  const next = skeletonData(skeleton);
  const currentLiveKitContext = asRecord(current?.livekitContext);
  const currentFallback = asRecord(current?.webhookFallback);

  return {
    ...(current ?? {}),
    livekitContext: {
      ...(currentLiveKitContext ?? {}),
      ...next.livekitContext,
    },
    webhookFallback: {
      ...(currentFallback ?? {}),
      ...next.webhookFallback,
    },
  };
}

async function upsertAgentCallSkeleton(skeleton: LiveKitAgentCallSkeleton) {
  const practice = await resolvePracticeForCall({
    officePhone: skeleton.officePhone,
    practiceId: skeleton.practiceId,
  });
  const agentId = await resolveAgentForCall({
    agentId: skeleton.agentId,
    practiceId: practice.practiceId,
  });
  const existing = await prisma.agentCall.findUnique({
    select: {
      data: true,
      durationSec: true,
      endedAt: true,
      id: true,
      status: true,
    },
    where: {
      callId: skeleton.callId,
    },
  });

  if (!existing) {
    return prisma.agentCall.create({
      data: {
        agentId,
        callId: skeleton.callId,
        callerPhone: skeleton.callerPhone,
        data: jsonInput(skeletonData(skeleton)),
        durationSec: skeleton.durationSec,
        endedAt: skeleton.endedAt,
        latencyValues: jsonInput({}),
        locationId: practice.locationId,
        officePhone: skeleton.officePhone,
        outcomeSummary:
          skeleton.status === "FAILED"
            ? "LiveKit ended the call before a runtime final payload reached the portal."
            : "LiveKit observed the call; awaiting runtime final payload.",
        practiceId: practice.practiceId,
        startedAt: skeleton.startedAt,
        status: skeleton.status,
      },
      select: {
        id: true,
      },
    });
  }

  const shouldClose = skeleton.status === "FAILED" && existing.status === "IN_PROGRESS";
  const updateData: Prisma.AgentCallUpdateInput = {
    data: jsonInput(mergeSkeletonData(existing.data, skeleton)),
  };

  if (shouldClose) {
    updateData.status = "FAILED";
    updateData.endedAt = skeleton.endedAt;
    updateData.durationSec = skeleton.durationSec;
    updateData.outcomeSummary =
      "LiveKit ended the call before a runtime final payload reached the portal.";
  } else if (!existing.endedAt && skeleton.endedAt) {
    updateData.endedAt = skeleton.endedAt;
  }

  if (existing.durationSec === 0 && skeleton.durationSec > 0) {
    updateData.durationSec = skeleton.durationSec;
  }

  return prisma.agentCall.update({
    data: updateData,
    select: {
      id: true,
    },
    where: {
      id: existing.id,
    },
  });
}

async function verifyLiveKitWebhook(rawBody: string, authorization: string | null) {
  const credentials = getWebhookCredentials();

  if (credentials.allowUnverified && (!credentials.apiKey || !credentials.apiSecret)) {
    return JSON.parse(rawBody) as LiveKitWebhookEventLike;
  }

  if (!credentials.apiKey || !credentials.apiSecret) {
    throw new LiveKitWebhookIngestionError(
      "LiveKit webhook credentials are not configured",
      500,
    );
  }

  const receiver = new WebhookReceiver(credentials.apiKey, credentials.apiSecret);
  return receiver.receive(rawBody, authorization ?? undefined);
}

export async function ingestLiveKitWebhook(
  rawBody: string,
  authorization: string | null,
) {
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new LiveKitWebhookIngestionError("Invalid JSON", 400);
  }

  let event: LiveKitWebhookEventLike;

  try {
    event = await verifyLiveKitWebhook(rawBody, authorization);
  } catch (error) {
    if (error instanceof LiveKitWebhookIngestionError) {
      throw error;
    }

    throw new LiveKitWebhookIngestionError("Invalid LiveKit webhook signature", 401);
  }

  const fields = eventStorageFields(event);
  if (!fields.eventId || !fields.eventType) {
    throw new LiveKitWebhookIngestionError("Missing LiveKit event id or type", 400);
  }

  const stored = await prisma.liveKitWebhookEvent.upsert({
    create: {
      createdAtFromLiveKit: fields.createdAtFromLiveKit,
      eventId: fields.eventId,
      eventType: fields.eventType,
      participantIdentity: fields.participantIdentity,
      participantSid: fields.participantSid,
      payload: jsonInput(payload),
      roomName: fields.roomName,
      roomSid: fields.roomSid,
    },
    update: {
      createdAtFromLiveKit: fields.createdAtFromLiveKit,
      eventType: fields.eventType,
      participantIdentity: fields.participantIdentity,
      participantSid: fields.participantSid,
      payload: jsonInput(payload),
      roomName: fields.roomName,
      roomSid: fields.roomSid,
    },
    where: {
      eventId: fields.eventId,
    },
  });

  if (stored.processingStatus === "PROCESSED" && stored.agentCallId) {
    return {
      agentCallId: stored.agentCallId,
      eventId: fields.eventId,
      eventType: fields.eventType,
      processingStatus: "PROCESSED",
    } satisfies LiveKitWebhookProcessingResult;
  }

  const skeleton = deriveLiveKitAgentCallSkeleton(event);
  if (!skeleton) {
    await prisma.liveKitWebhookEvent.update({
      data: {
        errorMessage: null,
        processedAt: new Date(),
        processingStatus: "IGNORED",
      },
      where: {
        id: stored.id,
      },
    });

    return {
      agentCallId: null,
      eventId: fields.eventId,
      eventType: fields.eventType,
      processingStatus: "IGNORED",
    } satisfies LiveKitWebhookProcessingResult;
  }

  try {
    const agentCall = await upsertAgentCallSkeleton(skeleton);

    await prisma.liveKitWebhookEvent.update({
      data: {
        agentCallId: agentCall.id,
        errorMessage: null,
        processedAt: new Date(),
        processingStatus: "PROCESSED",
      },
      where: {
        id: stored.id,
      },
    });

    return {
      agentCallId: agentCall.id,
      eventId: fields.eventId,
      eventType: fields.eventType,
      processingStatus: "PROCESSED",
    } satisfies LiveKitWebhookProcessingResult;
  } catch (error) {
    await prisma.liveKitWebhookEvent.update({
      data: {
        errorMessage: safeProcessingError(error),
        processedAt: new Date(),
        processingStatus: "FAILED",
      },
      where: {
        id: stored.id,
      },
    });

    return {
      agentCallId: null,
      eventId: fields.eventId,
      eventType: fields.eventType,
      processingStatus: "FAILED",
    } satisfies LiveKitWebhookProcessingResult;
  }
}
