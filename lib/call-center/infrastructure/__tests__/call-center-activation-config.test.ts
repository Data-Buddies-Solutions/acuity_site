import { describe, expect, it } from "bun:test";

import {
  InvalidCallCenterActivationConfigError,
  resolveCallCenterActivationConfig,
  resolvePortalCallCenterActivationConfig,
} from "../call-center-activation-config";

describe("call center activation config", () => {
  it("defaults the global activation boundary off", () => {
    expect(resolveCallCenterActivationConfig({})).toEqual({ enabled: false });
  });

  it("accepts only exact global boolean values", () => {
    expect(
      resolveCallCenterActivationConfig({
        CALL_CENTER_CANONICAL_ACTIVATION_ENABLED: "true",
        CALL_CENTER_CANONICAL_PROJECTION_ENABLED: "true",
        CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED: "true",
        CALL_CENTER_WEBHOOK_PAYLOAD_RETENTION_APPROVED: "true",
        CALL_CENTER_WEBHOOK_RETENTION_DAYS: "7",
      }),
    ).toEqual({ enabled: true });
    expect(
      resolveCallCenterActivationConfig({
        CALL_CENTER_CANONICAL_ACTIVATION_ENABLED: "false",
      }),
    ).toEqual({ enabled: false });
  });

  it("rejects activation unless durable ingress, retention, and projection are ready", () => {
    for (const environment of [
      { CALL_CENTER_CANONICAL_ACTIVATION_ENABLED: "true" },
      {
        CALL_CENTER_CANONICAL_ACTIVATION_ENABLED: "true",
        CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED: "true",
      },
      {
        CALL_CENTER_CANONICAL_ACTIVATION_ENABLED: "true",
        CALL_CENTER_CANONICAL_PROJECTION_ENABLED: "true",
        CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED: "true",
        CALL_CENTER_WEBHOOK_PAYLOAD_RETENTION_APPROVED: "false",
        CALL_CENTER_WEBHOOK_RETENTION_DAYS: "7",
      },
    ]) {
      expect(() => resolveCallCenterActivationConfig(environment)).toThrow(
        InvalidCallCenterActivationConfigError,
      );
    }
  });

  it.each(["", "TRUE", " true", "yes", "1"])(
    "fails closed without reflecting an invalid value: %s",
    (value) => {
      try {
        resolveCallCenterActivationConfig({
          CALL_CENTER_CANONICAL_ACTIVATION_ENABLED: value,
        });
        throw new Error("Expected activation config to fail");
      } catch (error) {
        expect(error).toMatchObject({
          code: "INVALID_CALL_CENTER_ACTIVATION_CONFIG",
          message: "Call center activation configuration is invalid",
          status: 503,
        });
      }
    },
  );

  it("falls the portal back to legacy when activation configuration is invalid", () => {
    expect(
      resolvePortalCallCenterActivationConfig({
        CALL_CENTER_CANONICAL_ACTIVATION_ENABLED: "true",
      }),
    ).toEqual({ enabled: false, valid: false });
    expect(
      resolvePortalCallCenterActivationConfig({
        CALL_CENTER_CANONICAL_ACTIVATION_ENABLED: "false",
      }),
    ).toEqual({ enabled: false, valid: true });
  });
});
