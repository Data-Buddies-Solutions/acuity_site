import { describe, expect, it } from "bun:test";

import { createCallCenterActionHandlers } from "./action-handlers";

const context = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practice: {
    id: "practice-1",
    locations: [{ id: "location-1" }],
  },
  session: { user: { id: "user-1" } },
};

describe("Call Center server-action translation", () => {
  it("passes caller-thread identity and optimistic task state to follow-up", async () => {
    let captured: unknown;
    const revalidated: string[] = [];
    const actions = createCallCenterActionHandlers({
      followUp: {
        resolveCallerThread: async (actor, input) => {
          captured = { actor, input };
          return {
            canonicalTasksResolved: 2,
            occurredAt: "2026-07-20T12:00:00.000Z",
            operationType: "CALLER_THREAD_RESOLUTION",
            replayed: false,
            revision: "42",
            status: "CONFIRMED",
          };
        },
        saveNote: async () => {
          throw new Error("unused");
        },
      },
      getContext: async () => context,
      revalidate: (path) => revalidated.push(path),
    });
    const formData = new FormData();
    formData.set("idempotencyKey", "resolve-1");
    formData.set("office", "location-1");
    formData.set("phone", "+15555550123");
    formData.set("queue", "queue-1");
    formData.append("taskId", "task-1");
    formData.append("taskId", "task-2");

    await actions.resolveNeedsActionGroup(formData);

    expect(captured).toEqual({
      actor: {
        allowedLocationIds: ["location-1"],
        hasAllLocationAccess: false,
        practiceId: "practice-1",
        userId: "user-1",
      },
      input: {
        expectedTaskIds: ["task-1", "task-2"],
        idempotencyKey: "resolve-1",
        locationId: "location-1",
        phone: "+15555550123",
        queueId: "queue-1",
      },
    });
    expect(revalidated).toContain("/portal/app/call-center/follow-up");
  });

  it("passes one versioned note command using the shared disposition vocabulary", async () => {
    let captured: unknown;
    const actions = createCallCenterActionHandlers({
      followUp: {
        resolveCallerThread: async () => {
          throw new Error("unused");
        },
        saveNote: async (actor, input) => {
          captured = { actor, input };
          return {
            callId: "call-1",
            occurredAt: "2026-07-20T12:00:00.000Z",
            operationType: "OPERATOR_NOTE",
            replayed: false,
            revision: "43",
            status: "CONFIRMED",
            taskId: "task-3",
          };
        },
      },
      getContext: async () => context,
      revalidate: () => {},
    });
    const formData = new FormData();
    formData.set("callId", "call-1");
    formData.set("disposition", "CALLBACK_NEEDED");
    formData.set("expectedStateVersion", "7");
    formData.set("idempotencyKey", "note-1");
    formData.set("note", "Call tomorrow");
    formData.set("office", "location-1");
    formData.set("phone", "+15555550123");
    formData.append("taskId", "task-1");

    await actions.saveCallCenterNote(formData);

    expect(captured).toMatchObject({
      actor: { practiceId: "practice-1", userId: "user-1" },
      input: {
        callId: "call-1",
        disposition: "CALLBACK_NEEDED",
        expectedStateVersion: 7,
        expectedTaskIds: ["task-1"],
        idempotencyKey: "note-1",
        locationId: "location-1",
        note: "Call tomorrow",
        phone: "+15555550123",
      },
    });
  });

  it("rejects an unknown disposition instead of translating it to resolved", async () => {
    let invoked = false;
    const actions = createCallCenterActionHandlers({
      followUp: {
        resolveCallerThread: async () => {
          throw new Error("unused");
        },
        saveNote: async () => {
          invoked = true;
          throw new Error("should not run");
        },
      },
      getContext: async () => context,
      revalidate: () => {},
    });
    const formData = new FormData();
    formData.set("callId", "call-1");
    formData.set("disposition", "UNKNOWN");
    formData.set("expectedStateVersion", "7");
    formData.set("idempotencyKey", "note-1");
    formData.set("phone", "+15555550123");

    expect(await actions.saveCallCenterNote(formData)).toEqual({
      error: "We couldn't save this outcome. Check the details and try again.",
      ok: false,
    });
    expect(invoked).toBe(false);
  });
});
