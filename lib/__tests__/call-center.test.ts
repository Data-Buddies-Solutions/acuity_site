import { afterEach, describe, expect, it } from "bun:test";

import {
  CallCenterNoteDisposition,
  CallCenterSessionDirection,
} from "@/generated/prisma/client";
import {
  buildCallCenterActivityScopeWhere,
  buildCallCenterNoteScopeWhere,
  buildCallCenterPatientSessionScopeWhere,
  buildCallCenterQueueScopeWhere,
  buildTelnyxWebhookLogContext,
  canClaimQueueForVoicemail,
  buildPortalHistorySessionWhere,
  buildPortalPatientSessionWhere,
  buildPortalNeedsActionGroups,
  callCenterSessionDirectionFromPayload,
  canUseClientStateLocationForPresence,
  extractAcuityLiveKitHandoff,
  extractTelnyxRecordingDurationSec,
  extractTelnyxRecordingUrl,
  hasPortalConnectedCallSignal,
  hasQueueWaitDeadlineElapsed,
  getPortalCallCenterLocationState,
  isRingbackToneActiveAtSecond,
  isInboundSeatEligibleForAutomaticRing,
  isDefinitiveRingAttemptFailureCode,
  isPortalPatientCallSessionMetadata,
  mergeCallCenterSessionStatus,
  mergeQueueStatus,
  mergeRingAttemptStatus,
  metadataWithPendingBlindTransferSourceEnded,
  nextRingAttemptGeneration,
  practicePhoneCandidatesForTelnyxPayload,
  ringAttemptCommandId,
  type PortalCallActivityItem,
  resolveTelnyxRuntimeSettings,
  shouldMarkLinkedInboundSessionCompleted,
  shouldReleaseQueueItemAfterNoAnswer,
  shouldStartVoicemailAfterNoAnswer,
  telnyxDialFailureCode,
  telnyxSessionDirectionFromPayload,
  transferFailureCode,
  voicemailFailureCode,
} from "@/lib/call-center";
import { TelnyxError } from "@/lib/telnyx";

const TELNYX_ENV_KEYS = [
  "TELNYX_CONNECTION_ID",
  "TELNYX_CREDENTIAL_ID",
  "TELNYX_INBOUND_NUMBER",
  "TELNYX_PHONE_NUMBER",
] as const;

const originalEnv = Object.fromEntries(
  TELNYX_ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of TELNYX_ENV_KEYS) {
    const originalValue = originalEnv[key];

    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
});

describe("call-center settings", () => {
  it("prefers practice settings over Telnyx environment defaults", () => {
    process.env.TELNYX_CONNECTION_ID = "env-connection";
    process.env.TELNYX_CREDENTIAL_ID = "env-credential";
    process.env.TELNYX_INBOUND_NUMBER = "+15550000001";
    process.env.TELNYX_PHONE_NUMBER = "+15550000002";

    expect(
      resolveTelnyxRuntimeSettings({
        inboundPhoneNumber: "+17275919997",
        outboundCallerNumber: "+17275919997",
        telnyxConnectionId: "practice-connection",
        telnyxCredentialId: "practice-credential",
      }),
    ).toEqual({
      connectionId: "practice-connection",
      credentialId: "practice-credential",
      inboundPhoneNumber: "+17275919997",
      outboundCallerNumber: "+17275919997",
    });
  });

  it("falls back to Telnyx environment defaults while a practice is being configured", () => {
    process.env.TELNYX_CONNECTION_ID = "env-connection";
    process.env.TELNYX_CREDENTIAL_ID = "env-credential";
    process.env.TELNYX_INBOUND_NUMBER = "+15550000001";
    process.env.TELNYX_PHONE_NUMBER = "+15550000002";

    expect(
      resolveTelnyxRuntimeSettings({
        inboundPhoneNumber: null,
        outboundCallerNumber: null,
        telnyxConnectionId: null,
        telnyxCredentialId: null,
      }),
    ).toEqual({
      connectionId: "env-connection",
      credentialId: "env-credential",
      inboundPhoneNumber: "+15550000001",
      outboundCallerNumber: "+15550000002",
    });
  });
});

describe("call-center blind transfer metadata", () => {
  it("keeps pending transfer details when the source station hangs up", () => {
    const endedAt = new Date("2026-06-07T15:38:00.000Z");

    expect(
      metadataWithPendingBlindTransferSourceEnded(
        {
          blindTransferPending: {
            callerCallControlId: "caller-ccid",
            fromSeatId: "source-seat",
            targetSeatId: "target-seat",
          },
          unrelated: true,
        },
        {
          endedAt,
          reason: "hangup",
        },
      ),
    ).toEqual({
      blindTransferPending: {
        callerCallControlId: "caller-ccid",
        fromSeatId: "source-seat",
        sourceEndedAt: endedAt.toISOString(),
        sourceEndReason: "hangup",
        targetSeatId: "target-seat",
      },
      unrelated: true,
    });
  });
});

