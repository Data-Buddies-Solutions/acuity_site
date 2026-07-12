import { describe, expect, it } from "bun:test";

import { PrismaAgentSessionCredentialStore } from "../prisma-agent-session-credential-store";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const input = {
  activationEnabled: true,
  clientInstanceId: "browser-1",
  endpointId: "endpoint-1",
  sessionId: "session-1",
};
const now = new Date("2026-07-12T12:00:00.000Z");

describe("Prisma canonical agent-session credential store", () => {
  it("requires the exact current lease and enabled queue membership", async () => {
    let sessionWhere: unknown;
    let membershipWhere: unknown;
    const store = new PrismaAgentSessionCredentialStore({
      $transaction: async (operation: (transaction: unknown) => Promise<unknown>) =>
        operation({
          callCenterAgentSession: {
            findFirst: async ({ where }: { where: unknown }) => {
              sessionWhere = where;
              return {
                endpoint: {
                  label: "Optical",
                  locationId: "location-1",
                  providerCredentialId: "credential-1",
                },
              };
            },
          },
          callCenterQueueMember: {
            findFirst: async ({ where }: { where: unknown }) => {
              membershipWhere = where;
              return { id: "member-1" };
            },
          },
        }),
    } as never);

    await expect(store.resolve(actor, input, now)).resolves.toEqual({
      endpointLabel: "Optical",
      providerCredentialId: "credential-1",
    });
    expect(sessionWhere).toEqual(
      expect.objectContaining({
        browserSessionId: "browser-1",
        endpointId: "endpoint-1",
        id: "session-1",
        practiceId: "practice-1",
        userId: "user-1",
      }),
    );
    expect(membershipWhere).toEqual(
      expect.objectContaining({ enabled: true, role: "AGENT", userId: "user-1" }),
    );
  });

  it("allows rollback token refresh only for the exact owned canonical call", async () => {
    let sessionWhere: Record<string, unknown> = {};
    const store = new PrismaAgentSessionCredentialStore({
      $transaction: async (operation: (transaction: unknown) => Promise<unknown>) =>
        operation({
          callCenterAgentSession: {
            findFirst: async ({ where }: { where: Record<string, unknown> }) => {
              sessionWhere = where;
              return {
                endpoint: {
                  label: "Optical",
                  locationId: "location-1",
                  providerCredentialId: "credential-1",
                },
              };
            },
          },
          callCenterQueueMember: {
            findFirst: async () => ({ id: "member-1" }),
          },
        }),
    } as never);

    await expect(
      store.resolve(actor, { ...input, activationEnabled: false }, now),
    ).resolves.toEqual({
      endpointLabel: "Optical",
      providerCredentialId: "credential-1",
    });
    expect(sessionWhere).toEqual(
      expect.objectContaining({
        currentCall: {
          is: {
            effectOwner: "CANONICAL",
            status: {
              in: ["RECEIVED", "QUEUED", "RINGING", "CONNECTED", "WRAP_UP"],
            },
          },
        },
      }),
    );
  });

  it("returns no credential when exact lease authorization fails", async () => {
    const store = new PrismaAgentSessionCredentialStore({
      $transaction: async (operation: (transaction: unknown) => Promise<unknown>) =>
        operation({
          callCenterAgentSession: { findFirst: async () => null },
          callCenterQueueMember: {
            findFirst: async () => {
              throw new Error("membership must not be queried");
            },
          },
        }),
    } as never);

    await expect(store.resolve(actor, input, now)).resolves.toBeNull();
  });

  it("rejects an exact lease without an owned call while activation is off", async () => {
    let sessionWhere: Record<string, unknown> = {};
    const store = new PrismaAgentSessionCredentialStore({
      $transaction: async (operation: (transaction: unknown) => Promise<unknown>) =>
        operation({
          callCenterAgentSession: {
            findFirst: async ({ where }: { where: Record<string, unknown> }) => {
              sessionWhere = where;
              return null;
            },
          },
          callCenterQueueMember: {
            findFirst: async () => {
              throw new Error("membership must not be queried");
            },
          },
        }),
    } as never);

    await expect(
      store.resolve(actor, { ...input, activationEnabled: false }, now),
    ).resolves.toBeNull();
    expect(sessionWhere).toHaveProperty("currentCall.is.effectOwner", "CANONICAL");
  });
});
