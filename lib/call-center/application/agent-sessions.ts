import type {
  CallCenterAgentConnectionState,
  CallCenterAgentPresence,
} from "@/generated/prisma/client";
import {
  readinessValidationError,
  resolveAgentSessionReadyAt,
} from "@/lib/call-center/domain/agent-session-readiness";
import { serializeAgentConnectionState } from "@/lib/call-center/domain/agent-session-wire";

export const AGENT_SESSION_LEASE_MS = 60_000;

export class AgentSessionError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AgentSessionError";
    this.status = status;
  }
}

export type AgentSessionActor = {
  allowedLocationIds: string[];
  hasAllLocationAccess: boolean;
  practiceId: string;
  userId: string;
};

export type AgentSessionEndpoint = {
  id: string;
  label: string;
  locationId: string | null;
  providerCredentialId: string;
};

export type AgentSessionRecord = {
  audioReady: boolean;
  clientInstanceId: string;
  connectionState: CallCenterAgentConnectionState;
  currentCallId: string | null;
  offeredCallId: string | null;
  endpointId: string;
  id: string;
  lastHeartbeatAt: Date;
  leaseExpiresAt: Date;
  microphoneReady: boolean;
  practiceId: string;
  presence: CallCenterAgentPresence;
  readyAt: Date | null;
  stateVersion: number;
  userId: string;
};

export type AgentSessionUpdate = Partial<
  Pick<
    AgentSessionRecord,
    | "audioReady"
    | "connectionState"
    | "lastHeartbeatAt"
    | "leaseExpiresAt"
    | "microphoneReady"
    | "presence"
    | "readyAt"
    | "stateVersion"
    | "userId"
  >
>;

export type AgentSessionEvent = {
  actorUserId: string | null;
  aggregateId: string;
  data: Record<string, boolean | number | string | null>;
  occurredAt: Date;
  practiceId: string;
  type: string;
};

export interface AgentSessionTransaction {
  appendEvent(event: AgentSessionEvent): Promise<void>;
  closeExpiredSessions(
    practiceId: string,
    userId: string,
    now: Date,
  ): Promise<AgentSessionRecord[]>;
  createSession(input: AgentSessionRecord): Promise<AgentSessionRecord>;
  findActiveSession(
    practiceId: string,
    userId: string,
  ): Promise<AgentSessionRecord | null>;
  findSession(
    practiceId: string,
    userId: string,
    clientInstanceId: string,
  ): Promise<AgentSessionRecord | null>;
  getAccessibleEndpoint(actor: AgentSessionActor): Promise<AgentSessionEndpoint | null>;
  hasQueueAccess(
    actor: AgentSessionActor,
    endpoint: AgentSessionEndpoint,
  ): Promise<boolean>;
  updateSession(id: string, update: AgentSessionUpdate): Promise<AgentSessionRecord>;
}

export interface AgentSessionStore {
  createId(): string;
  withAgentLock<T>(
    actor: AgentSessionActor,
    work: (transaction: AgentSessionTransaction) => Promise<T>,
  ): Promise<T>;
}

type SessionIdentity = {
  clientInstanceId: string;
};

export type AgentSessionReadinessUpdate = SessionIdentity & {
  audioReady: boolean;
  connectionState: CallCenterAgentConnectionState;
  expectedStateVersion: number;
  microphoneReady: boolean;
  presence: CallCenterAgentPresence;
  sessionId: string;
};

type OwnedSessionIdentity = SessionIdentity & {
  expectedStateVersion: number;
  sessionId: string;
};

type ExpectedError = { error: AgentSessionError };

function leaseExpiry(now: Date) {
  return new Date(now.getTime() + AGENT_SESSION_LEASE_MS);
}

function eventFor(
  actor: AgentSessionActor,
  session: AgentSessionRecord,
  type: string,
  now: Date,
  actorUserId: string | null = actor.userId,
): AgentSessionEvent {
  return {
    actorUserId,
    aggregateId: session.id,
    data: {
      audioReady: session.audioReady,
      connectionState: serializeAgentConnectionState(session.connectionState),
      currentCallId: session.currentCallId,
      offeredCallId: session.offeredCallId,
      endpointId: session.endpointId,
      microphoneReady: session.microphoneReady,
      presence: session.presence,
      stateVersion: session.stateVersion,
    },
    occurredAt: now,
    practiceId: actor.practiceId,
    type,
  };
}

