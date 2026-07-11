import { describe, expect, it } from "bun:test";

import {
  InvalidDurableWebhookIngressConfigError,
  resolveDurableWebhookIngressConfig,
} from "../durable-ingress-config";

describe("durable webhook ingress configuration", () => {
  it("is disabled by default without activating payload persistence", () => {
    expect(resolveDurableWebhookIngressConfig({})).toEqual({
      enabled: false,
      payloadRetentionDays: null,
    });
    expect(
      resolveDurableWebhookIngressConfig({
        CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED: "false",
      }),
    ).toEqual({ enabled: false, payloadRetentionDays: null });
  });

  it("requires explicit retention approval when enabled", () => {
    expect(() =>
      resolveDurableWebhookIngressConfig({
        CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED: "true",
        CALL_CENTER_WEBHOOK_RETENTION_DAYS: "7",
      }),
    ).toThrow(InvalidDurableWebhookIngressConfigError);
  });

  it.each(["", "0", "1.5", "31", "forever"])(
    "rejects invalid retention days: %s",
    (retentionDays) => {
      expect(() =>
        resolveDurableWebhookIngressConfig({
          CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED: "true",
          CALL_CENTER_WEBHOOK_PAYLOAD_RETENTION_APPROVED: "true",
          CALL_CENTER_WEBHOOK_RETENTION_DAYS: retentionDays,
        }),
      ).toThrow(InvalidDurableWebhookIngressConfigError);
    },
  );

  it("enables only an explicitly approved bounded retention window", () => {
    expect(
      resolveDurableWebhookIngressConfig({
        CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED: "true",
        CALL_CENTER_WEBHOOK_PAYLOAD_RETENTION_APPROVED: "true",
        CALL_CENTER_WEBHOOK_RETENTION_DAYS: "7",
      }),
    ).toEqual({ enabled: true, payloadRetentionDays: 7 });
  });

  it("keeps an approved retention window active while ingress is disabled", () => {
    expect(
      resolveDurableWebhookIngressConfig({
        CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED: "false",
        CALL_CENTER_WEBHOOK_PAYLOAD_RETENTION_APPROVED: "true",
        CALL_CENTER_WEBHOOK_RETENTION_DAYS: "7",
      }),
    ).toEqual({ enabled: false, payloadRetentionDays: 7 });
  });
});
