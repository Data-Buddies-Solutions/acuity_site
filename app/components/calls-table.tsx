"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Languages,
  Star,
  ThumbsDown,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminCallTableRow } from "@/lib/admin-analytics";
import {
  CALL_TABLE_PAGE_SIZE,
  callQuickFilters,
  clampCallTablePage,
  filterAndSortCalls,
  getCallOfficeLabel,
  getCallOfficeSubLabel,
  getCallTablePageCount,
  hasLanguageSignal,
  parseCallTableState,
  writeCallTableStateToParams,
  type CallQuickFilter,
  type CallSortKey,
  type CallSortState,
  type CallTableState,
} from "@/lib/admin-call-table-state";
import { formatDuration, formatLatencyMs, formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

const localTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "America/New_York",
});

function languageDisplayValue(call: AdminCallTableRow): string {
  return call.currentLanguage?.toUpperCase() || "Changed";
}

function formatLocalTime(value: string) {
  return localTimeFormatter.format(new Date(value));
}

function formatReviewScore(score: number | null): string {
  return score === null ? "--" : `${score.toFixed(1)}/5`;
}

function getReviewBadge(call: AdminCallTableRow) {
  if (call.reviewStatus === "failed") {
    return (
      <Badge variant="destructive" className="gap-1 text-[10px]">
        <AlertTriangle className="h-3 w-3" />
        Review failed
      </Badge>
    );
  }

  if (call.reviewStatus === "pending") {
    return (
      <Badge variant="outline" className="text-[10px]">
        Pending
      </Badge>
    );
  }

  if (call.reviewStatus !== "completed") {
    return <span className="text-muted-foreground">--</span>;
  }

  if (call.reviewNeedsAttention) {
    return (
      <Badge variant="destructive" className="gap-1 text-[10px]">
        <AlertTriangle className="h-3 w-3" />
        Needs review
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="text-[10px]">
      OK
    </Badge>
  );
}

function getEvaluationBadge(call: AdminCallTableRow) {
  if (call.evaluationBucket === "GOLDEN") {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px]">
        <Star className="h-3 w-3 fill-current" />
        Golden
      </Badge>
    );
  }

  if (call.evaluationBucket === "BAD") {
    return (
      <Badge variant="destructive" className="gap-1 text-[10px]">
        <ThumbsDown className="h-3 w-3" />
        Bad
      </Badge>
    );
  }

  return null;
}

function formatLatencyValue(value: number) {
  return value > 0 ? formatLatencyMs(value) : "--";
}

