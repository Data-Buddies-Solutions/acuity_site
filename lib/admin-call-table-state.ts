import { formatPhone } from "@/lib/format";

export const CALL_TABLE_PAGE_SIZE = 15;

export const callQuickFilters = [
  { id: "all", label: "All" },
  { id: "booking", label: "Booked" },
  { id: "transfers", label: "Transfers" },
  { id: "language", label: "Language" },
  { id: "runtime", label: "Runtime" },
  { id: "fallback", label: "Fallback" },
  { id: "errors", label: "Errors" },
] as const;

export type CallQuickFilter = (typeof callQuickFilters)[number]["id"];
export type CallSortKey =
  "actions" | "durationSec" | "office" | "startedAt" | "totalLatency" | "transferred";
export type CallSortDirection = "asc" | "desc";
export type CallSortState = { direction: CallSortDirection; key: CallSortKey };
export type CallTableState = {
  page: number;
  quickFilter: CallQuickFilter;
  searchQuery: string;
  sortState: CallSortState;
};

export type CallTableStateRow = {
  acceptedLanguages: string[];
  apptActions: string[];
  callId: string;
  callerPhone: string;
  closeReason: string | null;
  currentLanguage: string | null;
  durationSec: number;
  evaluationComment: string | null;
  fallbackUsed: boolean;
  falseInterruptionCount: number;
  id: string;
  languageChanged: boolean;
  llmModel: string;
  officeName: string | null;
  officePhone: string;
  overlappingSpeechCount: number;
  p50TotalLatency: number;
  runtimeErrorCount: number;
  startedAt: string;
  toolActions: string[];
  toolErrors: number;
  transferred: boolean;
};

type SearchParamSource =
  Record<string, string | string[] | undefined> | { get: (key: string) => string | null };

export const DEFAULT_CALL_TABLE_STATE: CallTableState = {
  page: 1,
  quickFilter: "all",
  searchQuery: "",
  sortState: {
    direction: "desc",
    key: "startedAt",
  },
};

function getParam(source: SearchParamSource, key: string) {
  if ("get" in source && typeof source.get === "function") {
    return source.get(key);
  }

  const value = (source as Record<string, string | string[] | undefined>)[key];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function parseQuickFilter(value: string | null): CallQuickFilter {
  return callQuickFilters.some((filter) => filter.id === value)
    ? (value as CallQuickFilter)
    : DEFAULT_CALL_TABLE_STATE.quickFilter;
}

function parseSortKey(value: string | null): CallSortKey {
  switch (value) {
    case "actions":
    case "durationSec":
    case "office":
    case "startedAt":
    case "totalLatency":
    case "transferred":
      return value;
    default:
      return DEFAULT_CALL_TABLE_STATE.sortState.key;
  }
}

function parseSortDirection(value: string | null): CallSortDirection {
  return value === "asc" ? "asc" : "desc";
}

export function normalizeCallSearchValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeLanguage(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function parseCallTableState(source: SearchParamSource): CallTableState {
  const page = Number(getParam(source, "page") ?? "");
  const searchQuery = getParam(source, "q")?.replace(/\s+/g, " ").trim() ?? "";

  return {
    page: Number.isInteger(page) && page > 0 ? page : DEFAULT_CALL_TABLE_STATE.page,
    quickFilter: parseQuickFilter(getParam(source, "filter")),
    searchQuery,
    sortState: {
      direction: parseSortDirection(getParam(source, "dir")),
      key: parseSortKey(getParam(source, "sort")),
    },
  };
}

export function writeCallTableStateToParams(
  params: URLSearchParams,
  state: CallTableState,
) {
  if (state.page > 1) {
    params.set("page", String(state.page));
  } else {
    params.delete("page");
  }

  if (state.searchQuery) {
    params.set("q", state.searchQuery);
  } else {
    params.delete("q");
  }

  if (state.quickFilter !== DEFAULT_CALL_TABLE_STATE.quickFilter) {
    params.set("filter", state.quickFilter);
  } else {
    params.delete("filter");
  }

  if (state.sortState.key !== DEFAULT_CALL_TABLE_STATE.sortState.key) {
    params.set("sort", state.sortState.key);
  } else {
    params.delete("sort");
  }

  if (state.sortState.direction !== DEFAULT_CALL_TABLE_STATE.sortState.direction) {
    params.set("dir", state.sortState.direction);
  } else {
    params.delete("dir");
  }
}

export function searchParamRecordToURLSearchParams(
  source: Record<string, string | string[] | undefined>,
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    } else if (value) {
      params.set(key, value);
    }
  }

  return params;
}

export function hasLanguageSignal(call: CallTableStateRow): boolean {
  if (call.languageChanged) return true;

  const currentLanguage = normalizeLanguage(call.currentLanguage);
  if (currentLanguage && currentLanguage !== "en") return true;

  return call.acceptedLanguages.some((language) => {
    const normalized = normalizeLanguage(language);
    return normalized.length > 0 && normalized !== "en";
  });
}

export function getCallOfficeLabel(call: CallTableStateRow) {
  return call.officeName || formatPhone(call.officePhone) || "Unknown office";
}

export function getCallOfficeSubLabel(call: CallTableStateRow) {
  return call.officeName && call.officePhone ? formatPhone(call.officePhone) : "";
}

export function clampCallTablePage(page: number, pageCount: number) {
  return Math.min(Math.max(1, page), Math.max(1, pageCount));
}

export function getCallTablePageCount(callCount: number) {
  return Math.max(1, Math.ceil(callCount / CALL_TABLE_PAGE_SIZE));
}
