import { describe, expect, it } from "bun:test";

import { CallCenterRequestError } from "@/lib/call-center/operator-error";

import { callCenterResponse, operatorErrorCopy } from "./call-center-errors";

describe("call-center operator error catalog", () => {
  it("gives an already-claimed call a specific next action", () => {
    const copy = operatorErrorCopy(
      new CallCenterRequestError({
        code: "CALL_ALREADY_CLAIMED",
        referenceId: "K7M2Q9",
        retryable: false,
      }),
      "answer",
    );

    expect(copy).toEqual({
      message: "Call taken by another agent",
      presentation: "inline",
      retryable: false,
    });
  });

  it("keeps unknown provider details out of the calm action-specific fallback", () => {
    const copy = operatorErrorCopy(
      new Error('Telnyx payload {"patient":"+17865550100"}'),
      "transfer",
    );

    expect(copy.message).toBe(
      "We couldn't transfer this call. Try again. If it keeps happening, contact support.",
    );
    expect(copy.message).not.toContain("Telnyx");
    expect(copy.retryable).toBe(true);
  });

  it("uses Answer terminology when an incoming-call failure is unknown", () => {
    const copy = operatorErrorCopy(new Error("provider details"), "answer");

    expect(copy.message).toBe(
      "We couldn't answer this call. Try again. If it keeps happening, contact support.",
    );
  });

  it("does not direct operators to the removed Ready control", () => {
    const messageFor = (
      code: "BROWSER_AUDIO_REQUIRED" | "CALL_NOT_READY" | "MICROPHONE_REQUIRED",
    ) =>
      operatorErrorCopy(
        new CallCenterRequestError({ code, referenceId: "", retryable: true }),
        "connect",
      ).message;

    expect(messageFor("BROWSER_AUDIO_REQUIRED")).toBe(
      "Browser audio is blocked. Allow sound, then try again.",
    );
    expect(messageFor("CALL_NOT_READY")).toBe(
      "Calling is not ready yet. Wait a moment, then try again.",
    );
    expect(messageFor("MICROPHONE_REQUIRED")).toBe(
      "Microphone access is required. Allow microphone access, then try again.",
    );
  });

  it("keeps telephony implementation terms out of setup guidance", () => {
    const copy = operatorErrorCopy(
      new CallCenterRequestError({
        code: "CALLING_NOT_CONFIGURED",
        referenceId: "",
        retryable: false,
      }),
      "connect",
    );

    expect(copy.message).toBe(
      "Calling is not configured for this login. Ask an administrator to set up calling and queue access for your account.",
    );
    expect(copy.message).not.toContain("endpoint");
  });

  it("gives a failed outbound call a concrete retry action", () => {
    const copy = operatorErrorCopy(
      new CallCenterRequestError({
        code: "OUTBOUND_CALL_FAILED",
        referenceId: "R4T8W2",
        retryable: true,
      }),
      "outbound",
    );

    expect(copy.message).toBe(
      "The call could not be started. Check the number, then try again. Reference: R4T8W2.",
    );
    expect(copy.retryable).toBe(true);
  });

  it("preserves the server reference and retry behavior", async () => {
    const response = Response.json(
      {
        error: {
          code: "TEMPORARY_SERVICE_FAILURE",
          referenceId: "ABC123",
          retryable: true,
        },
      },
      { status: 503 },
    );

    let error: unknown;
    try {
      await callCenterResponse(response);
    } catch (caught) {
      error = caught;
    }
    const copy = operatorErrorCopy(error, "outbound");

    expect(copy.message).toContain("temporarily unavailable");
    expect(copy.message).toContain("Reference: ABC123");
    expect(copy.retryable).toBe(true);
    expect(copy.presentation).toBe("banner");
  });
});
