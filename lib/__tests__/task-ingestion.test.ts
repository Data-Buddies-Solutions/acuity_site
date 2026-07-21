import { afterEach, describe, expect, it, mock } from "bun:test";

const prismaMock = {
  agentCall: {
    findFirst: mock(),
    findUnique: mock(),
  },
  agentTask: {
    create: mock(),
    findUnique: mock(),
  },
  practiceLocation: {
    findFirst: mock(),
    findMany: mock(),
  },
  practicePhoneNumber: {
    findFirst: mock(),
  },
};

mock.module("@/lib/prisma", () => ({ prisma: prismaMock }));

const { ingestLiveKitTaskPayload, TaskIngestionError } =
  await import("@/lib/task-ingestion");

function resetPrismaMock() {
  for (const model of Object.values(prismaMock)) {
    for (const fn of Object.values(model)) {
      fn.mockReset();
    }
  }
}

function taskPayload(overrides: Record<string, unknown> = {}) {
  return {
    callId: "call-1",
    callerPhone: "+17275551212",
    category: "billing",
    idempotencyKey: "staff_task_1",
    message: "Caller wants billing to review a recent bill.",
    officeKey: "spring-hill",
    officePhone: "+17275919997",
    patient: {
      dob: "01/01/1980",
      id: "patient-1",
      name: "Jane Doe",
    },
    source: "agent",
    summary: "Caller has a billing question.",
    urgency: "high_priority",
    ...overrides,
  };
}

