import { describe, expect, it } from "bun:test";

import { readTelnyxLoginTokenResponse, TelnyxError } from "../telnyx";

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