describe("call-center handled session reconciliation", () => {
  it("completes inbound ringing or active sessions when a handled queue leg ends", () => {
    expect(
      shouldMarkLinkedInboundSessionCompleted({
        direction: CallCenterSessionDirection.INBOUND,
        status: "RINGING",
      }),
    ).toBe(true);
    expect(
      shouldMarkLinkedInboundSessionCompleted({
        direction: CallCenterSessionDirection.INBOUND,
        status: "ACTIVE",
      }),
    ).toBe(true);
  });

  it("does not overwrite missed, voicemail, failed, outbound, or already-ended sessions", () => {
    expect(
      shouldMarkLinkedInboundSessionCompleted({
        direction: CallCenterSessionDirection.INBOUND,
        status: "MISSED",
      }),
    ).toBe(false);
    expect(
      shouldMarkLinkedInboundSessionCompleted({
        direction: CallCenterSessionDirection.INBOUND,
        status: "VOICEMAIL",
      }),
    ).toBe(false);
    expect(
      shouldMarkLinkedInboundSessionCompleted({
        direction: CallCenterSessionDirection.INBOUND,
        status: "FAILED",
      }),
    ).toBe(false);
    expect(
      shouldMarkLinkedInboundSessionCompleted({
        direction: CallCenterSessionDirection.OUTBOUND,
        status: "ACTIVE",
      }),
    ).toBe(false);
    expect(
      shouldMarkLinkedInboundSessionCompleted({
        direction: CallCenterSessionDirection.INBOUND,
        endedAt: new Date("2026-06-16T12:00:00.000Z"),
        status: "COMPLETED",
      }),
    ).toBe(false);
  });
});

describe("call-center session status monotonicity", () => {
  it("moves nonterminal sessions forward", () => {
    expect(mergeCallCenterSessionStatus(null, "RINGING")).toBe("RINGING");
    expect(mergeCallCenterSessionStatus("RINGING", "ACTIVE")).toBe("ACTIVE");
    expect(mergeCallCenterSessionStatus("ACTIVE", "RINGING")).toBe("ACTIVE");
    expect(mergeCallCenterSessionStatus("ACTIVE", "COMPLETED")).toBe("COMPLETED");
  });

  it("does not let late events replace terminal outcomes", () => {
    expect(mergeCallCenterSessionStatus("VOICEMAIL", "MISSED")).toBe("VOICEMAIL");
    expect(mergeCallCenterSessionStatus("MISSED", "COMPLETED")).toBe("MISSED");
    expect(mergeCallCenterSessionStatus("COMPLETED", "MISSED")).toBe("COMPLETED");
    expect(mergeCallCenterSessionStatus("FAILED", "ACTIVE")).toBe("FAILED");
  });

  it("accepts saved voicemail as the most specific terminal evidence", () => {
    expect(mergeCallCenterSessionStatus("COMPLETED", "VOICEMAIL")).toBe("VOICEMAIL");
    expect(mergeCallCenterSessionStatus("MISSED", "VOICEMAIL")).toBe("VOICEMAIL");
    expect(mergeQueueStatus("ABANDONED", "VOICEMAIL")).toBe("VOICEMAIL");
    expect(mergeQueueStatus("COMPLETED", "VOICEMAIL")).toBe("VOICEMAIL");
    expect(mergeQueueStatus("VOICEMAIL", "ABANDONED")).toBe("VOICEMAIL");
    expect(mergeQueueStatus("ABANDONED", "COMPLETED")).toBe("ABANDONED");
  });
});

