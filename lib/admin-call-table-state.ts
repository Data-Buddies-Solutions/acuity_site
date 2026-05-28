import type { AdminCallTableRow } from "@/lib/admin-analytics";
import { formatPhone } from "@/lib/format";

export const CALL_TABLE_PAGE_SIZE = 15;

export const callQuickFilters = [
  { id: "all", label: "All" },
  { id: "booking", label: "Booked" },
  { id: "needs_review", label: "Needs Review" },
  { id: "transfers", label: "Transfers" },
  { id: "language", label: "Language" },
  { id: "runtime", label: "Runtime" },
  { id: "fallback", label: "Fallback" },
  { id: "errors", label: "Errors" },
] as const;

export type CallQuickFilter = (typeof callQuickFilters)[number]["id"];
export type CallSortKey =
  | "actions"
  | "durationSec"
  | "office"
  | "review"
  | "startedAt"
  | "totalLatency"
  | "transferred";
export type CallSortDirection = "asc" | "desc";
export type CallSortState = { direction: CallSortDirection; key: CallSortKey };
export type CallTableState = {
  page: number;
  quickFilter: CallQuickFilter;
  searchQuery: string;
  sortState: CallSortState;
};

type SearchParamSource =
  | Record<string, string | string[] | undefined>
  | { get: (key: string) => string | null };

const defaultCallTableState: CallTableState = {
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
    : defaultCallTableState.quickFilter;
}

function parseSortKey(value: string | null): CallSortKey {
  switch (value) {
    case "actions":
    case "durationSec":
    case "office":
    case "review":
    case "startedAt":
    case "totalLatency":
    case "transferred":
      return value;
    default:
      return defaultCallTableState.sortState.key;
  }
}

function parseSortDirection(value: string | null): CallSortDirection {
  return value === "asc" ? "asc" : "desc";
}

export function normalizeCallSearchValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizeLanguage(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function parseCallTableState(source: SearchParamSource): CallTableState {
  const page = Number(getParam(source, "page") ?? "");
  const searchQuery = getParam(source, "q")?.replace(/\s+/g, " ").trim() ?? "";

  return {
    page: Number.isInteger(page) && page > 0 ? page : defaultCallTableState.page,
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

  if (state.quickFilter !== defaultCallTableState.quickFilter) {
    params.set("filter", state.quickFilter);
  } else {
    params.delete("filter");
  }

  if (state.sortState.key !== defaultCallTableState.sortState.key) {
    params.set("sort", state.sortState.key);
  } else {
    params.delete("sort");
  }

  if (state.sortState.direction !== defaultCallTableState.sortState.direction) {
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

export function hasLanguageSignal(call: AdminCallTableRow): boolean {
  if (call.languageChanged) return true;

  const currentLanguage = normalizeLanguage(call.currentLanguage);
  if (currentLanguage && currentLanguage !== "en") return true;

  return call.acceptedLanguages.some((language) => {
    const normalized = normalizeLanguage(language);
    return normalized.length > 0 && normalized !== "en";
  });
}

export function getCallOfficeLabel(call: AdminCallTableRow) {
  return call.officeName || formatPhone(call.officePhone) || "Unknown office";
}

export function getCallOfficeSubLabel(call: AdminCallTableRow) {
  return call.officeName && call.officePhone ? formatPhone(call.officePhone) : "";
}

function matchesQuickFilter(call: AdminCallTableRow, quickFilter: CallQuickFilter) {
  if (quickFilter === "booking") return call.apptActions.includes("Booked");
  if (quickFilter === "errors") return call.toolErrors > 0;
  if (quickFilter === "fallback") return call.fallbackUsed;
  if (quickFilter === "language") return hasLanguageSignal(call);
  if (quickFilter === "needs_review") return call.reviewNeedsAttention;
  if (quickFilter === "runtime") {
    return (
      call.runtimeErrorCount > 0 ||
      call.falseInterruptionCount > 0 ||
      call.overlappingSpeechCount > 0
    );
  }
  if (quickFilter === "transfers") return call.transferred;
  return true;
}

function getSearchableValues(call: AdminCallTableRow) {
  return [
    call.callId,
    call.callerPhone,
    formatPhone(call.callerPhone),
    call.llmModel,
    call.officePhone,
    formatPhone(call.officePhone),
    call.currentLanguage ?? "",
    call.closeReason ?? "",
    getCallOfficeLabel(call),
    call.acceptedLanguages.join(" "),
    call.evaluationComment ?? "",
    call.toolActions.join(" "),
    call.transcriptText,
  ];
}

function matchesSearch(call: AdminCallTableRow, searchQuery: string) {
  const normalizedQuery = normalizeCallSearchValue(searchQuery);

  if (!normalizedQuery) {
    return true;
  }

  const phoneQuery = normalizeDigits(searchQuery);
  const searchableValues = getSearchableValues(call);

  if (
    phoneQuery &&
    searchableValues.some((value) => normalizeDigits(value).includes(phoneQuery))
  ) {
    return true;
  }

  return searchableValues.some((value) =>
    normalizeCallSearchValue(value).includes(normalizedQuery),
  );
}

function getSortValue(call: AdminCallTableRow, key: CallSortKey) {
  switch (key) {
    case "actions":
      return call.toolActions.length;
    case "durationSec":
      return call.durationSec;
    case "office":
      return getCallOfficeLabel(call);
    case "review":
      return call.reviewNeedsAttention ? 1 : (call.reviewAverageScore ?? -1);
    case "startedAt":
      return new Date(call.startedAt).getTime();
    case "totalLatency":
      return call.p50TotalLatency;
    case "transferred":
      return call.transferred ? 1 : 0;
  }
}

function compareCalls(a: AdminCallTableRow, b: AdminCallTableRow, sort: CallSortState) {
  const aValue = getSortValue(a, sort.key);
  const bValue = getSortValue(b, sort.key);

  if (typeof aValue === "string" || typeof bValue === "string") {
    const direction = sort.direction === "asc" ? 1 : -1;
    return String(aValue).localeCompare(String(bValue)) * direction;
  }

  const delta = aValue - bValue;
  return sort.direction === "asc" ? delta : -delta;
}

export function filterAndSortCalls(calls: AdminCallTableRow[], state: CallTableState) {
  return calls
    .filter(
      (call) =>
        matchesQuickFilter(call, state.quickFilter) &&
        matchesSearch(call, state.searchQuery),
    )
    .sort((a, b) => compareCalls(a, b, state.sortState));
}

export function clampCallTablePage(page: number, pageCount: number) {
  return Math.min(Math.max(1, page), Math.max(1, pageCount));
}

export function getCallTablePageCount(callCount: number) {
  return Math.max(1, Math.ceil(callCount / CALL_TABLE_PAGE_SIZE));
}

export function getPageForCallIndex(index: number) {
  return Math.floor(index / CALL_TABLE_PAGE_SIZE) + 1;
}

export function getCallListNavigation(
  calls: AdminCallTableRow[],
  state: CallTableState,
  currentCallId: string,
) {
  const orderedCalls = filterAndSortCalls(calls, state);
  const currentIndex = orderedCalls.findIndex(
    (call) => call.id === currentCallId || call.callId === currentCallId,
  );

  if (currentIndex < 0) {
    return {
      currentIndex: -1,
      currentPage: state.page,
      nextCall: null,
      orderedCalls,
      previousCall: null,
    };
  }

  return {
    currentIndex,
    currentPage: getPageForCallIndex(currentIndex),
    nextCall: orderedCalls[currentIndex + 1] ?? null,
    orderedCalls,
    previousCall: orderedCalls[currentIndex - 1] ?? null,
  };
}
