import { describe, expect, it } from "bun:test";

import {
  callCenterConfigurationWireSchema,
  formatConfigurationEtag,
  parseConfigurationEtag,
  redactCallCenterConfiguration,
  resolveCallCenterConfigurationWireInput,
  safeZodIssues,
} from "@/lib/call-center/application/configuration-wire";
import type { ValidatedCallCenterConfiguration } from "@/lib/call-center/application/configuration";

function validWireInput() {
  return {
    defaultOutboundNumberId: null,
    queues: [
      {
        id: " queue-1 ",
        name: " Optical ",
        enabled: false,
        routingMode: "LEGACY",
        ringTimeoutSec: 20,
        maxWaitSec: 30,
        wrapUpSec: 0,
        voicemailEnabled: true,
        voicemailGreeting: " Leave a message. ",
        overflowQueueId: null,
        locationIds: [],
        members: [],
      },
    ],
    numbers: [],
    endpoints: [],
  };
}

describe("call-center configuration wire schema", () => {
  it("accepts and trims the explicit admin configuration contract", () => {
    const parsed = callCenterConfigurationWireSchema.parse(validWireInput());
    expect(parsed.queues[0]).toMatchObject({
      id: "queue-1",
      name: "Optical",
      voicemailGreeting: "Leave a message.",
    });
  });

  it("rejects unknown secret-bearing or out-of-contract fields", () => {
    const parsed = callCenterConfigurationWireSchema.safeParse({
      ...validWireInput(),
      telnyxApiKey: "must-not-be-accepted",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(safeZodIssues(parsed.error)).toEqual([
        expect.objectContaining({ code: "INVALID_REQUEST", path: "" }),
      ]);
    }
  });

  it("caps the total snapshot work inside the route transaction budget", () => {
    const baseQueue = validWireInput().queues[0];
    const members = Array.from({ length: 501 }, (_, index) => ({
      enabled: true,
      role: "AGENT" as const,
      userId: `user-${index}`,
    }));
    const parsed = callCenterConfigurationWireSchema.safeParse({
      ...validWireInput(),
      queues: [
        { ...baseQueue, id: "queue-1", members: members.slice(0, 250) },
        { ...baseQueue, id: "queue-2", members: members.slice(250) },
      ],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(safeZodIssues(parsed.error)).toContainEqual(
        expect.objectContaining({ path: "queues" }),
      );
    }
  });

  it("accepts only strong canonical configuration ETags", () => {
    const version = "a".repeat(64);
    expect(formatConfigurationEtag(version)).toBe(`"${version}"`);
    expect(parseConfigurationEtag(`"${version}"`)).toBe(version);
    expect(parseConfigurationEtag(version)).toBeNull();
    expect(parseConfigurationEtag(`W/"${version}"`)).toBeNull();
    expect(parseConfigurationEtag("*")).toBeNull();
  });

  it("redacts endpoint identities and preserves omitted values on PUT", () => {
    const current: ValidatedCallCenterConfiguration = {
      practiceId: "practice-1",
      defaultOutboundNumberId: null,
      queues: [],
      numbers: [],
      endpoints: [
        {
          id: "endpoint-1",
          userId: "user-1",
          locationId: null,
          label: "Front desk",
          providerCredentialId: "credential-secret-id",
          sipUsername: "sip-secret-username",
          enabled: false,
        },
      ],
    };
    const wire = callCenterConfigurationWireSchema.parse({
      defaultOutboundNumberId: null,
      queues: [],
      numbers: [],
      endpoints: [
        {
          id: "endpoint-1",
          locationId: null,
          label: "Renamed front desk",
          enabled: false,
        },
      ],
    });

    const resolved = resolveCallCenterConfigurationWireInput("practice-1", wire, current);
    expect(resolved.endpoints[0]).toMatchObject({
      providerCredentialId: "credential-secret-id",
      sipUsername: "sip-secret-username",
    });
    const cleared = resolveCallCenterConfigurationWireInput(
      "practice-1",
      callCenterConfigurationWireSchema.parse({
        ...wire,
        endpoints: [
          {
            ...wire.endpoints[0],
            providerCredentialId: null,
            sipUsername: null,
          },
        ],
      }),
      current,
    );
    expect(cleared.endpoints[0]).toMatchObject({
      providerCredentialId: null,
      sipUsername: null,
    });

    const redacted = redactCallCenterConfiguration(current);
    expect(redacted.endpoints[0]).toMatchObject({
      providerCredentialConfigured: true,
      sipUsernameConfigured: true,
    });
    expect("providerCredentialId" in redacted.endpoints[0]!).toBe(false);
    expect("sipUsername" in redacted.endpoints[0]!).toBe(false);
    expect(callCenterConfigurationWireSchema.safeParse(redacted).success).toBe(true);
  });
});
