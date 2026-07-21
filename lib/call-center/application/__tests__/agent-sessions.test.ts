import { describe, expect, it } from "bun:test";

import {
  acquireAgentSession,
  AGENT_SESSION_LEASE_MS,
  AgentSessionError,
  type AgentSessionEvent,
  type AgentSessionRecord,
  type AgentSessionStore,
  type AgentSessionTransaction,
  releaseAgentSession,
  updateAgentSessionReadiness,
} from "../agent-sessions";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};

class FakeStore implements AgentSessionStore {
  activeCallEndpoints = new Set<string>();
  connectedCallEndpoints = new Set<string>();
  endpoint = {
    id: "seat-legacy-id",
    label: "Optical",
    locationId: "location-1",
    providerCredentialId: "credential-1",
  };
  events: AgentSessionEvent[] = [];
  queueAccess = true;
  sessions: AgentSessionRecord[] = [];
  private nextId = 1;
  private locks = new Map<string, Promise<void>>();

  createId() {
    return `session-${this.nextId++}`;
  }

  async withAgentLock<T>(
    requestActor: typeof actor,
    work: (transaction: AgentSessionTransaction) => Promise<T>,
  ) {
    const lockKey = `${requestActor.practiceId}:${requestActor.userId}`;
    const previous = this.locks.get(lockKey) ?? Promise.resolve();
    let unlock = () => {};
    const current = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    this.locks.set(
      lockKey,
      previous.then(() => current),
    );
    await previous;

    const transaction: AgentSessionTransaction = {
      appendEvent: async (event) => {
        this.events.push(event);
      },
      closeExpiredSessions: async (practiceId, userId, now) => {
        const expired = this.sessions.filter(
          (session) =>
            session.practiceId === practiceId &&
            session.userId === userId &&
            session.presence !== "OFFLINE" &&
            session.connectionState !== "CLOSED" &&
            session.leaseExpiresAt <= now,
        );
        for (const session of expired) {
          Object.assign(session, {
            audioReady: false,
            connectionState: "CLOSED",
            lastHeartbeatAt: now,
            leaseExpiresAt: now,
            microphoneReady: false,
            presence: "OFFLINE",
            readyAt: null,
            stateVersion: session.stateVersion + 1,
          });
        }
        return expired.map((session) => ({ ...session }));
      },
      createSession: async (input) => {
        const created: AgentSessionRecord = { ...input };
        this.sessions.push(created);
        return { ...created };
      },
      findActiveSession: async (practiceId, userId) => {
        const found = this.sessions.find(
          (session) =>
            session.practiceId === practiceId &&
            session.userId === userId &&
            (this.activeCallEndpoints.has(session.endpointId) ||
              (session.presence !== "OFFLINE" && session.connectionState !== "CLOSED")),
        );
        return found ? { ...found } : null;
      },
      findSession: async (practiceId, userId, clientInstanceId) => {
        const found = this.sessions.find(
          (session) =>
            session.practiceId === practiceId &&
            session.userId === userId &&
            session.clientInstanceId === clientInstanceId,
        );
        return found ? { ...found } : null;
      },
      getAccessibleEndpoint: async (sessionActor) => {
        const allowedLocation =
          sessionActor.hasAllLocationAccess ||
          sessionActor.allowedLocationIds.includes(this.endpoint.locationId);
        return sessionActor.practiceId === actor.practiceId && allowedLocation
          ? this.endpoint
          : null;
      },
      hasActiveCall: async (endpointId) => this.activeCallEndpoints.has(endpointId),
      hasConnectedCall: async (endpointId) => this.connectedCallEndpoints.has(endpointId),
      hasQueueAccess: async () => this.queueAccess,
      updateSession: async (id, update) => {
        const session = this.sessions.find((candidate) => candidate.id === id);
        if (!session) throw new Error("missing fake session");
        Object.assign(session, update);
        return { ...session };
      },
    };

    try {
      return await work(transaction);
    } finally {
      unlock();
    }
  }
}

const identity = {
  clientInstanceId: "browser-1",
};
const start = new Date("2026-07-11T12:00:00.000Z");