describe("call-center ring-attempt monotonicity", () => {
  it("advances live attempts without reviving terminal or bridged attempts", () => {
    expect(mergeRingAttemptStatus("DIALING", "RINGING")).toBe("RINGING");
    expect(mergeRingAttemptStatus("RINGING", "ANSWERED")).toBe("ANSWERED");
    expect(mergeRingAttemptStatus("ANSWERED", "RINGING")).toBe("ANSWERED");
    expect(mergeRingAttemptStatus("BRIDGED", "NO_ANSWER")).toBe("BRIDGED");
    expect(mergeRingAttemptStatus("CANCELED", "BRIDGED")).toBe("CANCELED");
    expect(mergeRingAttemptStatus("NO_ANSWER", "RINGING")).toBe("NO_ANSWER");
    expect(mergeRingAttemptStatus("FAILED", "ANSWERED")).toBe("FAILED");
  });

  it("allows voicemail to cancel pending rings but never connected rings", () => {
    expect(canClaimQueueForVoicemail([])).toBe(true);
    expect(canClaimQueueForVoicemail(["DIALING", "RINGING"])).toBe(true);
    expect(canClaimQueueForVoicemail(["NO_ANSWER", "FAILED"])).toBe(true);
    expect(canClaimQueueForVoicemail(["ANSWERED"])).toBe(false);
    expect(canClaimQueueForVoicemail(["RINGING", "BRIDGED"])).toBe(false);
  });

  it("stores bounded dial failure codes without provider details", () => {
    const providerError = new TelnyxError(
      "provider message with caller data",
      503,
      "secret provider detail",
    );

    expect(telnyxDialFailureCode(providerError)).toBe("telnyx_dial_http_503");
    expect(telnyxDialFailureCode(new Error("secret transport detail"))).toBe(
      "telnyx_dial_failed",
    );
  });

  it("stores bounded voicemail failure codes without provider details", () => {
    const providerError = new TelnyxError(
      "provider message with caller data",
      503,
      "secret provider detail",
    );

    expect(voicemailFailureCode(providerError)).toBe("telnyx_voicemail_http_503");
    expect(voicemailFailureCode(new Error("secret transport detail"))).toBe(
      "failed_to_start_voicemail",
    );
  });

  it("stores bounded transfer failure codes without provider details", () => {
    const providerError = new TelnyxError(
      "provider message with caller data",
      503,
      "secret provider detail",
    );

    expect(transferFailureCode(providerError)).toBe("telnyx_transfer_http_503");
    expect(transferFailureCode(new Error("secret transport detail"))).toBe(
      "failed_to_transfer_call",
    );
  });

  it("creates a fresh generation only after a definitive terminal outcome", () => {
    expect(isDefinitiveRingAttemptFailureCode("missing_sip_username")).toBe(true);
    expect(isDefinitiveRingAttemptFailureCode("telnyx_dial_http_422")).toBe(true);
    expect(isDefinitiveRingAttemptFailureCode("telnyx_dial_http_408")).toBe(false);
    expect(isDefinitiveRingAttemptFailureCode("telnyx_dial_http_429")).toBe(false);
    expect(isDefinitiveRingAttemptFailureCode("telnyx_dial_http_503")).toBe(false);
    expect(isDefinitiveRingAttemptFailureCode("telnyx_dial_failed")).toBe(false);
    expect(nextRingAttemptGeneration(null)).toBe(1);
    expect(
      nextRingAttemptGeneration({
        generation: 1,
        hangupCause: "no_answer",
        status: "NO_ANSWER",
      }),
    ).toBe(2);
    expect(
      nextRingAttemptGeneration({
        generation: 2,
        hangupCause: "telnyx_dial_http_422",
        status: "FAILED",
      }),
    ).toBe(3);
    expect(
      nextRingAttemptGeneration({
        generation: 2,
        hangupCause: "telnyx_dial_failed",
        status: "FAILED",
      }),
    ).toBeNull();
    expect(
      nextRingAttemptGeneration({
        generation: 2,
        hangupCause: "telnyx_dial_http_408",
        status: "FAILED",
      }),
    ).toBeNull();
    expect(
      nextRingAttemptGeneration({
        generation: 2,
        hangupCause: "telnyx_dial_http_429",
        status: "FAILED",
      }),
    ).toBeNull();
    expect(
      nextRingAttemptGeneration({
        generation: 2,
        hangupCause: "telnyx_dial_http_503",
        status: "FAILED",
      }),
    ).toBeNull();
    expect(
      nextRingAttemptGeneration({
        generation: 2,
        hangupCause: null,
        status: "RINGING",
      }),
    ).toBeNull();
  });

  it("keeps one command id per dispatch ambiguity and changes it for a new ring", () => {
    expect(ringAttemptCommandId("attempt-1")).toBe("ring-attempt-1");
    expect(ringAttemptCommandId("attempt-1")).toBe(ringAttemptCommandId("attempt-1"));
    expect(ringAttemptCommandId("attempt-2")).not.toBe(ringAttemptCommandId("attempt-1"));
    expect(ringAttemptCommandId("attempt-2", "transfer-ring")).toBe(
      "transfer-ring-attempt-2",
    );
  });
});