describe("task ingestion", () => {
  afterEach(() => {
    resetPrismaMock();
  });

  it("creates an agent task resolved from office phone mapping", async () => {
    prismaMock.agentTask.findUnique.mockResolvedValue(null);
    prismaMock.practicePhoneNumber.findFirst.mockResolvedValue({
      locationId: "spring-location",
      practiceId: "practice-1",
    });
    prismaMock.agentCall.findFirst.mockResolvedValue({ id: "agent-call-1" });
    prismaMock.agentTask.create.mockResolvedValue({
      category: "BILLING",
      id: "task-1",
      priority: "HIGH_PRIORITY",
    });

    const result = await ingestLiveKitTaskPayload(taskPayload());

    expect(result).toEqual({
      category: "billing",
      status: "created",
      taskId: "task-1",
      urgency: "high_priority",
    });
    expect(prismaMock.agentTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentCallId: "agent-call-1",
        callId: "call-1",
        callerPhone: "+17275551212",
        category: "BILLING",
        idempotencyKey: "staff_task_1",
        locationId: "spring-location",
        officeKey: "spring-hill",
        officePhone: "+17275919997",
        patientDob: "01/01/1980",
        patientId: "patient-1",
        patientName: "Jane Doe",
        practiceId: "practice-1",
        priority: "HIGH_PRIORITY",
        source: "AGENT",
        summary: "Caller has a billing question.",
      }),
      select: {
        category: true,
        id: true,
        priority: true,
      },
    });
  });

  it("creates tasks in the optical, medication, and referrals buckets", async () => {
    const categories = [
      ["optical", "OPTICAL"],
      ["medication", "MEDICATION"],
      ["referrals", "REFERRALS"],
    ] as const;

    for (const [category, databaseCategory] of categories) {
      resetPrismaMock();
      prismaMock.agentTask.findUnique.mockResolvedValue(null);
      prismaMock.practicePhoneNumber.findFirst.mockResolvedValue({
        locationId: "spring-location",
        practiceId: "practice-1",
      });
      prismaMock.agentCall.findFirst.mockResolvedValue({ id: "agent-call-1" });
      prismaMock.agentTask.create.mockResolvedValue({
        category: databaseCategory,
        id: `task-${category}`,
        priority: "NORMAL",
      });

      const result = await ingestLiveKitTaskPayload(
        taskPayload({ category, urgency: "normal" }),
      );

      expect(result).toEqual({
        category,
        status: "created",
        taskId: `task-${category}`,
        urgency: "normal",
      });
      expect(prismaMock.agentTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ category: databaseCategory }),
        }),
      );
    }
  });

  it("returns a duplicate task within the resolved practice", async () => {
    prismaMock.agentTask.findUnique.mockResolvedValue({
      category: "DOCUMENTATION",
      id: "task-1",
      priority: "NORMAL",
    });
    prismaMock.practicePhoneNumber.findFirst.mockResolvedValue({
      locationId: "spring-location",
      practiceId: "practice-1",
    });

    const result = await ingestLiveKitTaskPayload(
      taskPayload({
        category: "documentation",
        urgency: "normal",
      }),
    );

    expect(result).toEqual({
      category: "documentation",
      status: "duplicate",
      taskId: "task-1",
      urgency: "normal",
    });
    expect(prismaMock.agentTask.findUnique).toHaveBeenCalledWith({
      select: {
        category: true,
        id: true,
        priority: true,
      },
      where: {
        practiceId_idempotencyKey: {
          idempotencyKey: "staff_task_1",
          practiceId: "practice-1",
        },
      },
    });
    expect(prismaMock.agentTask.create).not.toHaveBeenCalled();
  });

  it("allows the same idempotency key in different practices", async () => {
    prismaMock.agentTask.findUnique.mockResolvedValue(null);
    prismaMock.practicePhoneNumber.findFirst.mockResolvedValue({
      locationId: "crystal-location",
      practiceId: "practice-2",
    });
    prismaMock.agentCall.findFirst.mockResolvedValue(null);
    prismaMock.agentTask.create.mockResolvedValue({
      category: "BILLING",
      id: "task-2",
      priority: "NORMAL",
    });

    const result = await ingestLiveKitTaskPayload(
      taskPayload({
        officePhone: "+13525550123",
        urgency: "normal",
      }),
    );

    expect(result).toEqual({
      category: "billing",
      status: "created",
      taskId: "task-2",
      urgency: "normal",
    });
    expect(prismaMock.agentTask.findUnique).toHaveBeenCalledWith({
      select: {
        category: true,
        id: true,
        priority: true,
      },
      where: {
        practiceId_idempotencyKey: {
          idempotencyKey: "staff_task_1",
          practiceId: "practice-2",
        },
      },
    });
    expect(prismaMock.agentTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: "staff_task_1",
          practiceId: "practice-2",
        }),
      }),
    );
  });

  it("rejects tasks that cannot resolve a single location", async () => {
    prismaMock.agentTask.findUnique.mockResolvedValue(null);
    prismaMock.practicePhoneNumber.findFirst.mockResolvedValue({
      locationId: null,
      practiceId: "practice-1",
    });
    prismaMock.practiceLocation.findMany.mockResolvedValue([
      { id: "spring-location" },
      { id: "crystal-location" },
    ]);

    await expect(ingestLiveKitTaskPayload(taskPayload())).rejects.toThrow(
      TaskIngestionError,
    );
    expect(prismaMock.agentTask.create).not.toHaveBeenCalled();
  });

  it("rejects explicit routing IDs that disagree with the office phone mapping", async () => {
    prismaMock.agentTask.findUnique.mockResolvedValue(null);
    prismaMock.practicePhoneNumber.findFirst.mockResolvedValue({
      locationId: "spring-location",
      practiceId: "practice-1",
    });

    await expect(
      ingestLiveKitTaskPayload(
        taskPayload({
          locationId: "crystal-location",
          practiceId: "practice-1",
        }),
      ),
    ).rejects.toThrow(TaskIngestionError);
    expect(prismaMock.agentTask.create).not.toHaveBeenCalled();
  });

  it("does not route from an existing call when the office phone is unknown", async () => {
    prismaMock.agentTask.findUnique.mockResolvedValue(null);
    prismaMock.practicePhoneNumber.findFirst.mockResolvedValue(null);
    prismaMock.agentCall.findUnique.mockResolvedValue({
      locationId: "spring-location",
      practiceId: "practice-1",
    });

    await expect(ingestLiveKitTaskPayload(taskPayload())).rejects.toThrow(
      TaskIngestionError,
    );
    expect(prismaMock.agentCall.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.agentTask.create).not.toHaveBeenCalled();
  });

  it("returns duplicate when a concurrent create wins the idempotency race", async () => {
    prismaMock.agentTask.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      category: "BILLING",
      id: "task-1",
      priority: "NORMAL",
    });
    prismaMock.practicePhoneNumber.findFirst.mockResolvedValue({
      locationId: "spring-location",
      practiceId: "practice-1",
    });
    prismaMock.agentCall.findFirst.mockResolvedValue(null);
    prismaMock.agentTask.create.mockRejectedValue({ code: "P2002" });

    const result = await ingestLiveKitTaskPayload(
      taskPayload({
        urgency: "normal",
      }),
    );

    expect(result).toEqual({
      category: "billing",
      status: "duplicate",
      taskId: "task-1",
      urgency: "normal",
    });
  });

  it("rejects task summaries longer than the agent contract", async () => {
    await expect(
      ingestLiveKitTaskPayload(
        taskPayload({
          summary: "x".repeat(241),
        }),
      ),
    ).rejects.toThrow(TaskIngestionError);
    expect(prismaMock.agentTask.create).not.toHaveBeenCalled();
  });

  it("rejects task messages longer than the agent contract", async () => {
    await expect(
      ingestLiveKitTaskPayload(
        taskPayload({
          message: "x".repeat(2501),
        }),
      ),
    ).rejects.toThrow(TaskIngestionError);
    expect(prismaMock.agentTask.create).not.toHaveBeenCalled();
  });

  it("rejects unbounded idempotency keys", async () => {
    await expect(
      ingestLiveKitTaskPayload(
        taskPayload({
          idempotencyKey: "x".repeat(161),
        }),
      ),
    ).rejects.toThrow(TaskIngestionError);
    expect(prismaMock.agentTask.create).not.toHaveBeenCalled();
  });
});
