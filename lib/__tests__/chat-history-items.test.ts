import { describe, expect, it } from "bun:test";

import {
  getChatItemCallId,
  getChatItemCreatedAt,
  getChatItemIsError,
  getChatItemToolArgs,
} from "@/lib/chat-history-items";

describe("chat history item aliases", () => {
  it("reads the current LiveKit function-call report fields", () => {
    expect(
      getChatItemCallId({
        call_id: "new-call-id",
        type: "function_call",
      }),
    ).toBe("new-call-id");

    expect(
      getChatItemCreatedAt({
        created_at: 200,
        type: "function_call",
      }),
    ).toBe(200);

    expect(
      getChatItemToolArgs({
        arguments: '{"new":true}',
        type: "function_call",
      }),
    ).toBe('{"new":true}');

    expect(getChatItemIsError({ is_error: true, type: "function_call_output" })).toBe(
      true,
    );
  });
});