describe("call-center automatic inbound routing", () => {
  it("rings only seats owned by the inbound location or matching shared queue", () => {
    expect(
      isInboundSeatEligibleForAutomaticRing({
        profileCanAccessQueue: false,
        profileQueueKey: null,
        queueLocationId: "location-1",
        seatLocationId: "location-1",
        seatQueueKey: null,
      }),
    ).toBe(true);
    expect(
      isInboundSeatEligibleForAutomaticRing({
        profileCanAccessQueue: false,
        profileQueueKey: null,
        queueLocationId: "location-1",
        seatLocationId: "location-2",
        seatQueueKey: null,
      }),
    ).toBe(false);
    expect(
      isInboundSeatEligibleForAutomaticRing({
        profileCanAccessQueue: false,
        profileQueueKey: null,
        queueLocationId: null,
        seatLocationId: null,
        seatQueueKey: null,
      }),
    ).toBe(false);
    expect(
      isInboundSeatEligibleForAutomaticRing({
        profileCanAccessQueue: true,
        profileQueueKey: "shared-optical",
        queueLocationId: "location-1",
        seatLocationId: null,
        seatQueueKey: "shared-optical",
      }),
    ).toBe(true);
    expect(
      isInboundSeatEligibleForAutomaticRing({
        profileCanAccessQueue: false,
        profileQueueKey: "shared-optical",
        queueLocationId: "location-1",
        seatLocationId: null,
        seatQueueKey: "shared-optical",
      }),
    ).toBe(false);
    expect(
      isInboundSeatEligibleForAutomaticRing({
        profileCanAccessQueue: true,
        profileQueueKey: "shared-main",
        queueLocationId: "location-1",
        seatLocationId: null,
        seatQueueKey: "shared-optical",
      }),
    ).toBe(false);
    expect(
      isInboundSeatEligibleForAutomaticRing({
        profileCanAccessQueue: true,
        profileQueueKey: "shared-optical",
        queueLocationId: "location-1",
        seatLocationId: "location-1",
        seatQueueKey: null,
      }),
    ).toBe(false);
  });

  it("returns unanswered rings to waiting until the caller deadline", () => {
    expect(
      shouldReleaseQueueItemAfterNoAnswer({
        attemptStatuses: ["NO_ANSWER", "FAILED"],
        queueStatus: "RINGING",
      }),
    ).toBe(true);
    expect(
      shouldReleaseQueueItemAfterNoAnswer({
        attemptStatuses: ["NO_ANSWER", "RINGING"],
        queueStatus: "RINGING",
      }),
    ).toBe(false);
    expect(
      shouldReleaseQueueItemAfterNoAnswer({
        attemptStatuses: [],
        queueStatus: "WAITING",
      }),
    ).toBe(false);
    expect(
      shouldReleaseQueueItemAfterNoAnswer({
        attemptStatuses: ["NO_ANSWER"],
        queueStatus: "VOICEMAIL",
      }),
    ).toBe(false);
  });

  it("uses current processing time to enforce the voicemail deadline", () => {
    const enteredAt = new Date("2026-07-09T12:00:00.000Z");

    expect(
      hasQueueWaitDeadlineElapsed({
        enteredAt,
        now: new Date("2026-07-09T12:00:29.999Z"),
        timeoutSec: 30,
      }),
    ).toBe(false);
    expect(
      hasQueueWaitDeadlineElapsed({
        enteredAt,
        now: new Date("2026-07-09T12:00:30.000Z"),
        timeoutSec: 30,
      }),
    ).toBe(true);
    expect(
      hasQueueWaitDeadlineElapsed({
        enteredAt,
        now: new Date("2026-07-09T12:00:40.000Z"),
        timeoutSec: 30,
      }),
    ).toBe(true);
  });

  it("starts voicemail after the last ring when caller ringback is unavailable", () => {
    expect(
      shouldStartVoicemailAfterNoAnswer({
        deadlineElapsed: false,
        ringbackUnavailable: true,
      }),
    ).toBe(true);
    expect(
      shouldStartVoicemailAfterNoAnswer({
        deadlineElapsed: false,
        ringbackUnavailable: false,
      }),
    ).toBe(false);
    expect(
      shouldStartVoicemailAfterNoAnswer({
        deadlineElapsed: true,
        ringbackUnavailable: false,
      }),
    ).toBe(true);
  });
});

describe("call-center webhook logging", () => {
  it("logs categorical routing facts without decoded state or caller data", () => {
    const clientState = Buffer.from(
      JSON.stringify({ callerNumber: "+18135550100", queueItemId: "queue-1" }),
      "utf8",
    ).toString("base64");
    const context = buildTelnyxWebhookLogContext("call.hangup", {
      call_control_id: "secret-call-control-id",
      client_state: clientState,
      direction: "incoming",
      from: "+18135550100",
      hangup_cause: "no_answer",
      reason: "caller +18135550100 did not answer",
      to: "+17275550100",
    });

    expect(context).toEqual({
      direction: "incoming",
      eventType: "call.hangup",
      hangupCause: "no_answer",
      hasClientState: true,
    });
    expect(JSON.stringify(context)).not.toContain("18135550100");
    expect(JSON.stringify(context)).not.toContain("secret-call-control-id");
  });
});

describe("call-center outbound location attribution", () => {
  it("requires the browser-selected location to match trusted presence access", () => {
    expect(
      canUseClientStateLocationForPresence({
        locationId: "nmb-location",
        membershipLocationIds: ["sweetwater-location", "nmb-location"],
        membershipLocationScope: "SELECTED",
        seatLocationId: null,
      }),
    ).toBe(true);
    expect(
      canUseClientStateLocationForPresence({
        locationId: "nmb-location",
        membershipLocationIds: ["sweetwater-location"],
        membershipLocationScope: "SELECTED",
        seatLocationId: null,
      }),
    ).toBe(false);
    expect(
      canUseClientStateLocationForPresence({
        locationId: "nmb-location",
        membershipLocationIds: ["sweetwater-location", "nmb-location"],
        membershipLocationScope: "SELECTED",
        seatLocationId: "sweetwater-location",
      }),
    ).toBe(false);
    expect(
      canUseClientStateLocationForPresence({
        locationId: "nmb-location",
        membershipLocationIds: [],
        membershipLocationScope: "ALL",
        seatLocationId: "nmb-location",
      }),
    ).toBe(true);
  });
});