describe("canonical agent sessions", () => {
  it("serializes concurrent browsers so only one can own an agent login", async () => {
    const store = new FakeStore();
    const results = await Promise.allSettled([
      acquireAgentSession(store, actor, identity, start),
      acquireAgentSession(
        store,
        actor,
        { ...identity, clientInstanceId: "browser-2" },
        start,
      ),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const rejected = results.find((result) => result.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect(
      store.sessions.filter(
        (session) =>
          session.presence !== "OFFLINE" && session.connectionState !== "CLOSED",
      ),
    ).toHaveLength(1);
  });

  it("moves an idle phone lease only after an explicit takeover", async () => {
    const store = new FakeStore();
    const first = await acquireAgentSession(store, actor, identity, start);
    const second = await acquireAgentSession(
      store,
      actor,
      { clientInstanceId: "browser-2", takeover: true },
      new Date(start.getTime() + 1_000),
    );

    expect(store.sessions.find(({ id }) => id === first.session.id)).toMatchObject({
      connectionState: "CLOSED",
      presence: "OFFLINE",
    });
    expect(second.session.clientInstanceId).toBe("browser-2");
    expect(store.events.map(({ type }) => type)).toContain("AGENT_SESSION_TAKEN_OVER");
  });

  it("does not move a phone lease during an active call", async () => {
    const store = new FakeStore();
    await acquireAgentSession(store, actor, identity, start);
    store.activeCallEndpoints.add(store.sessions[0]!.endpointId);

    await expect(
      acquireAgentSession(
        store,
        actor,
        { clientInstanceId: "browser-2", takeover: true },
        new Date(start.getTime() + 1_000),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("makes acquisition replay read-only for the same user and client", async () => {
    const store = new FakeStore();
    const first = await acquireAgentSession(store, actor, identity, start);
    const second = await acquireAgentSession(
      store,
      actor,
      identity,
      new Date(start.getTime() + 1_000),
    );

    expect(second.session.id).toBe(first.session.id);
    expect(first.session.stateVersion).toBe(0);
    expect(second.session.stateVersion).toBe(0);
    expect(store.sessions).toHaveLength(1);
    expect(store.events.map((event) => event.type)).toEqual([
      "AGENT_SESSION_LEASE_ACQUIRED",
    ]);
  });

  it("serializes concurrent same-client replays without mutating twice", async () => {
    const store = new FakeStore();
    const [first, replay] = await Promise.all([
      acquireAgentSession(store, actor, identity, start),
      acquireAgentSession(store, actor, identity, start),
    ]);

    expect(replay.session.id).toBe(first.session.id);
    expect(replay.session.stateVersion).toBe(0);
    expect(store.sessions).toHaveLength(1);
    expect(store.events).toHaveLength(1);
  });

  it("closes an expired lease before a different browser acquires it", async () => {
    const store = new FakeStore();
    const first = await acquireAgentSession(store, actor, identity, start);
    const second = await acquireAgentSession(
      store,
      actor,
      { ...identity, clientInstanceId: "browser-2" },
      new Date(start.getTime() + 60_001),
    );

    expect(
      store.sessions.find((session) => session.id === first.session.id),
    ).toMatchObject({
      connectionState: "CLOSED",
      presence: "OFFLINE",
      stateVersion: 1,
    });
    expect(second.session.id).not.toBe(first.session.id);
    expect(store.events.map((event) => event.type)).toContain(
      "AGENT_SESSION_LEASE_EXPIRED",
    );
  });

  it("requires tenant location access and an enabled queue membership", async () => {
    const store = new FakeStore();

    await expect(
      acquireAgentSession(
        store,
        { ...actor, allowedLocationIds: ["location-2"] },
        identity,
        start,
      ),
    ).rejects.toMatchObject({ status: 404 });

    store.queueAccess = false;
    await expect(
      acquireAgentSession(store, actor, identity, start),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(store.sessions).toHaveLength(0);
  });

  it("persists explicit readiness and its event together", async () => {
    const store = new FakeStore();
    await acquireAgentSession(store, actor, identity, start);

    const result = await updateAgentSessionReadiness(
      store,
      actor,
      {
        ...identity,
        audioReady: true,
        connectionState: "READY",
        microphoneReady: true,
        presence: "AVAILABLE",
        expectedStateVersion: 0,
        sessionId: "session-1",
      },
      new Date(start.getTime() + 1_000),
    );

    expect(result.session).toMatchObject({
      audioReady: true,
      connectionState: "READY",
      microphoneReady: true,
      presence: "AVAILABLE",
      readyAt: new Date(start.getTime() + 1_000),
      stateVersion: 1,
    });
    expect(store.events.at(-1)?.type).toBe("AGENT_SESSION_READINESS_UPDATED");
    expect(store.events.at(-1)?.data.stateVersion).toBe(1);
  });

  it("extends an unchanged lease without publishing another state", async () => {
    const store = new FakeStore();
    await acquireAgentSession(store, actor, identity, start);
    const ready = await updateAgentSessionReadiness(
      store,
      actor,
      {
        ...identity,
        audioReady: true,
        connectionState: "READY",
        microphoneReady: true,
        presence: "AVAILABLE",
        expectedStateVersion: 0,
        sessionId: "session-1",
      },
      new Date(start.getTime() + 1_000),
    );

    const heartbeatAt = new Date(start.getTime() + 10_000);
    const heartbeat = await updateAgentSessionReadiness(
      store,
      actor,
      {
        ...identity,
        audioReady: true,
        connectionState: "READY",
        microphoneReady: true,
        presence: "AVAILABLE",
        expectedStateVersion: ready.session.stateVersion,
        sessionId: ready.session.id,
      },
      heartbeatAt,
    );

    expect(heartbeat.session).toMatchObject({
      lastHeartbeatAt: heartbeatAt,
      leaseExpiresAt: new Date(heartbeatAt.getTime() + AGENT_SESSION_LEASE_MS),
      stateVersion: ready.session.stateVersion,
    });
    expect(store.events.map((event) => event.type)).toEqual([
      "AGENT_SESSION_LEASE_ACQUIRED",
      "AGENT_SESSION_READINESS_UPDATED",
    ]);
  });

  it("derives busy and available presence from connected calls", async () => {
    const store = new FakeStore();
    const acquired = await acquireAgentSession(store, actor, identity, start);
    store.activeCallEndpoints.add(acquired.session.endpointId);
    store.connectedCallEndpoints.add(acquired.session.endpointId);

    const busy = await updateAgentSessionReadiness(
      store,
      actor,
      {
        ...identity,
        audioReady: true,
        connectionState: "READY",
        expectedStateVersion: acquired.session.stateVersion,
        microphoneReady: true,
        presence: "AVAILABLE",
        sessionId: acquired.session.id,
      },
      new Date(start.getTime() + 1_000),
    );
    expect(busy.session.presence).toBe("BUSY");

    store.activeCallEndpoints.clear();
    store.connectedCallEndpoints.clear();
    const available = await updateAgentSessionReadiness(
      store,
      actor,
      {
        ...identity,
        audioReady: true,
        connectionState: "READY",
        expectedStateVersion: busy.session.stateVersion,
        microphoneReady: true,
        presence: "AVAILABLE",
        sessionId: busy.session.id,
      },
      new Date(start.getTime() + 2_000),
    );
    expect(available.session.presence).toBe("AVAILABLE");
  });

  it("rejects availability changes while the session is occupied", async () => {
    const store = new FakeStore();
    const acquired = await acquireAgentSession(store, actor, identity, start);
    store.activeCallEndpoints.add(acquired.session.endpointId);

    for (const availabilityIntent of ["AVAILABLE", "PAUSED"] as const) {
      await expect(
        updateAgentSessionReadiness(
          store,
          actor,
          {
            ...identity,
            audioReady: true,
            availabilityChange: true,
            availabilityIntent,
            connectionState: "READY",
            expectedStateVersion: acquired.session.stateVersion,
            microphoneReady: true,
            presence: availabilityIntent,
            sessionId: acquired.session.id,
          },
          new Date(start.getTime() + 1_000),
        ),
      ).rejects.toEqual(
        new AgentSessionError(
          "Availability cannot be changed during an active call",
          409,
        ),
      );
    }
    expect(store.sessions[0]).toMatchObject({
      presence: "PAUSED",
      stateVersion: acquired.session.stateVersion,
    });
  });

  it("preserves explicit unavailability when media readiness improves", async () => {
    const store = new FakeStore();
    const acquired = await acquireAgentSession(store, actor, identity, start);
    const paused = await updateAgentSessionReadiness(
      store,
      actor,
      {
        ...identity,
        audioReady: false,
        availabilityChange: true,
        availabilityIntent: "PAUSED",
        connectionState: "CONNECTING",
        expectedStateVersion: acquired.session.stateVersion,
        microphoneReady: false,
        presence: "PAUSED",
        sessionId: acquired.session.id,
      },
      new Date(start.getTime() + 1_000),
    );

    const readyMedia = await updateAgentSessionReadiness(
      store,
      actor,
      {
        ...identity,
        audioReady: true,
        availabilityIntent: "PAUSED",
        connectionState: "READY",
        expectedStateVersion: paused.session.stateVersion,
        microphoneReady: true,
        presence: "AVAILABLE",
        sessionId: paused.session.id,
      },
      new Date(start.getTime() + 2_000),
    );

    expect(readyMedia.session).toMatchObject({
      audioReady: true,
      connectionState: "READY",
      microphoneReady: true,
      presence: "PAUSED",
    });
  });

  it("preserves available intent while media readiness recovers", async () => {
    const store = new FakeStore();
    const acquired = await acquireAgentSession(store, actor, identity, start);
    const available = await updateAgentSessionReadiness(
      store,
      actor,
      {
        ...identity,
        audioReady: true,
        availabilityChange: true,
        availabilityIntent: "AVAILABLE",
        connectionState: "READY",
        expectedStateVersion: acquired.session.stateVersion,
        microphoneReady: true,
        presence: "AVAILABLE",
        sessionId: acquired.session.id,
      },
      new Date(start.getTime() + 1_000),
    );

    const notReady = await updateAgentSessionReadiness(
      store,
      actor,
      {
        ...identity,
        audioReady: false,
        availabilityIntent: "AVAILABLE",
        connectionState: "ERROR",
        expectedStateVersion: available.session.stateVersion,
        microphoneReady: false,
        presence: "AVAILABLE",
        sessionId: available.session.id,
      },
      new Date(start.getTime() + 2_000),
    );
    expect(notReady.session).toMatchObject({
      audioReady: false,
      connectionState: "ERROR",
      microphoneReady: false,
      presence: "AVAILABLE",
      readyAt: null,
    });

    const recovered = await updateAgentSessionReadiness(
      store,
      actor,
      {
        ...identity,
        audioReady: true,
        availabilityIntent: "AVAILABLE",
        connectionState: "READY",
        expectedStateVersion: notReady.session.stateVersion,
        microphoneReady: true,
        presence: "AVAILABLE",
        sessionId: notReady.session.id,
      },
      new Date(start.getTime() + 3_000),
    );
    expect(recovered.session.presence).toBe("AVAILABLE");
  });

  it("rejects incomplete availability without changing the session", async () => {
    const store = new FakeStore();
    await acquireAgentSession(store, actor, identity, start);

    await expect(
      updateAgentSessionReadiness(
        store,
        actor,
        {
          ...identity,
          audioReady: true,
          connectionState: "READY",
          expectedStateVersion: 0,
          microphoneReady: false,
          presence: "AVAILABLE",
          sessionId: "session-1",
        },
        new Date(start.getTime() + 1_000),
      ),
    ).rejects.toEqual(new AgentSessionError("AVAILABLE requires microphone access", 422));
    expect(store.sessions[0]).toMatchObject({ presence: "PAUSED" });
  });

  it("does not let a delayed older readiness update restore availability", async () => {
    const store = new FakeStore();
    const acquired = await acquireAgentSession(store, actor, identity, start);

    const failed = await updateAgentSessionReadiness(
      store,
      actor,
      {
        ...identity,
        audioReady: false,
        connectionState: "ERROR",
        expectedStateVersion: acquired.session.stateVersion,
        microphoneReady: false,
        presence: "PAUSED",
        sessionId: acquired.session.id,
      },
      new Date(start.getTime() + 2_000),
    );

    await expect(
      updateAgentSessionReadiness(
        store,
        actor,
        {
          ...identity,
          audioReady: true,
          connectionState: "READY",
          expectedStateVersion: acquired.session.stateVersion,
          microphoneReady: true,
          presence: "AVAILABLE",
          sessionId: acquired.session.id,
        },
        new Date(start.getTime() + 1_000),
      ),
    ).rejects.toMatchObject({ status: 409 });

    expect(failed.session).toMatchObject({
      connectionState: "ERROR",
      presence: "PAUSED",
      stateVersion: 1,
    });
    expect(store.sessions[0]).toMatchObject({
      connectionState: "ERROR",
      presence: "PAUSED",
      stateVersion: 1,
    });
  });

  it("releases a lease idempotently", async () => {
    const store = new FakeStore();
    const acquired = await acquireAgentSession(store, actor, identity, start);
    const ownedIdentity = {
      ...identity,
      expectedStateVersion: acquired.session.stateVersion,
      sessionId: acquired.session.id,
    };
    const first = await releaseAgentSession(store, actor, ownedIdentity, start);
    const second = await releaseAgentSession(store, actor, ownedIdentity, start);

    expect(first.session.id).toBe(acquired.session.id);
    expect(second.session.id).toBe(acquired.session.id);
    expect(second.session).toMatchObject({
      connectionState: "CLOSED",
      presence: "OFFLINE",
      stateVersion: 1,
    });
    expect(
      store.events.filter((event) => event.type === "AGENT_SESSION_RELEASED"),
    ).toHaveLength(1);
  });

  it("reserves a session with an active call for reconnect instead of releasing it", async () => {
    const store = new FakeStore();
    const acquired = await acquireAgentSession(store, actor, identity, start);
    store.activeCallEndpoints.add(store.sessions[0].endpointId);
    store.connectedCallEndpoints.add(store.sessions[0].endpointId);
    store.sessions[0].presence = "BUSY";

    const released = await releaseAgentSession(
      store,
      actor,
      {
        ...identity,
        expectedStateVersion: acquired.session.stateVersion,
        sessionId: acquired.session.id,
      },
      new Date(start.getTime() + 1_000),
    );

    expect(released.session).toMatchObject({
      connectionState: "CONNECTING",
      presence: "BUSY",
      stateVersion: 1,
    });
    expect(store.events.at(-1)?.type).toBe("AGENT_SESSION_RECONNECTING");
    expect(store.events.some((event) => event.type === "AGENT_SESSION_RELEASED")).toBe(
      false,
    );
  });

  it("restores an expired active-call session for the same browser", async () => {
    const store = new FakeStore();
    const acquired = await acquireAgentSession(store, actor, identity, start);
    store.activeCallEndpoints.add(store.sessions[0].endpointId);
    store.sessions[0].presence = "BUSY";

    const reconnected = await acquireAgentSession(
      store,
      actor,
      identity,
      new Date(start.getTime() + AGENT_SESSION_LEASE_MS + 1),
    );

    expect(reconnected.session).toMatchObject({
      connectionState: "CONNECTING",
      id: acquired.session.id,
      presence: "PAUSED",
      stateVersion: 2,
    });
    expect(store.events.map((event) => event.type)).toEqual([
      "AGENT_SESSION_LEASE_ACQUIRED",
      "AGENT_SESSION_LEASE_EXPIRED",
      "AGENT_SESSION_RECONNECTED",
    ]);
  });

  it("does not let another browser steal an expired active-call session", async () => {
    const store = new FakeStore();
    await acquireAgentSession(store, actor, identity, start);
    store.activeCallEndpoints.add(store.sessions[0].endpointId);
    store.sessions[0].presence = "BUSY";

    await expect(
      acquireAgentSession(
        store,
        actor,
        { ...identity, clientInstanceId: "browser-2" },
        new Date(start.getTime() + AGENT_SESSION_LEASE_MS + 1),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(store.sessions).toHaveLength(1);
  });
});
