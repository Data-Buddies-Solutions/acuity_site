import { describe, expect, it } from "bun:test";

import {
  desiredPresenceStatus,
  hasLocalProviderCallLeg,
  readinessForStation,
  reportedPresenceStatus,
  resolveSoftphoneReadiness,
} from "./call-center-readiness";

describe("resolveSoftphoneReadiness", () => {
  it.each([
    {
      missing: "station",
      state: {
        microphoneReady: true,
        providerReady: true,
        soundReady: true,
        stationId: null,
        stationSelected: false,
      },
    },
    {
      missing: "provider",
      state: {
        microphoneReady: true,
        providerReady: false,
        soundReady: true,
        stationId: "seat-1",
        stationSelected: true,
      },
    },
    {
      missing: "microphone",
      state: {
        microphoneReady: false,
        providerReady: true,
        soundReady: true,
        stationId: "seat-1",
        stationSelected: true,
      },
    },
    {
      missing: "sound",
      state: {
        microphoneReady: true,
        providerReady: true,
        soundReady: false,
        stationId: "seat-1",
        stationSelected: true,
      },
    },
  ])("is not ready without $missing readiness", ({ state }) => {
    expect(resolveSoftphoneReadiness(state).ready).toBe(false);
  });

  it("is ready only when the complete browser station is ready", () => {
    expect(
      resolveSoftphoneReadiness({
        microphoneReady: true,
        providerReady: true,
        soundReady: true,
        stationId: "seat-1",
        stationSelected: true,
      }),
    ).toMatchObject({
      message: "Ready to receive calls.",
      ready: true,
    });
  });
});

describe("readinessForStation", () => {
  it("invalidates provider readiness when the selected station changes", () => {
    const readyStation = resolveSoftphoneReadiness({
      microphoneReady: true,
      providerReady: true,
      soundReady: true,
      stationId: "seat-1",
      stationSelected: true,
    });

    expect(readinessForStation(readyStation, "seat-2", true)).toMatchObject({
      microphoneReady: true,
      providerReady: false,
      ready: false,
      soundReady: true,
      stationId: "seat-2",
    });
  });
});

describe("desiredPresenceStatus", () => {
  it("keeps an unready softphone offline", () => {
    expect(
      desiredPresenceStatus({
        busy: false,
        requestedStatus: "AVAILABLE",
        softphoneReady: false,
      }),
    ).toBe("OFFLINE");
  });

  it("reports the requested status when ready and not busy", () => {
    expect(
      desiredPresenceStatus({
        busy: false,
        requestedStatus: "AVAILABLE",
        softphoneReady: true,
      }),
    ).toBe("AVAILABLE");
  });

  it("reports busy while a ready softphone has an active call", () => {
    expect(
      desiredPresenceStatus({
        busy: true,
        requestedStatus: "AVAILABLE",
        softphoneReady: true,
      }),
    ).toBe("BUSY");
  });
});

describe("reportedPresenceStatus", () => {
  it("stays offline until the desired presence is acknowledged", () => {
    expect(
      reportedPresenceStatus({
        acknowledgedStatus: null,
        desiredStatus: "AVAILABLE",
      }),
    ).toBe("OFFLINE");
    expect(
      reportedPresenceStatus({
        acknowledgedStatus: "BUSY",
        desiredStatus: "AVAILABLE",
      }),
    ).toBe("OFFLINE");
  });

  it("reports only the acknowledged desired presence", () => {
    expect(
      reportedPresenceStatus({
        acknowledgedStatus: "AVAILABLE",
        desiredStatus: "AVAILABLE",
      }),
    ).toBe("AVAILABLE");
  });
});

describe("hasLocalProviderCallLeg", () => {
  it("is busy for this browser's ringing, active, queued, or held provider legs", () => {
    expect(
      hasLocalProviderCallLeg({
        active: false,
        heldCount: 0,
        incoming: true,
        queuedCount: 0,
      }),
    ).toBe(true);
    expect(
      hasLocalProviderCallLeg({
        active: false,
        heldCount: 0,
        incoming: false,
        queuedCount: 1,
      }),
    ).toBe(true);
    expect(
      hasLocalProviderCallLeg({
        active: false,
        heldCount: 0,
        incoming: false,
        queuedCount: 0,
      }),
    ).toBe(false);
  });
});