describe("call-center special activity scoping", () => {
  it("keeps North Miami Beach Optical out of the shared Hollywood/Sweetwater scope", () => {
    const context = {
      allowedLocationIds: ["hollywood-location", "sweetwater-location", "nmb-location"],
      allowedPhoneNumbers: [],
      hasAllLocationAccess: false,
      membership: {},
      practice: {
        callCenterSettings: null,
        locations: [
          { id: "hollywood-location", name: "Hollywood" },
          { id: "sweetwater-location", name: "Sweetwater" },
          { id: "nmb-location", name: "North Miami Beach Optical" },
        ],
        name: "Abita Eye Group",
        phoneNumbers: [],
      },
      session: {
        user: {
          email: "callcenter@abitaeye.com",
          id: "user-1",
          name: null,
        },
      },
    } as never;
    const scope = buildCallCenterActivityScopeWhere(context);
    const where = scope as {
      OR?: Array<{
        locationId?: { in?: string[] };
        session?: { is?: { toPhone?: { in?: string[] } } };
      }>;
    };

    expect(where.OR?.[1].locationId?.in).toEqual([
      "hollywood-location",
      "sweetwater-location",
    ]);
  });

  it("keeps Sweetwater Optical activity limited to optical-number sessions", () => {
    const context = {
      allowedLocationIds: ["sweetwater-location"],
      allowedPhoneNumbers: [],
      hasAllLocationAccess: false,
      membership: {},
      practice: {
        callCenterSettings: null,
        locations: [{ id: "sweetwater-location", name: "Sweetwater" }],
        name: "Abita Eye Group",
        phoneNumbers: [],
      },
      session: {
        user: {
          email: "sweetwateropticals@abitaeye.com",
          id: "user-1",
          name: null,
        },
      },
    } as never;
    const scope = buildCallCenterActivityScopeWhere(context);
    const where = scope as {
      locationId?: unknown;
      OR?: unknown;
      session?: { is?: { toPhone?: { in?: string[] } } };
    };

    expect(where.OR).toBeUndefined();
    expect(where.locationId).toBeUndefined();
    expect(where.session?.is?.toPhone?.in).toContain("+17864657479");
    expect(where.session?.is?.toPhone?.in).toContain("+13055095333");
    expect(where.session?.is?.toPhone?.in).toContain("7864657479");
    expect(JSON.stringify(where)).not.toContain("sweetwater-location");
  });

  it("shows North Miami Beach as a separate Sweetwater Optical account location", () => {
    const context = {
      allowedLocationIds: ["sweetwater-location", "nmb-location"],
      allowedPhoneNumbers: [
        {
          isPrimary: true,
          label: "Sweetwater Optical",
          locationId: "sweetwater-location",
          phoneNumber: "+17864657479",
        },
        {
          isPrimary: true,
          label: "North Miami Beach Optical",
          locationId: "nmb-location",
          phoneNumber: "+13055095333",
        },
      ],
      hasAllLocationAccess: false,
      membership: {},
      practice: {
        callCenterSettings: null,
        locations: [
          { id: "sweetwater-location", name: "Sweetwater" },
          { id: "nmb-location", name: "North Miami Beach Optical" },
          { id: "hollywood-location", name: "Hollywood" },
        ],
        name: "Abita Eye Group",
        phoneNumbers: [],
      },
      session: {
        user: {
          email: "sweetwateropticals@abitaeye.com",
          id: "user-1",
          name: null,
        },
      },
    } as never;
    const state = getPortalCallCenterLocationState(context, {
      locationId: "nmb-location",
    });

    expect(state.locations.map((location) => location.label)).toEqual([
      "Sweetwater Optical",
      "North Miami Beach Optical",
    ]);
    expect(state.selectedLocation).toMatchObject({
      id: "nmb-location",
      label: "North Miami Beach Optical",
      locationId: "nmb-location",
      outboundNumber: "+17864657479",
    });
  });

  it("scopes North Miami Beach under the Sweetwater Optical account", () => {
    const context = {
      allowedLocationIds: ["sweetwater-location", "nmb-location"],
      allowedPhoneNumbers: [],
      hasAllLocationAccess: false,
      membership: {},
      practice: {
        callCenterSettings: null,
        locations: [
          { id: "sweetwater-location", name: "Sweetwater" },
          { id: "nmb-location", name: "North Miami Beach Optical" },
        ],
        name: "Abita Eye Group",
        phoneNumbers: [],
      },
      session: {
        user: {
          email: "sweetwateropticals@abitaeye.com",
          id: "user-1",
          name: null,
        },
      },
    } as never;
    const selectedLocation = {
      id: "nmb-location",
      label: "North Miami Beach Optical",
      locationId: "nmb-location",
      outboundNumber: "+17864657479",
    };
    const queueScope = buildCallCenterQueueScopeWhere(
      context,
      selectedLocation,
    ) as unknown;
    const patientSessionScope = buildCallCenterPatientSessionScopeWhere(
      context,
      selectedLocation,
    ) as unknown;
    const noteScope = buildCallCenterNoteScopeWhere(context, selectedLocation) as unknown;

    expect(JSON.stringify(queueScope)).toContain("+13055095333");
    expect(JSON.stringify(queueScope)).toContain("+17864657479");
    expect(JSON.stringify(queueScope)).toContain("nmb-location");
    expect(JSON.stringify(queueScope)).not.toContain("sweetwater-location");
    expect(JSON.stringify(patientSessionScope)).toContain("nmb-location");
    expect(JSON.stringify(noteScope)).toContain("nmb-location");
    expect(JSON.stringify(noteScope)).not.toContain("sweetwater-location");
  });

  it("includes Sweetwater Optical outbound and standalone follow-up notes", () => {
    const scope = buildCallCenterNoteScopeWhere({
      allowedLocationIds: ["sweetwater-location"],
      allowedPhoneNumbers: [],
      hasAllLocationAccess: false,
      membership: {},
      practice: {
        callCenterSettings: null,
        locations: [{ id: "sweetwater-location", name: "Sweetwater" }],
        name: "Abita Eye Group",
        phoneNumbers: [],
      },
      session: {
        user: {
          email: "sweetwateropticals@abitaeye.com",
          id: "user-1",
          name: null,
        },
      },
    } as never);
    const where = scope as {
      OR?: Array<{
        createdByUserId?: string;
        locationId?: { in?: string[] };
        session?: {
          is?: {
            OR?: Array<{
              fromPhone?: { in?: string[] };
              toPhone?: { in?: string[] };
            }>;
          };
        };
      }>;
    };

    expect(where.OR).toHaveLength(3);
    expect(where.OR?.[0].session?.is?.OR?.[0].toPhone?.in).toContain("+17864657479");
    expect(where.OR?.[0].session?.is?.OR?.[1].fromPhone?.in).toContain("+17864657479");
    expect(where.OR?.[2]).toMatchObject({
      createdByUserId: "user-1",
      locationId: {
        in: ["sweetwater-location"],
      },
    });
  });
});