async function recordExpiredSessions(
  transaction: AgentSessionTransaction,
  actor: AgentSessionActor,
  now: Date,
) {
  const expired = await transaction.closeExpiredSessions(
    actor.practiceId,
    actor.userId,
    now,
  );

  for (const session of expired) {
    await transaction.appendEvent(
      eventFor(actor, session, "AGENT_SESSION_LEASE_EXPIRED", now, null),
    );
  }

  return expired;
}

async function authorizeEndpoint(
  transaction: AgentSessionTransaction,
  actor: AgentSessionActor,
): Promise<AgentSessionEndpoint | ExpectedError> {
  const endpoint = await transaction.getAccessibleEndpoint(actor);

  if (!endpoint) {
    return {
      error: new AgentSessionError("Calling is not configured for this user", 404),
    };
  }

  if (!(await transaction.hasQueueAccess(actor, endpoint))) {
    return { error: new AgentSessionError("Queue membership is required", 403) };
  }

  return endpoint;
}

function throwExpected<T>(result: T | ExpectedError): T {
  if ("error" in (result as ExpectedError)) {
    throw (result as ExpectedError).error;
  }

  return result as T;
}

export async function acquireAgentSession(
  store: AgentSessionStore,
  actor: AgentSessionActor,
  input: SessionIdentity,
  now = new Date(),
) {
  const result = await store.withAgentLock(actor, async (transaction) => {
    const endpoint = await authorizeEndpoint(transaction, actor);
    if ("error" in endpoint) return endpoint;

    await recordExpiredSessions(transaction, actor, now);

    const active = await transaction.findActiveSession(actor.practiceId, actor.userId);
    if (
      active &&
      (active.clientInstanceId !== input.clientInstanceId ||
        active.userId !== actor.userId)
    ) {
      return {
        error: new AgentSessionError(
          "This user is already active in another browser",
          409,
        ),
      };
    }

    const existing = await transaction.findSession(
      actor.practiceId,
      actor.userId,
      input.clientInstanceId,
    );
    if (existing && active?.id === existing.id) {
      if (
        (!existing.currentCallId && !existing.offeredCallId) ||
        existing.connectionState !== "CLOSED"
      ) {
        return { endpoint, session: existing };
      }

      const session = await transaction.updateSession(existing.id, {
        audioReady: false,
        connectionState: "CONNECTING",
        lastHeartbeatAt: now,
        leaseExpiresAt: leaseExpiry(now),
        microphoneReady: false,
        presence: existing.currentCallId ? "BUSY" : "PAUSED",
        readyAt: null,
        stateVersion: existing.stateVersion + 1,
        userId: actor.userId,
      });
      await transaction.appendEvent(
        eventFor(actor, session, "AGENT_SESSION_RECONNECTED", now),
      );
      return { endpoint, session };
    }

    let session: AgentSessionRecord;
    if (existing) {
      session = await transaction.updateSession(existing.id, {
        audioReady: false,
        connectionState: "CONNECTING",
        lastHeartbeatAt: now,
        leaseExpiresAt: leaseExpiry(now),
        microphoneReady: false,
        presence: existing.currentCallId ? "BUSY" : "PAUSED",
        readyAt: null,
        stateVersion: existing.stateVersion + 1,
        userId: actor.userId,
      });
    } else {
      session = await transaction.createSession({
        audioReady: false,
        clientInstanceId: input.clientInstanceId,
        connectionState: "CONNECTING",
        currentCallId: null,
        offeredCallId: null,
        endpointId: endpoint.id,
        id: store.createId(),
        lastHeartbeatAt: now,
        leaseExpiresAt: leaseExpiry(now),
        microphoneReady: false,
        practiceId: actor.practiceId,
        presence: "PAUSED",
        readyAt: null,
        stateVersion: 0,
        userId: actor.userId,
      });
    }

    await transaction.appendEvent(
      eventFor(actor, session, "AGENT_SESSION_LEASE_ACQUIRED", now),
    );
    return { endpoint, session };
  });

  return throwExpected(result);
}