function MobileField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-background/70 px-3 py-2">
      <p className="text-[10px] font-medium uppercase text-muted-foreground">{label}</p>
      <div className="mt-1 min-w-0 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function MobileCallCard({
  call,
  callHref,
  showFallback,
  showLanguage,
  showReview,
  showRuntimeEvents,
  showToolErrors,
}: {
  call: AdminCallTableRow;
  callHref: string;
  showFallback: boolean;
  showLanguage: boolean;
  showReview: boolean;
  showRuntimeEvents: boolean;
  showToolErrors: boolean;
}) {
  const actionBadges =
    call.toolActions.length > 0 ? (
      call.toolActions.map((action) => (
        <Badge key={action} variant="secondary" className="text-[10px]">
          {action}
        </Badge>
      ))
    ) : (
      <span className="text-sm text-muted-foreground">No actions</span>
    );

  return (
    <article className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={callHref} className="font-medium hover:underline">
            {formatLocalTime(call.startedAt)}
          </Link>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatPhone(call.callerPhone)}
          </p>
        </div>
        <div className="shrink-0 text-right text-sm">
          <p className="font-medium">{formatDuration(call.durationSec)}</p>
          <p className="text-muted-foreground">
            {formatLatencyValue(call.p50TotalLatency)} total
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MobileField
          label="Office"
          value={
            <div className="min-w-0">
              <p className="truncate">{getCallOfficeLabel(call)}</p>
              {getCallOfficeSubLabel(call) ? (
                <p className="truncate text-xs font-normal text-muted-foreground">
                  {getCallOfficeSubLabel(call)}
                </p>
              ) : null}
            </div>
          }
        />
        <MobileField label="Duration" value={formatDuration(call.durationSec)} />
        <MobileField label="P50 TTFT" value={formatLatencyValue(call.p50Ttft)} />
        <MobileField label="P50 TTS" value={formatLatencyValue(call.p50Ttsttfb)} />
        <MobileField label="P50 Total" value={formatLatencyValue(call.p50TotalLatency)} />
        <MobileField label="Transfer" value={call.transferred ? "Yes" : "No"} />
        {showToolErrors ? (
          <MobileField
            label="Tool Errors"
            value={
              call.toolErrors > 0 ? (
                <Badge variant="destructive" className="text-xs">
                  {call.toolErrors}
                </Badge>
              ) : (
                "0"
              )
            }
          />
        ) : null}
        {showFallback ? (
          <MobileField label="Fallback" value={call.fallbackUsed ? "Used" : "No"} />
        ) : null}
        {showLanguage ? (
          <MobileField
            label="Language"
            value={
              call.languageChanged
                ? `${call.currentLanguage ?? "changed"}`
                : (call.currentLanguage ?? "No change")
            }
          />
        ) : null}
        {showRuntimeEvents ? (
          <MobileField
            label="Runtime"
            value={
              call.runtimeErrorCount > 0 ||
              call.falseInterruptionCount > 0 ||
              call.overlappingSpeechCount > 0
                ? `${call.runtimeErrorCount} err / ${call.falseInterruptionCount} false / ${call.overlappingSpeechCount} overlap`
                : "Clean"
            }
          />
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {getEvaluationBadge(call)}
          {showReview && getReviewBadge(call)}
          {showReview && call.reviewStatus === "completed" && (
            <Badge variant="outline" className="text-[10px]">
              Score {formatReviewScore(call.reviewAverageScore)}
            </Badge>
          )}
          {call.transferred && (
            <Badge variant="outline" className="text-[10px]">
              Transfer
            </Badge>
          )}
          {showFallback && call.fallbackUsed && (
            <Badge variant="destructive" className="text-[10px]">
              Fallback
            </Badge>
          )}
          {call.toolErrors > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {call.toolErrors} error{call.toolErrors === 1 ? "" : "s"}
            </Badge>
          )}
          {hasLanguageSignal(call) && (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Languages className="h-3 w-3" />
              {languageDisplayValue(call)}
            </Badge>
          )}
          {showRuntimeEvents && call.runtimeErrorCount > 0 && (
            <Badge variant="destructive" className="gap-1 text-[10px]">
              <AlertTriangle className="h-3 w-3" />
              Runtime
            </Badge>
          )}
        </div>
        {call.evaluationComment ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {call.evaluationComment}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1.5">{actionBadges}</div>
      </div>
    </article>
  );
}

function SortButton({
  children,
  sortKey,
  sortState,
  onSort,
}: {
  children: React.ReactNode;
  onSort: (key: CallSortKey) => void;
  sortKey: CallSortKey;
  sortState: CallSortState;
}) {
  const Icon =
    sortState.key !== sortKey
      ? ArrowUpDown
      : sortState.direction === "asc"
        ? ArrowUp
        : ArrowDown;

  return (
    <Button variant="ghost" className="-ml-4" onClick={() => onSort(sortKey)}>
      {children}
      <Icon className="ml-1 h-3 w-3" />
    </Button>
  );
}

export function CallsTable({
  calls,
  practiceId,
}: {
  calls: AdminCallTableRow[];
  practiceId: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stateFromUrl = React.useMemo(
    () => parseCallTableState(searchParams),
    [searchParams],
  );
  const stateSignature = `${stateFromUrl.searchQuery}|${stateFromUrl.quickFilter}|${stateFromUrl.sortState.key}|${stateFromUrl.sortState.direction}|${stateFromUrl.page}`;
  const [searchQuery, setSearchQuery] = React.useState(stateFromUrl.searchQuery);
  const [quickFilter, setQuickFilter] = React.useState<CallQuickFilter>(
    stateFromUrl.quickFilter,
  );
  const [sortState, setSortState] = React.useState<CallSortState>(stateFromUrl.sortState);
  const [page, setPage] = React.useState(stateFromUrl.page);
  const showFallback = false;
  const showReview = false;
  const showLanguage = React.useMemo(
    () => calls.some((call) => hasLanguageSignal(call)),
    [calls],
  );
  const showRuntimeEvents = false;
  const showToolErrors = React.useMemo(
    () => calls.some((call) => call.toolErrors > 0),
    [calls],
  );

  React.useEffect(() => {
    setSearchQuery(stateFromUrl.searchQuery);
    setQuickFilter(stateFromUrl.quickFilter);
    setSortState(stateFromUrl.sortState);
    setPage(stateFromUrl.page);
  }, [stateFromUrl, stateSignature]);

  const tableState = React.useMemo<CallTableState>(
    () => ({
      page,
      quickFilter,
      searchQuery,
      sortState,
    }),
    [page, quickFilter, searchQuery, sortState],
  );

  const filteredCalls = React.useMemo(
    () => filterAndSortCalls(calls, tableState),
    [calls, tableState],
  );

  if (calls.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No calls in this time range.
      </p>
    );
  }

  const visibleQuickFilters = callQuickFilters.filter((filter) => {
    if (filter.id === "errors") return showToolErrors;
    if (filter.id === "fallback") return showFallback;
    if (filter.id === "language") return showLanguage;
    if (filter.id === "runtime") return showRuntimeEvents;
    if (filter.id === "needs_review") return showReview;
    return true;
  });
  const pageCount = getCallTablePageCount(filteredCalls.length);
  const activePage = clampCallTablePage(page, pageCount);
  const pageIndex = activePage - 1;
  const pageRows = filteredCalls.slice(
    pageIndex * CALL_TABLE_PAGE_SIZE,
    pageIndex * CALL_TABLE_PAGE_SIZE + CALL_TABLE_PAGE_SIZE,
  );
  const tableColumnCount =
    9 +
    (showReview ? 1 : 0) +
    (showToolErrors ? 1 : 0) +
    (showFallback ? 1 : 0) +
    (showLanguage ? 1 : 0) +
    (showRuntimeEvents ? 1 : 0);

  function replaceTableUrl(nextState: CallTableState) {
    const params = new URLSearchParams(searchParams.toString());
    writeCallTableStateToParams(params, nextState);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  }

  function updateTableState(nextState: CallTableState) {
    setSearchQuery(nextState.searchQuery);
    setQuickFilter(nextState.quickFilter);
    setSortState(nextState.sortState);
    setPage(nextState.page);
    replaceTableUrl(nextState);
  }

  function getCallHref(callId: string) {
    const params = new URLSearchParams(searchParams.toString());
    writeCallTableStateToParams(params, {
      ...tableState,
      page: activePage,
    });
    const query = params.toString();
    return `/admin/practices/${practiceId}/calls/${callId}${query ? `?${query}` : ""}`;
  }

  function handleSort(key: CallSortKey) {
    const nextSortState: CallSortState =
      sortState.key === key
        ? {
            direction: sortState.direction === "asc" ? "desc" : "asc",
            key,
          }
        : { direction: "desc" as const, key };

    updateTableState({
      page: 1,
      quickFilter,
      searchQuery,
      sortState: nextSortState,
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={searchQuery}
          onChange={(event) =>
            updateTableState({
              page: 1,
              quickFilter,
              searchQuery: event.target.value,
              sortState,
            })
          }
          placeholder="Search calls"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 sm:max-w-sm"
          aria-label="Search calls"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {visibleQuickFilters.map((filter) => (
          <Button
            key={filter.id}
            variant={quickFilter === filter.id ? "secondary" : "outline"}
            size="sm"
            onClick={() =>
              updateTableState({
                page: 1,
                quickFilter: filter.id,
                searchQuery,
                sortState,
              })
            }
          >
            {filter.label}
          </Button>
        ))}
      </div>

      <div className="rounded-lg border">
        <div className="divide-y md:hidden">
          {pageRows.length > 0 ? (
            pageRows.map((call) => (
              <MobileCallCard
                key={call.id}
                call={call}
                callHref={getCallHref(call.id)}
                showFallback={showFallback}
                showLanguage={showLanguage}
                showReview={showReview}
                showRuntimeEvents={showRuntimeEvents}
                showToolErrors={showToolErrors}
              />
            ))
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No results.
            </div>
          )}
        </div>

        <div className="hidden md:block">
          <Table className="min-w-[1080px]">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortButton
                    sortKey="startedAt"
                    sortState={sortState}
                    onSort={handleSort}
                  >
                    Date & Time
                  </SortButton>
                </TableHead>
                <TableHead>Caller</TableHead>
                <TableHead>
                  <SortButton sortKey="office" sortState={sortState} onSort={handleSort}>
                    Office
                  </SortButton>
                </TableHead>
                <TableHead>
                  <SortButton
                    sortKey="durationSec"
                    sortState={sortState}
                    onSort={handleSort}
                  >
                    Duration
                  </SortButton>
                </TableHead>
                {showReview && (
                  <TableHead>
                    <SortButton
                      sortKey="review"
                      sortState={sortState}
                      onSort={handleSort}
                    >
                      Review
                    </SortButton>
                  </TableHead>
                )}
                {showToolErrors && <TableHead>Tool Errors</TableHead>}
                <TableHead>P50 TTFT</TableHead>
                <TableHead>P50 TTS</TableHead>
                <TableHead>
                  <SortButton
                    sortKey="totalLatency"
                    sortState={sortState}
                    onSort={handleSort}
                  >
                    P50 Total
                  </SortButton>
                </TableHead>
                <TableHead>
                  <SortButton sortKey="actions" sortState={sortState} onSort={handleSort}>
                    Actions
                  </SortButton>
                </TableHead>
                {showLanguage && <TableHead>Language</TableHead>}
                {showRuntimeEvents && <TableHead>Runtime</TableHead>}
                <TableHead>
                  <SortButton
                    sortKey="transferred"
                    sortState={sortState}
                    onSort={handleSort}
                  >
                    Transfer
                  </SortButton>
                </TableHead>
                {showFallback && <TableHead>Fallback</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length > 0 ? (
                pageRows.map((call) => (
                  <TableRow key={call.id}>
                    <TableCell>
                      <div className="space-y-1.5">
                        <Link
                          href={getCallHref(call.id)}
                          className="whitespace-nowrap hover:underline"
                        >
                          {formatLocalTime(call.startedAt)}
                        </Link>
                        {getEvaluationBadge(call)}
                        {call.evaluationComment ? (
                          <p className="max-w-56 truncate text-xs text-muted-foreground">
                            {call.evaluationComment}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{formatPhone(call.callerPhone)}</TableCell>
                    <TableCell>
                      <div className="max-w-40">
                        <p className="truncate font-medium">{getCallOfficeLabel(call)}</p>
                        {getCallOfficeSubLabel(call) && (
                          <p className="truncate text-xs text-muted-foreground">
                            {getCallOfficeSubLabel(call)}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{formatDuration(call.durationSec)}</TableCell>
                    {showReview && (
                      <TableCell>
                        <div className="space-y-1">
                          {getReviewBadge(call)}
                          {call.reviewStatus === "completed" && (
                            <p className="text-xs font-medium tabular-nums text-foreground">
                              {formatReviewScore(call.reviewAverageScore)}
                            </p>
                          )}
                        </div>
                      </TableCell>
                    )}
                    {showToolErrors && (
                      <TableCell>
                        {call.toolErrors > 0 ? (
                          <Badge variant="destructive" className="text-xs">
                            {call.toolErrors}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      {call.p50Ttft > 0 ? formatLatencyMs(call.p50Ttft) : "--"}
                    </TableCell>
                    <TableCell>
                      {call.p50Ttsttfb > 0 ? formatLatencyMs(call.p50Ttsttfb) : "--"}
                    </TableCell>
                    <TableCell>
                      {call.p50TotalLatency > 0
                        ? formatLatencyMs(call.p50TotalLatency)
                        : "--"}
                    </TableCell>
                    <TableCell>
                      {call.toolActions.length === 0 ? (
                        <span className="text-muted-foreground">--</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {call.toolActions.map((action) => (
                            <Badge
                              key={action}
                              variant="secondary"
                              className="text-[10px]"
                            >
                              {action}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    {showLanguage && (
                      <TableCell>
                        {hasLanguageSignal(call) ? (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <Languages className="h-3 w-3" />
                            {languageDisplayValue(call)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </TableCell>
                    )}
                    {showRuntimeEvents && (
                      <TableCell>
                        {call.runtimeErrorCount > 0 ||
                        call.falseInterruptionCount > 0 ||
                        call.overlappingSpeechCount > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {call.runtimeErrorCount > 0 && (
                              <Badge variant="destructive" className="text-[10px]">
                                {call.runtimeErrorCount} error
                                {call.runtimeErrorCount === 1 ? "" : "s"}
                              </Badge>
                            )}
                            {call.falseInterruptionCount > 0 && (
                              <Badge variant="outline" className="text-[10px]">
                                {call.falseInterruptionCount} false
                              </Badge>
                            )}
                            {call.overlappingSpeechCount > 0 && (
                              <Badge variant="outline" className="text-[10px]">
                                {call.overlappingSpeechCount} overlap
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      {call.transferred ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    {showFallback && (
                      <TableCell>
                        {call.fallbackUsed ? (
                          <Check className="h-4 w-4 text-red-500" />
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={tableColumnCount} className="h-24 text-center">
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {filteredCalls.length} call{filteredCalls.length !== 1 ? "s" : ""}
          {searchQuery || quickFilter !== "all" ? " matching filters" : ""}
        </p>
        {pageCount > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">
              Page {pageIndex + 1} of {pageCount}
            </p>
            <Button
              variant="outline"
              onClick={() =>
                updateTableState({
                  ...tableState,
                  page: Math.max(1, activePage - 1),
                })
              }
              disabled={pageIndex === 0}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                updateTableState({
                  ...tableState,
                  page: Math.min(pageCount, activePage + 1),
                })
              }
              disabled={pageIndex >= pageCount - 1}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
