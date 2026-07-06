import { describe, expect, it } from "bun:test";

import {
  DEFAULT_CALL_TABLE_STATE,
  clampCallTablePage,
  getCallTableToolActionLabels,
  getCallTablePageCount,
  hasLanguageSignal,
  parseCallTableState,
  searchParamRecordToURLSearchParams,
  writeCallTableStateToParams,
  type CallTableStateRow,
} from "@/lib/admin-call-table-state";

describe("admin call table state", () => {
  it("parses invalid URL state back to table defaults", () => {
    const state = parseCallTableState({
      dir: "sideways",
      filter: "unknown",
      page: "-3",
      q: "  jane    smith  ",
      sort: "totalLatency",
    });

    expect(state).toEqual({
      ...DEFAULT_CALL_TABLE_STATE,
      searchQuery: "jane smith",
    });
  });

  it("writes table state without removing non-table route params", () => {
    const params = searchParamRecordToURLSearchParams({
      office: "location:abc",
      range: "7d",
      view: "bad",
    });

    writeCallTableStateToParams(params, {
      page: 3,
      quickFilter: "errors",
      searchQuery: "smith",
      sortState: {
        direction: "asc",
        key: "durationSec",
      },
    });

    expect(params.toString()).toBe(
      "office=location%3Aabc&range=7d&view=bad&page=3&q=smith&filter=errors&sort=durationSec&dir=asc",
    );
  });

  it("removes default table params while preserving surrounding URL state", () => {
    const params = new URLSearchParams(
      "view=golden&page=2&q=smith&filter=errors&sort=office&dir=asc",
    );

    writeCallTableStateToParams(params, DEFAULT_CALL_TABLE_STATE);

    expect(params.toString()).toBe("view=golden");
  });

  it("clamps requested pages against the server result count", () => {
    expect(getCallTablePageCount(0)).toBe(1);
    expect(getCallTablePageCount(15)).toBe(1);
    expect(getCallTablePageCount(16)).toBe(2);
    expect(clampCallTablePage(99, 2)).toBe(2);
    expect(clampCallTablePage(-1, 2)).toBe(1);
  });

  it("keeps all observed tool call names for action badges", () => {
    expect(
      getCallTableToolActionLabels({
        fallbackActions: ["Book"],
        toolCalls: [
          { name: "get_availability" },
          { name: "confirm_appt" },
          { name: "transfer_call" },
          { name: "get_availability" },
        ],
        toolExecutions: [
          { toolName: "check_insurance" },
          { toolName: "confirm_appt" },
          { toolName: null },
        ],
      }),
    ).toEqual(["Get Availability", "Confirm", "Transfer Call", "Check Insurance"]);
  });

  it("falls back to stored action state when payload tool names are missing", () => {
    expect(
      getCallTableToolActionLabels({ fallbackActions: ["Book", "Transfer"] }),
    ).toEqual(["Book", "Transfer"]);
  });

  it("detects language signals from lightweight table rows", () => {
    const row = {
      acceptedLanguages: ["en", "es"],
      apptActions: [],
      callId: "external-call-id",
      callerPhone: "+17275551212",
      closeReason: null,
      currentLanguage: "en",
      durationSec: 120,
      evaluationComment: null,
      fallbackUsed: false,
      falseInterruptionCount: 0,
      id: "call-id",
      languageChanged: false,
      llmModel: "glm",
      officeName: null,
      officePhone: "+17275550000",
      overlappingSpeechCount: 0,
      p50TotalLatency: 0,
      runtimeErrorCount: 0,
      startedAt: "2026-07-01T12:00:00.000Z",
      toolActions: [],
      toolErrors: 0,
      transferred: false,
    } satisfies CallTableStateRow;

    expect(hasLanguageSignal(row)).toBe(true);
  });
});
