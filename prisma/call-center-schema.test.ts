import { describe, expect, it } from "bun:test";

import { Prisma } from "@/generated/prisma/client";

type ExpectNever<Value extends never> = Value;
type RetiredQueueRelations = ExpectNever<
  Extract<keyof Prisma.CallCenterQueueSelect, "overflowQueue" | "overflowedBy">
>;
type RetiredSessionRelations = ExpectNever<
  Extract<keyof Prisma.CallCenterAgentSessionSelect, "offeredCall" | "currentCall">
>;
type RetiredCallRelations = ExpectNever<
  Extract<
    keyof Prisma.CallCenterCallSelect,
    "offeredAgentSessions" | "activeAgentSessions"
  >
>;

void (0 as unknown as RetiredQueueRelations);
void (0 as unknown as RetiredSessionRelations);
void (0 as unknown as RetiredCallRelations);

describe("canonical call-center schema", () => {
  it("exposes one queue policy, call-leg occupancy, and one call deadline", () => {
    const queueFields = Object.values(Prisma.CallCenterQueueScalarFieldEnum);
    const sessionFields = Object.values(Prisma.CallCenterAgentSessionScalarFieldEnum);
    const callFields = Object.values(Prisma.CallCenterCallScalarFieldEnum);

    for (const retired of [
      "ringTimeoutSec",
      "maxWaitSec",
      "wrapUpSec",
      "overflowQueueId",
    ]) {
      expect(queueFields).not.toContain(retired);
    }
    for (const retired of ["offeredCallId", "currentCallId"]) {
      expect(sessionFields).not.toContain(retired);
    }
    expect(callFields).not.toContain("queueDeadlineAt");
    expect(callFields).toContain("deadlineAt");
    expect(callFields).toContain("effectOwner");
  });
});
