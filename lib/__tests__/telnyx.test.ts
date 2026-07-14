import { afterEach, describe, expect, it, mock } from "bun:test";

import {
  readTelnyxLoginTokenResponse,
  startTelnyxRecording,
  TelnyxError,
} from "../telnyx";

const originalApiKey = process.env.TELNYX_API_KEY;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.TELNYX_API_KEY;
  else process.env.TELNYX_API_KEY = originalApiKey;
});

describe("Telnyx login tokens", () => {
  it("accepts plain and JSON-quoted tokens", async () => {
    await expect(readTelnyxLoginTokenResponse(new Response("plain-token"))).resolves.toBe(
      "plain-token",
    );
    await expect(
      readTelnyxLoginTokenResponse(new Response('"quoted-token"')),
    ).resolves.toBe("quoted-token");
  });

  it("rejects an empty successful response before it reaches the browser SDK", async () => {
    const error = await readTelnyxLoginTokenResponse(new Response(""))
      .then(() => null)
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(TelnyxError);
    expect(error).toMatchObject({
      message: "Telnyx returned an empty login token",
      status: 502,
    });
  });
});

describe("Telnyx voicemail recording", () => {
  it("asks Telnyx to play the recording-start beep", async () => {
    process.env.TELNYX_API_KEY = "test-key";
    let request: RequestInit | undefined;
    globalThis.fetch = mock(async (_url, init) => {
      request = init;
      return Response.json({ data: { result: "ok" } });
    }) as unknown as typeof fetch;

    await startTelnyxRecording({
      callControlId: "control-1",
      commandId: "command-1",
      playBeep: true,
    });

    expect(JSON.parse(String(request?.body))).toMatchObject({
      command_id: "command-1",
      play_beep: true,
    });
  });
});
