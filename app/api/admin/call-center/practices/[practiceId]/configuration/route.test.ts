import { describe, expect, it } from "bun:test";

import { CallCenterConfigurationError } from "@/lib/call-center/application/configuration";
import type { VersionedCallCenterConfiguration } from "@/lib/call-center/infrastructure/prisma-configuration-repository";

import { createConfigurationHandlers } from "./handler";

const version = "a".repeat(64);
const nextVersion = "b".repeat(64);
const context = { params: Promise.resolve({ practiceId: "practice-1" }) };

function storedConfiguration(currentVersion = version): VersionedCallCenterConfiguration {
  return {
    version: currentVersion,
    configuration: {
      practiceId: "practice-1",
      defaultOutboundNumberId: null,
      queues: [],
      numbers: [],
      endpoints: [
        {
          id: "legacy-seat-1",
          userId: null,
          locationId: null,
          label: "Front desk",
          providerCredentialId: "secret-credential",
          sipUsername: "secret-sip-user",
          enabled: false,
        },
      ],
    },
  };
}

function savedConfiguration(currentVersion = nextVersion) {
  return { ...storedConfiguration(currentVersion), changed: true };
}

function adminDependencies() {
  return {
    getSession: async () => ({
      user: { id: "admin-1", email: "admin@example.com" },
    }),
    isAdmin: () => true,
    readMigrationReport: async () => ({
      overallReadiness: "READY_FOR_MANUAL_REVIEW" as const,
    }),
  };
}

describe("admin call-center configuration route", () => {
  it("requires an administrator before reading configuration", async () => {
    let reads = 0;
    const { GET } = createConfigurationHandlers({
      getSession: async () => null,
      isAdmin: () => false,
      readConfiguration: async () => {
        reads += 1;
        return null;
      },
    });

    expect((await GET(new Request("https://example.test"), context)).status).toBe(401);
    expect(reads).toBe(0);
  });

  it("returns a strong ETag without exposing endpoint credentials", async () => {
    const { GET } = createConfigurationHandlers({
      ...adminDependencies(),
      readConfiguration: async () => storedConfiguration(),
    });

    const response = await GET(new Request("https://example.test"), context);
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"${version}"`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(serialized).not.toContain("secret-credential");
    expect(serialized).not.toContain("secret-sip-user");
    expect(serialized).toContain('"providerCredentialConfigured":true');
  });

  it("requires If-Match before parsing or writing a snapshot", async () => {
    let writes = 0;
    const { PUT } = createConfigurationHandlers({
      ...adminDependencies(),
      readConfiguration: async () => storedConfiguration(),
      saveConfiguration: async () => {
        writes += 1;
        return savedConfiguration();
      },
    });

    const response = await PUT(
      new Request("https://example.test", { method: "PUT", body: "{}" }),
      context,
    );

    expect(response.status).toBe(428);
    expect(writes).toBe(0);
  });

  it("maps transaction-time ETag conflicts to precondition failed", async () => {
    const { PUT } = createConfigurationHandlers({
      ...adminDependencies(),
      readConfiguration: async () => storedConfiguration(),
      saveConfiguration: async () => {
        throw new CallCenterConfigurationError([
          {
            code: "STALE_CONFIGURATION",
            path: "",
            message: "Configuration changed after it was loaded",
          },
        ]);
      },
    });
    const response = await PUT(
      new Request("https://example.test", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": `"${version}"` },
        body: JSON.stringify({
          defaultOutboundNumberId: null,
          queues: [],
          numbers: [],
          endpoints: [],
        }),
      }),
      context,
    );

    expect(response.status).toBe(412);
  });

  it("blocks the first write until discovery is ready for manual review", async () => {
    let writes = 0;
    const { PUT } = createConfigurationHandlers({
      ...adminDependencies(),
      readConfiguration: async () => ({
        version,
        configuration: {
          practiceId: "practice-1",
          defaultOutboundNumberId: null,
          queues: [],
          numbers: [],
          endpoints: [],
        },
      }),
      readMigrationReport: async () => ({ overallReadiness: "BLOCKED" }),
      saveConfiguration: async () => {
        writes += 1;
        return savedConfiguration();
      },
    });
    const response = await PUT(
      new Request("https://example.test", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": `"${version}"` },
        body: JSON.stringify({
          defaultOutboundNumberId: null,
          queues: [],
          numbers: [],
          endpoints: [],
        }),
      }),
      context,
    );

    expect(response.status).toBe(422);
    expect(writes).toBe(0);
    expect(await response.json()).toMatchObject({
      issues: [{ code: "MIGRATION_REPORT_BLOCKED" }],
    });
  });

  it("returns the committed redacted snapshot and new ETag", async () => {
    let reads = 0;
    let savedActor = "";
    const { PUT } = createConfigurationHandlers({
      ...adminDependencies(),
      readConfiguration: async () => {
        reads += 1;
        return reads === 1 ? storedConfiguration() : storedConfiguration("c".repeat(64));
      },
      saveConfiguration: async (_input, _expectedVersion, actorUserId) => {
        savedActor = actorUserId;
        const saved = savedConfiguration();
        saved.configuration.endpoints[0]!.label = "Committed front desk";
        return saved;
      },
    });
    const response = await PUT(
      new Request("https://example.test", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": `"${version}"` },
        body: JSON.stringify({
          defaultOutboundNumberId: null,
          queues: [],
          numbers: [],
          endpoints: [],
        }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"${nextVersion}"`);
    expect(savedActor).toBe("admin-1");
    expect(reads).toBe(1);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain("Committed front desk");
    expect(serialized).not.toContain("secret-credential");
  });
});
