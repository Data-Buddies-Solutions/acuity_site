import { describe, expect, it } from "bun:test";

import {
  blocksOutboundStart,
  canonicalOutboundClientState,
  isOutboundScopeAllowed,
  PrismaStartOutboundCallStore,
} from "../prisma-start-outbound-call-store";

describe("canonical outbound scope", () => {
  it("returns stable correlation-only client state", () => {
    const input = {
      practiceId: "practice-1",
      token: "token-1",
    };
    const first = canonicalOutboundClientState(input);
    const second = canonicalOutboundClientState(input);
    const decoded = JSON.parse(Buffer.from(first, "base64").toString("utf8"));

    expect(second).toBe(first);
    expect(decoded).toEqual({
      canonicalOutboundToken: "token-1",
      practiceId: "practice-1",
      version: 1,
    });
    expect(JSON.stringify(decoded)).not.toContain("credential");
    expect(JSON.stringify(decoded)).not.toContain("phone");
    expect(JSON.stringify(decoded)).not.toContain("call-1");
    expect(JSON.stringify(decoded)).not.toContain("leg-1");
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
