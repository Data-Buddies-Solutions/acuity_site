import { describe, expect, it } from "bun:test";

import {
  blocksOutboundStart,
  isOutboundScopeAllowed,
  PrismaStartOutboundCallStore,
} from "../prisma-start-outbound-call-store";

describe("canonical outbound scope", () => {
  it("locks the practice before reading or mutating outbound state", async () => {
    const operations: string[] = [];
    const transaction = {
      $queryRaw: async (query: { values?: unknown[] }) => {
        if (query.values?.includes("CALL_CENTER:practice-1")) {
          operations.push("practice.lock");
        }
        return [];
      },
      callCenterEvent: {
        findUnique: async () => {
          operations.push("receipt.read");
          return {
            actorUserId: "user-1",
            aggregateId: "call-1",
            aggregateType: "CALL",
            data: {},
            occurredAt: new Date("2026-07-19T12:00:00.000Z"),
            revision: BigInt(1),
          };
        },
      },
    };
    const store = new PrismaStartOutboundCallStore((operation) =>
      operation(transaction as never),
    );

    await store.prepareOutboundCleanup(
      {
        allowedLocationIds: ["location-1"],
        hasAllLocationAccess: false,
        practiceId: "practice-1",
        userId: "user-1",
      },
      {
        clientInstanceId: "browser-1",
        destination: "+15555550123",
        idempotencyKey: "operation-1",
        numberId: "number-1",
        queueId: "queue-1",
      },
      new Date("2026-07-19T12:00:00.000Z"),
    );

    expect(operations).toEqual(["practice.lock", "receipt.read"]);
  });

  it("requires both endpoint and number inside a location-scoped queue", () => {
    const base = {
      actorAllowedLocationIds: ["location-1", "location-2"],
      actorHasAllLocationAccess: false,
      endpointLocationId: "location-1",
      numberLocationId: "location-2",
      queueLocationIds: ["location-1", "location-2"],
    };
    expect(isOutboundScopeAllowed(base)).toBe(true);
    expect(isOutboundScopeAllowed({ ...base, numberLocationId: "location-3" })).toBe(
      false,
    );
    expect(isOutboundScopeAllowed({ ...base, endpointLocationId: null })).toBe(false);
  });

  it("supports a practice-wide queue for a practice-wide actor", () => {
    expect(
      isOutboundScopeAllowed({
        actorAllowedLocationIds: [],
        actorHasAllLocationAccess: true,
        endpointLocationId: null,
        numberLocationId: null,
        queueLocationIds: [],
      }),
    ).toBe(true);
  });

  it("fails closed for locationless resources under restricted access", () => {
    const base = {
      actorAllowedLocationIds: ["location-1"],
      actorHasAllLocationAccess: false,
      endpointLocationId: "location-1",
      numberLocationId: "location-1",
      queueLocationIds: [],
    };
    expect(isOutboundScopeAllowed(base)).toBe(true);
    expect(isOutboundScopeAllowed({ ...base, numberLocationId: null })).toBe(false);
    expect(isOutboundScopeAllowed({ ...base, endpointLocationId: null })).toBe(false);
  });

  it("blocks active calls and pending outbound starts without blocking inbound offers", () => {
    expect(blocksOutboundStart({ direction: "INBOUND", status: "ANSWERED" })).toBe(true);
    expect(blocksOutboundStart({ direction: "OUTBOUND", status: "CREATED" })).toBe(true);
    expect(blocksOutboundStart({ direction: "OUTBOUND", status: "RINGING" })).toBe(true);
    expect(blocksOutboundStart({ direction: "INBOUND", status: "RINGING" })).toBe(false);
    expect(blocksOutboundStart({ direction: "OUTBOUND", status: "ENDED" })).toBe(false);
  });
});
