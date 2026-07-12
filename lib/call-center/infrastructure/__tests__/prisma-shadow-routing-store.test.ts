import { describe, expect, it } from "bun:test";

import { recordShadowRoutingDecision } from "@/lib/call-center/application/shadow-routing";
import {
  PrismaShadowRoutingStore,
  type ShadowRoutingPrismaClient,
  type ShadowRoutingPrismaTransaction,
  type ShadowRoutingTransactionRunner,
} from "../prisma-shadow-routing-store";

describe("Prisma shadow routing store", () => {
  it("selects only bounded active SHADOW calls missing a decision", async () => {
    const queryTexts: string[] = [];
    const client = {
      $queryRaw: async (query: { sql: string }) => {
        queryTexts.push(query.sql);
        if (query.sql.includes("COUNT(*)")) return [{ count: BigInt(1) }];
        return [{ callId: "call-1", practiceId: "practice-1" }];
      },
    } as unknown as ShadowRoutingPrismaClient;
    const store = new PrismaShadowRoutingStore(undefined, client);

    await expect(store.listMissingDecisions(5)).resolves.toEqual([
      { callId: "call-1", practiceId: "practice-1" },
    ]);
    await expect(store.countMissingDecisions()).resolves.toBe(1);
    const queryText = queryTexts.join("\n");
    expect(queryText).toContain("queue.\"routingMode\" = CAST('SHADOW'");
    expect(queryText).toContain("NOT EXISTS");
    expect(queryText).toContain('event."idempotencyKey" = call."id"');
    expect(queryText).not.toContain("COMPLETED");
    expect(queryText).not.toContain("VOICEMAIL");
    expect(queryTexts).toHaveLength(2);
  });

  it("locks the call and writes only one sanitized event", async () => {
    const operations: string[] = [];
    let event: { data: unknown; occurredAt: Date; revision: bigint } | null = null;
    const transaction = {
      $queryRaw: async () => {
        operations.push("call.lock");
        return [{ id: "call-1" }];
      },
      callCenterAgentSession: {
        findMany: async () => {
          operations.push("session.findMany");
          return [
            {
              audioReady: true,
              connectionState: "READY",
              currentCallId: null,
              endpoint: {
                enabled: true,
                id: "endpoint-1",
                locationId: "location-1",
                providerCredentialId: "secret-credential",
                sipUsername: "secret-sip-user",
              },
              id: "session-1",
              leaseExpiresAt: new Date("2026-07-12T12:01:00.000Z"),
              microphoneReady: true,
              presence: "AVAILABLE",
              userId: "user-1",
            },
          ];
        },
      },
      callCenterCall: {
        findFirst: async (query: {
          select: { queue: { select: { members: { where: unknown } } } };
        }) => {
          operations.push("call.findFirst");
          expect(query.select.queue.select.members.where).toEqual({ role: "AGENT" });
          return {
            direction: "INBOUND",
            id: "call-1",
            practiceId: "practice-1",
            queue: {
              enabled: true,
              id: "queue-1",
              locations: [{ locationId: "location-1" }],
              members: [{ enabled: true, userId: "user-1" }],
              routingMode: "SHADOW",
            },
            status: "RECEIVED",
          };
        },
      },
      callCenterCommand: {
        create: async () => {
          throw new Error("shadow routing must never create commands");
        },
      },
      callCenterEvent: {
        create: async ({ data }: { data: { data: unknown; occurredAt: Date } }) => {
          operations.push("event.create");
          event = {
            data: data.data,
            occurredAt: data.occurredAt,
            revision: BigInt(1),
          };
          return event;
        },
        findUnique: async () => {
          operations.push("event.findUnique");
          return event;
        },
      },
    } as unknown as ShadowRoutingPrismaTransaction;
    const runner: ShadowRoutingTransactionRunner = (operation) => operation(transaction);
    const store = new PrismaShadowRoutingStore(runner);

    const receipt = await recordShadowRoutingDecision(
      store,
      { callId: "call-1", practiceId: "practice-1" },
      new Date("2026-07-12T12:00:00.000Z"),
    );

    expect(receipt).toMatchObject({
      eligible: [
        { agentSessionId: "session-1", endpointId: "endpoint-1", userId: "user-1" },
      ],
      replayed: false,
    });
    expect(operations).toEqual([
      "call.lock",
      "call.findFirst",
      "session.findMany",
      "event.findUnique",
      "event.create",
    ]);
    const eventData = (event as { data: unknown } | null)?.data;
    expect(JSON.stringify(eventData)).not.toContain("secret-credential");
    expect(JSON.stringify(eventData)).not.toContain("secret-sip-user");
  });
});