function needsActionEvent(
  overrides: Partial<PortalCallActivityItem> & {
    createdAt: Date;
    fromPhone: string;
    kind: PortalCallActivityItem["kind"];
    recordId: string;
  },
): PortalCallActivityItem {
  return {
    callerName: null,
    disposition: null,
    durationSec: null,
    id: `${overrides.kind}:${overrides.recordId}`,
    locationName: null,
    recordingId: null,
    resolved: false,
    ...overrides,
  };
}

describe("portal needs-action grouping", () => {
  it("groups repeated unresolved activity by caller number", () => {
    const groups = buildPortalNeedsActionGroups([
      needsActionEvent({
        createdAt: new Date("2026-06-16T13:00:00.000Z"),
        fromPhone: "(727) 591-9997",
        kind: "missed",
        recordId: "missed-1",
      }),
      needsActionEvent({
        createdAt: new Date("2026-06-16T13:10:00.000Z"),
        durationSec: 24,
        fromPhone: "+17275919997",
        kind: "voicemail",
        recordId: "voicemail-1",
        recordingId: "recording-1",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      eventCount: 2,
      fromPhone: "(727) 591-9997",
      latestKind: "voicemail",
      latestVoicemailDurationSec: 24,
      latestVoicemailRecordingId: "recording-1",
      missedCount: 1,
      voicemailCount: 1,
    });
  });

  it("clears older unresolved events when the caller connects later", () => {
    const groups = buildPortalNeedsActionGroups(
      [
        needsActionEvent({
          createdAt: new Date("2026-06-16T13:00:00.000Z"),
          fromPhone: "+17275919997",
          kind: "missed",
          recordId: "missed-before",
        }),
        needsActionEvent({
          createdAt: new Date("2026-06-16T14:00:00.000Z"),
          fromPhone: "+17275919997",
          kind: "missed",
          recordId: "missed-after",
        }),
      ],
      [
        {
          direction: CallCenterSessionDirection.OUTBOUND,
          fromPhone: "+17275550000",
          occurredAt: new Date("2026-06-16T13:30:00.000Z"),
          toPhone: "+17275919997",
        },
      ],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      eventCount: 1,
      lastActivityAt: new Date("2026-06-16T14:00:00.000Z"),
      missedCount: 1,
      voicemailCount: 0,
    });
  });

  it("keeps callback notes visible as one caller follow-up thread", () => {
    const groups = buildPortalNeedsActionGroups(
      [
        needsActionEvent({
          createdAt: new Date("2026-06-16T15:00:00.000Z"),
          disposition: CallCenterNoteDisposition.CALLBACK_NEEDED,
          fromPhone: "+17275919997",
          kind: "note",
          recordId: "note-1",
        }),
      ],
      [
        {
          direction: CallCenterSessionDirection.OUTBOUND,
          fromPhone: "+17275550000",
          occurredAt: new Date("2026-06-16T15:30:00.000Z"),
          toPhone: "+17275919997",
        },
      ],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      callbackNeededCount: 1,
      eventCount: 1,
      latestKind: "note",
      missedCount: 0,
      noteCount: 1,
      voicemailCount: 0,
    });
  });

  it("keeps older caller threads when one caller has many newer events", () => {
    const repeatedCallerEvents = Array.from({ length: 300 }, (_, index) =>
      needsActionEvent({
        createdAt: new Date(Date.UTC(2026, 5, 16, 16, 0, index)),
        fromPhone: "+17275919997",
        kind: "missed",
        recordId: `missed-repeat-${index}`,
      }),
    );
    const groups = buildPortalNeedsActionGroups([
      ...repeatedCallerEvents,
      needsActionEvent({
        createdAt: new Date("2026-06-16T15:00:00.000Z"),
        fromPhone: "+17275550123",
        kind: "missed",
        recordId: "missed-older-caller",
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      eventCount: 300,
      fromPhone: "+17275919997",
    });
    expect(groups[1]).toMatchObject({
      eventCount: 1,
      fromPhone: "+17275550123",
    });
  });
});

describe("portal connected call signal", () => {
  it("does not count inbound caller-leg answer without a staff answer", () => {
    expect(
      hasPortalConnectedCallSignal({
        answeredAt: new Date("2026-06-16T13:00:00.000Z"),
        direction: CallCenterSessionDirection.INBOUND,
        queueItems: [],
      }),
    ).toBe(false);
  });

  it("counts outbound answered calls and inbound staff answers", () => {
    expect(
      hasPortalConnectedCallSignal({
        answeredAt: new Date("2026-06-16T13:00:00.000Z"),
        direction: CallCenterSessionDirection.OUTBOUND,
        queueItems: [],
      }),
    ).toBe(true);
    expect(
      hasPortalConnectedCallSignal({
        answeredAt: new Date("2026-06-16T13:00:00.000Z"),
        direction: CallCenterSessionDirection.INBOUND,
        queueItems: [
          {
            answeredAt: null,
            ringAttempts: [
              {
                answeredAt: null,
                status: "BRIDGED",
              },
            ],
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("portal patient call session filtering", () => {
  it("keeps call-center history scoped to connected calls", () => {
    const where = buildPortalHistorySessionWhere({
      practiceId: "practice-1",
      sessionFilter: {},
    }) as { status?: unknown };
    const serialized = JSON.stringify(where);

    expect(where.status).toBe("COMPLETED");
    expect(serialized).toContain("ANSWERED");
    expect(serialized).toContain("BRIDGED");
    expect(serialized).not.toContain("MISSED");
    expect(serialized).not.toContain("VOICEMAIL");
  });

  it("keeps missing metadata paths out of the Prisma patient-session scope", () => {
    expect(buildPortalPatientSessionWhere()).toEqual({
      NOT: {
        toPhone: {
          mode: "insensitive",
          startsWith: "sip:",
        },
      },
    });
  });

  it("keeps browser-originated outbound call metadata as patient history", () => {
    expect(
      isPortalPatientCallSessionMetadata({
        clientState: {
          browserSessionId: "browser-1",
          locationId: "nmb-location",
          stationLabel: "101 - Front Desk",
          stationSeatId: "seat-1",
        },
      }),
    ).toBe(true);
  });

  it("excludes current decoded agent-leg metadata", () => {
    expect(
      isPortalPatientCallSessionMetadata({
        clientState: {
          queueItemId: "queue-1",
          ringAttemptId: "ring-1",
          seatId: "seat-1",
        },
      }),
    ).toBe(false);
  });

  it("excludes older agent-leg metadata stored only as Telnyx client_state", () => {
    const clientState = Buffer.from(
      JSON.stringify({
        queueItemId: "queue-1",
        ringAttemptId: "ring-1",
        seatId: "seat-1",
      }),
      "utf8",
    ).toString("base64");

    expect(
      isPortalPatientCallSessionMetadata({
        payload: {
          client_state: clientState,
        },
      }),
    ).toBe(false);
  });
});

describe("Telnyx caller ringback cadence", () => {
  it("uses repeated ringback tone windows instead of one tone followed by silence", () => {
    expect(isRingbackToneActiveAtSecond(0)).toBe(true);
    expect(isRingbackToneActiveAtSecond(1.99)).toBe(true);
    expect(isRingbackToneActiveAtSecond(2)).toBe(false);
    expect(isRingbackToneActiveAtSecond(5.99)).toBe(false);
    expect(isRingbackToneActiveAtSecond(6)).toBe(true);
    expect(isRingbackToneActiveAtSecond(7.5)).toBe(true);
    expect(isRingbackToneActiveAtSecond(-1)).toBe(false);
  });
});

describe("Telnyx voicemail duration parsing", () => {
  it("reads direct numeric and string second values", () => {
    expect(
      extractTelnyxRecordingDurationSec({
        recording_duration_sec: 12,
      }),
    ).toBe(12);
    expect(
      extractTelnyxRecordingDurationSec({
        RecordingDuration: "17",
      }),
    ).toBe(17);
  });

  it("converts millisecond values to seconds", () => {
    expect(
      extractTelnyxRecordingDurationSec({
        duration_millis: "12345",
      }),
    ).toBe(12.345);
  });

  it("reads nested duration objects", () => {
    expect(
      extractTelnyxRecordingDurationSec({
        duration: {
          seconds: "9",
        },
      }),
    ).toBe(9);
  });

  it("derives duration from Telnyx recording timestamps", () => {
    expect(
      extractTelnyxRecordingDurationSec({
        recording_ended_at: "2026-05-01T13:00:14.500Z",
        recording_started_at: "2026-05-01T13:00:08.000Z",
      }),
    ).toBe(6.5);
  });

  it("returns zero when the payload has no duration signal", () => {
    expect(extractTelnyxRecordingDurationSec({})).toBe(0);
  });
});

describe("Telnyx voicemail recording URL parsing", () => {
  it("prefers fresh download URLs over webhook recording URLs", () => {
    expect(
      extractTelnyxRecordingUrl({
        download_urls: {
          mp3: "https://recordings.example/download.mp3",
        },
        public_recording_urls: {
          mp3: "https://recordings.example/public.mp3",
        },
        recording_urls: {
          mp3: "https://recordings.example/webhook.mp3",
        },
      }),
    ).toBe("https://recordings.example/download.mp3");
  });

  it("falls back through public and webhook recording URLs", () => {
    expect(
      extractTelnyxRecordingUrl({
        public_recording_urls: {
          wav: "https://recordings.example/public.wav",
        },
        recording_urls: {
          mp3: "https://recordings.example/webhook.mp3",
        },
      }),
    ).toBe("https://recordings.example/public.wav");
  });
});

describe("LiveKit SIP handoff parsing", () => {
  it("reads Acuity handoff headers from Telnyx sip_headers arrays", () => {
    expect(
      extractAcuityLiveKitHandoff({
        sip_headers: [
          { name: "X-Acuity-Handoff", value: "call-center" },
          { name: "X-Acuity-Trunk-Phone", value: "+17275919997" },
          { name: "X-Acuity-Caller-Phone", value: "(813) 555-0100" },
          { name: "X-Acuity-LiveKit-Call-Id", value: "lk-call-123" },
        ],
      }),
    ).toEqual({
      callerPhone: "(813) 555-0100",
      handoff: "call-center",
      isCallCenterHandoff: true,
      liveKitCallId: "lk-call-123",
      trunkPhone: "+17275919997",
    });
  });

  it("reads Acuity handoff headers from Telnyx custom_headers maps", () => {
    expect(
      extractAcuityLiveKitHandoff({
        custom_headers: {
          "x-acuity-caller-phone": "+18135550100",
          "x-acuity-handoff": "call-center",
          "x-acuity-livekit-call-id": "lk-call-456",
          "x-acuity-trunk-phone": "7275919997",
        },
      }),
    ).toMatchObject({
      callerPhone: "+18135550100",
      isCallCenterHandoff: true,
      liveKitCallId: "lk-call-456",
      trunkPhone: "7275919997",
    });
  });

  it("treats call-center handoff webhooks as inbound sessions", () => {
    expect(
      telnyxSessionDirectionFromPayload({
        direction: "outgoing",
        sip_headers: [
          { name: "X-Acuity-Handoff", value: "call-center" },
          { name: "X-Acuity-Trunk-Phone", value: "+17275919997" },
        ],
      }),
    ).toBe(CallCenterSessionDirection.INBOUND);
  });

  it("never treats the caller side as the practice phone for known directions", () => {
    expect(
      practicePhoneCandidatesForTelnyxPayload({
        direction: "incoming",
        from: "+18135550100",
        to: "+17275919997",
      }),
    ).toEqual(["+17275919997"]);
    expect(
      practicePhoneCandidatesForTelnyxPayload({
        direction: "outgoing",
        from: "+17275919997",
        to: "+18135550100",
      }),
    ).toEqual(["+17275919997"]);
    expect(
      practicePhoneCandidatesForTelnyxPayload({
        from: "+18135550100",
        to: "+17275919997",
      }),
    ).toEqual([]);
  });

  it("preserves stored agent-leg client state when later webhooks omit client_state", () => {
    expect(
      callCenterSessionDirectionFromPayload(
        {
          direction: "outgoing",
        },
        {
          clientState: {
            queueItemId: "queue-1",
            ringAttemptId: "ring-1",
            seatId: "seat-1",
          },
        },
      ),
    ).toBe(CallCenterSessionDirection.INTERNAL);
  });
});