export async function updateAgentSessionReadiness(
  store: AgentSessionStore,
  actor: AgentSessionActor,
  input: AgentSessionReadinessUpdate,
  now = new Date(),
) {
  const result = await store.withAgentLock(actor, async (transaction) => {
    const endpoint = await authorizeEndpoint(transaction, actor);
    if ("error" in endpoint) return endpoint;

    const expired = await recordExpiredSessions(transaction, actor, now);
    if (
      expired.some(
        (session) =>
          session.id === input.sessionId &&
          session.clientInstanceId === input.clientInstanceId &&
          session.userId === actor.userId,
      )
    ) {
      return {
        error: new AgentSessionError("Agent session expired; reconnect it", 409),
      };
    }

    const session = await transaction.findSession(
      actor.practiceId,
      actor.userId,
      input.clientInstanceId,
    );
    if (!session || session.id !== input.sessionId || session.userId !== actor.userId) {
      return { error: new AgentSessionError("Agent session not found", 404) };
    }

    const active = await transaction.findActiveSession(actor.practiceId, actor.userId);
    if (active?.id !== session.id) {
      return {
        error: new AgentSessionError("Agent session is not active; reconnect it", 409),
      };
    }

    if (session.stateVersion !== input.expectedStateVersion) {
      return {
        error: new AgentSessionError("Agent session state is stale", 409),
      };
    }

    if (input.presence === "OFFLINE" || input.connectionState === "CLOSED") {
      return {
        error: new AgentSessionError("Use DELETE to release an agent session", 422),
      };
    }

    const nextReadiness = {
      audioReady: input.audioReady,
      connectionState: input.connectionState,
      currentCallId: session.currentCallId,
      offeredCallId: session.offeredCallId,
      microphoneReady: input.microphoneReady,
      presence: input.presence,
    };
    const validationError = readinessValidationError(nextReadiness);
    if (validationError) {
      return { error: new AgentSessionError(validationError, 422) };
    }

    const readyAt = resolveAgentSessionReadyAt(nextReadiness, session.readyAt, now);
    const readinessUnchanged =
      session.audioReady === input.audioReady &&
      session.connectionState === input.connectionState &&
      session.microphoneReady === input.microphoneReady &&
      session.presence === input.presence &&
      (session.readyAt?.getTime() ?? null) === (readyAt?.getTime() ?? null);
    if (readinessUnchanged) {
      const heartbeat = await transaction.updateSession(session.id, {
        lastHeartbeatAt: now,
        leaseExpiresAt: leaseExpiry(now),
      });
      return { session: heartbeat };
    }

    const updated = await transaction.updateSession(session.id, {
      audioReady: input.audioReady,
      connectionState: input.connectionState,
      lastHeartbeatAt: now,
      leaseExpiresAt: leaseExpiry(now),
      microphoneReady: input.microphoneReady,
      presence: input.presence,
      readyAt,
      stateVersion: session.stateVersion + 1,
    });
    await transaction.appendEvent(
      eventFor(actor, updated, "AGENT_SESSION_READINESS_UPDATED", now),
    );
    return { session: updated };
  });

  return throwExpected(result);
}

export async function releaseAgentSession(
  store: AgentSessionStore,
  actor: AgentSessionActor,
  input: OwnedSessionIdentity,
  now = new Date(),
) {
  const result = await store.withAgentLock(actor, async (transaction) => {
    const endpoint = await authorizeEndpoint(transaction, actor);
    if ("error" in endpoint) return endpoint;

    const expired = await recordExpiredSessions(transaction, actor, now);
    const session = await transaction.findSession(
      actor.practiceId,
      actor.userId,
      input.clientInstanceId,
    );
    if (!session || session.id !== input.sessionId || session.userId !== actor.userId) {
      return { error: new AgentSessionError("Agent session not found", 404) };
    }

    if (expired.some((candidate) => candidate.id === session.id)) {
      return { session };
    }

    if (session.presence === "OFFLINE" && session.connectionState === "CLOSED") {
      return { session };
    }

    if (session.stateVersion !== input.expectedStateVersion) {
      return {
        error: new AgentSessionError("Agent session state is stale", 409),
      };
    }

    if (session.currentCallId || session.offeredCallId) {
      const reconnecting = await transaction.updateSession(session.id, {
        audioReady: false,
        connectionState: "CONNECTING",
        lastHeartbeatAt: now,
        leaseExpiresAt: leaseExpiry(now),
        microphoneReady: false,
        presence: session.currentCallId ? "BUSY" : "PAUSED",
        readyAt: null,
        stateVersion: session.stateVersion + 1,
      });
      await transaction.appendEvent(
        eventFor(actor, reconnecting, "AGENT_SESSION_RECONNECTING", now),
      );
      return { session: reconnecting };
    }

    const released = await transaction.updateSession(session.id, {
      audioReady: false,
      connectionState: "CLOSED",
      lastHeartbeatAt: now,
      leaseExpiresAt: now,
      microphoneReady: false,
      presence: "OFFLINE",
      readyAt: null,
      stateVersion: session.stateVersion + 1,
    });
    await transaction.appendEvent(
      eventFor(actor, released, "AGENT_SESSION_RELEASED", now),
    );
    return { session: released };
  });

  return throwExpected(result);
}
