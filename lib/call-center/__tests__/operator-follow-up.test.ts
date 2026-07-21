import { describe, expect, it } from "bun:test";

import {
  createOperatorFollowUp,
  OperatorFollowUpError,
  type OperatorFollowUpTransaction,
} from "@/lib/call-center/operator-follow-up";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};

function followUpHarness() {
  const events: string[] = [];
  const receipts = new Map<
    string,
    Awaited<ReturnType<OperatorFollowUpTransaction["findReceipt"]>>
  >();
  const tasks = new Map([
    ["task-1", "OPEN"],
    ["task-2", "OPEN"],
  ]);
  let callVersion = 3;
  let revision = BigInt(0);
  const resolve = (taskIds: string[]) => {
    const open = [...tasks]
      .filter(([, status]) => status === "OPEN")
      .map(([taskId]) => taskId)
      .sort();
    if (open.join() !== [...taskIds].sort().join()) {
      throw new OperatorFollowUpError("One or more follow-up tasks changed", 409);
    }
    for (const taskId of taskIds) {
      tasks.set(taskId, "RESOLVED");
      events.push(`TASK_RESOLVED:${taskId}`);
    }
  };
  const transaction: OperatorFollowUpTransaction = {
    appendReceipt: async (input, data, now) => {
      const event = {
        actorUserId: input.actorUserId,
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        data,
        occurredAt: now,
        revision: (revision += BigInt(1)),
      };
      receipts.set(input.idempotencyKey, event);
      return event;
    },
    findReceipt: async (_practiceId, _type, idempotencyKey) =>
      receipts.get(idempotencyKey) ?? null,
    lockReceiptKey: async () => {},
    resolveCallerThread: async (_actor, input) => {
      resolve(input.expectedTaskIds);
      return {
        canonicalTasksResolved: input.expectedTaskIds.length,
        operationType: "CALLER_THREAD_RESOLUTION",
        status: "CONFIRMED",
      };
    },
    saveDisposition: async (_actor, input) => {
      if (input.expectedStateVersion !== callVersion) {
        throw new OperatorFollowUpError("Call changed; refresh and try again", 409);
      }
      for (const taskId of input.taskIds) {
        tasks.set(taskId, "RESOLVED");
        events.push(`TASK_RESOLVED:${taskId}`);
      }
      events.push(`CALL_DISPOSITION_SAVED:${input.disposition}`);
      callVersion += 1;
      return {
        callId: input.callId,
        operationType: "DISPOSITION",
        resolvedTaskCount: input.taskIds.length,
        stateVersion: callVersion,
        status: "CONFIRMED",
      };
    },
    saveNote: async (_actor, input) => {
      if (input.expectedStateVersion !== callVersion) {
        throw new OperatorFollowUpError("Call changed; refresh and try again", 409);
      }
      if (["OTHER", "RESOLVED", "WRONG_NUMBER"].includes(input.disposition)) {
        resolve(input.expectedTaskIds);
      }
      const taskId = `created-${events.length + 1}`;
      tasks.set(
        taskId,
        ["CALLBACK_NEEDED", "FOLLOW_UP_REQUIRED"].includes(input.disposition)
          ? "OPEN"
          : "RESOLVED",
      );
      events.push(`TASK_CREATED:${input.disposition}`);
      events.push(`CALL_DISPOSITION_SAVED:${input.disposition}`);
      callVersion += 1;
      return {
        aggregateId: taskId,
        data: {
          callId: input.callId,
          operationType: "OPERATOR_NOTE",
          stateVersion: callVersion,
          status: "CONFIRMED",
          taskId,
        },
      };
    },
  };
  return {
    events,
    followUp: createOperatorFollowUp({
      transaction: async (operation) => operation(transaction),
    }),
    state: {
      get callVersion() {
        return callVersion;
      },
      receipts,
      tasks,
    },
  };
}

describe("operator follow-up module", () => {
  it("dispositions one Call once and rejects stale state", async () => {
    const { events, followUp, state } = followUpHarness();
    const input = {
      callId: "call-1",
      disposition: "RESOLVED" as const,
      expectedStateVersion: 3,
      idempotencyKey: "disposition-1",
      note: "Done",
      taskIds: ["task-1"],
    };

    const first = await followUp.disposition(actor, input);
    const replay = await followUp.disposition(actor, input);

    expect(replay).toEqual({ ...first, replayed: true });
    expect(state.callVersion).toBe(4);
    expect(events).toEqual(["TASK_RESOLVED:task-1", "CALL_DISPOSITION_SAVED:RESOLVED"]);
    await expect(
      followUp.disposition(actor, {
        ...input,
        expectedStateVersion: 2,
        idempotencyKey: "disposition-2",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("resolves one caller thread once across an exact retry", async () => {
    const { followUp, state } = followUpHarness();
    const input = {
      expectedTaskIds: ["task-1", "task-2"],
      idempotencyKey: "resolve-1",
      locationId: "location-1",
      phone: "+15555550123",
      queueId: "queue-1",
    };

    const first = await followUp.resolveCallerThread(actor, input);
    const replay = await followUp.resolveCallerThread(actor, input);

    expect(first).toMatchObject({
      canonicalTasksResolved: 2,
      replayed: false,
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect([...state.tasks.values()]).toEqual(["RESOLVED", "RESOLVED"]);
    expect(state.receipts.size).toBe(1);
  });

  for (const disposition of ["CALLBACK_NEEDED", "FOLLOW_UP_REQUIRED"] as const) {
    it(`creates one open ${disposition} task across a retry`, async () => {
      const { events, followUp, state } = followUpHarness();
      const input = {
        callId: "call-1",
        disposition,
        expectedStateVersion: 3,
        expectedTaskIds: ["task-1", "task-2"],
        idempotencyKey: `note-${disposition}`,
        locationId: "location-1",
        note: "Please call back",
        phone: "+15555550123",
      };

      const first = await followUp.saveNote(actor, input);
      const replay = await followUp.saveNote(actor, input);

      expect(replay).toEqual({ ...first, replayed: true });
      expect(
        [...state.tasks.values()].filter((status) => status === "OPEN"),
      ).toHaveLength(3);
      expect(state.callVersion).toBe(4);
      expect(first).toMatchObject({ stateVersion: 4 });
      expect(events).toEqual([
        `TASK_CREATED:${disposition}`,
        `CALL_DISPOSITION_SAVED:${disposition}`,
      ]);
      await expect(
        followUp.saveNote(actor, {
          ...input,
          idempotencyKey: `stale-${disposition}`,
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  }

  it("records one versioned Call revision and resolves the exact durable task set", async () => {
    const { events, followUp, state } = followUpHarness();
    const input = {
      callId: "call-1",
      disposition: "RESOLVED" as const,
      expectedStateVersion: 3,
      expectedTaskIds: ["task-1", "task-2"],
      idempotencyKey: "note-resolved",
      locationId: "location-1",
      note: "Completed",
      phone: "+15555550123",
    };

    const first = await followUp.saveNote(actor, input);
    const replay = await followUp.saveNote(actor, input);

    expect(replay).toEqual({ ...first, replayed: true });
    expect(state.callVersion).toBe(4);
    expect([...state.tasks.values()]).toEqual(["RESOLVED", "RESOLVED", "RESOLVED"]);
    expect(events).toEqual([
      "TASK_RESOLVED:task-1",
      "TASK_RESOLVED:task-2",
      "TASK_CREATED:RESOLVED",
      "CALL_DISPOSITION_SAVED:RESOLVED",
    ]);
    expect(state.receipts.size).toBe(1);
  });

  it("rejects a location outside the actor scope before mutating follow-up", async () => {
    const { events, followUp } = followUpHarness();
    await expect(
      followUp.resolveCallerThread(actor, {
        expectedTaskIds: ["task-1", "task-2"],
        idempotencyKey: "resolve-unauthorized",
        locationId: "location-2",
        phone: "+15555550123",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(events).toEqual([]);
  });
});
