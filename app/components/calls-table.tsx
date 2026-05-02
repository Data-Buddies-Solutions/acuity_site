"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Check } from "lucide-react";

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
import { formatDuration, formatLatencyMs, formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

type QuickFilter =
  | "all"
  | "booking"
  | "errors"
  | "fallback"
  | "needs_review"
  | "transfers";
type SortKey =
  | "actions"
  | "durationSec"
  | "office"
  | "review"
  | "startedAt"
  | "totalLatency"
  | "transferred";
type SortState = { direction: "asc" | "desc"; key: SortKey };

const pageSize = 15;
const quickFilters: { id: QuickFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "booking", label: "Booked" },
  { id: "needs_review", label: "Needs Review" },
  { id: "transfers", label: "Transfers" },
  { id: "fallback", label: "Fallback" },
  { id: "errors", label: "Errors" },
];

const localTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "America/New_York",
});

function normalizeSearchValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function formatLocalTime(value: string) {
  return localTimeFormatter.format(new Date(value));
}

function formatReviewScore(score: number | null): string {
  return score === null ? "--" : `${score.toFixed(1)}/5`;
}

function getOfficeLabel(call: AdminCallTableRow) {
  return call.officeName || formatPhone(call.officePhone) || "Unknown office";
}

function getOfficeSubLabel(call: AdminCallTableRow) {
  return call.officeName && call.officePhone ? formatPhone(call.officePhone) : "";
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
  practiceId,
  showFallback,
  showToolErrors,
}: {
  call: AdminCallTableRow;
  practiceId: string;
  showFallback: boolean;
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
          <Link
            href={`/admin/practices/${practiceId}/calls/${call.id}`}
            className="font-medium hover:underline"
          >
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
              <p className="truncate">{getOfficeLabel(call)}</p>
              {getOfficeSubLabel(call) ? (
                <p className="truncate text-xs font-normal text-muted-foreground">
                  {getOfficeSubLabel(call)}
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
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {getReviewBadge(call)}
          {call.reviewStatus === "completed" && (
            <Badge variant="outline" className="text-[10px]">
              Score {formatReviewScore(call.reviewAverageScore)}
            </Badge>
          )}
          {call.transferred && (
            <Badge variant="outline" className="text-[10px]">
              Transfer
            </Badge>
          )}
          {call.fallbackUsed && (
            <Badge variant="destructive" className="text-[10px]">
              Fallback
            </Badge>
          )}
          {call.toolErrors > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {call.toolErrors} error{call.toolErrors === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
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
  onSort: (key: SortKey) => void;
  sortKey: SortKey;
  sortState: SortState;
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

function getSortValue(call: AdminCallTableRow, key: SortKey) {
  switch (key) {
    case "actions":
      return call.toolActions.length;
    case "durationSec":
      return call.durationSec;
    case "office":
      return getOfficeLabel(call);
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

function compareCalls(a: AdminCallTableRow, b: AdminCallTableRow, sort: SortState) {
  const aValue = getSortValue(a, sort.key);
  const bValue = getSortValue(b, sort.key);
  if (typeof aValue === "string" || typeof bValue === "string") {
    const direction = sort.direction === "asc" ? 1 : -1;
    return String(aValue).localeCompare(String(bValue)) * direction;
  }

  const delta = aValue - bValue;

  return sort.direction === "asc" ? delta : -delta;
}

export function CallsTable({
  calls,
  practiceId,
}: {
  calls: AdminCallTableRow[];
  practiceId: string;
}) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [quickFilter, setQuickFilter] = React.useState<QuickFilter>("all");
  const [sortState, setSortState] = React.useState<SortState>({
    direction: "desc",
    key: "startedAt",
  });
  const [page, setPage] = React.useState(0);

  const normalizedQuery = React.useMemo(
    () => normalizeSearchValue(searchQuery),
    [searchQuery],
  );
  const showFallback = React.useMemo(
    () => calls.some((call) => call.fallbackUsed),
    [calls],
  );
  const showToolErrors = React.useMemo(
    () => calls.some((call) => call.toolErrors > 0),
    [calls],
  );

  const filteredCalls = React.useMemo(() => {
    const phoneQuery = normalizeDigits(searchQuery);

    return calls
      .filter((call) => {
        if (quickFilter === "booking" && !call.apptActions.includes("Booked")) {
          return false;
        }
        if (quickFilter === "errors" && call.toolErrors === 0) {
          return false;
        }
        if (quickFilter === "fallback" && !call.fallbackUsed) {
          return false;
        }
        if (quickFilter === "needs_review" && !call.reviewNeedsAttention) {
          return false;
        }
        if (quickFilter === "transfers" && !call.transferred) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        const searchableValues = [
          call.callId,
          call.callerPhone,
          formatPhone(call.callerPhone),
          call.llmModel,
          call.officePhone,
          formatPhone(call.officePhone),
          getOfficeLabel(call),
          call.toolActions.join(" "),
          call.transcriptText,
        ];

        if (
          phoneQuery &&
          searchableValues.some((value) => normalizeDigits(value).includes(phoneQuery))
        ) {
          return true;
        }

        return searchableValues.some((value) =>
          normalizeSearchValue(value).includes(normalizedQuery),
        );
      })
      .sort((a, b) => compareCalls(a, b, sortState));
  }, [calls, normalizedQuery, quickFilter, searchQuery, sortState]);

  React.useEffect(() => {
    setPage(0);
  }, [normalizedQuery, quickFilter, sortState]);

  if (calls.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No calls in this time range.
      </p>
    );
  }

  const visibleQuickFilters = quickFilters.filter((filter) => {
    if (filter.id === "errors") return showToolErrors;
    if (filter.id === "fallback") return showFallback;
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filteredCalls.length / pageSize));
  const pageIndex = Math.min(page, pageCount - 1);
  const pageRows = filteredCalls.slice(
    pageIndex * pageSize,
    pageIndex * pageSize + pageSize,
  );
  const tableColumnCount = 10 + (showToolErrors ? 1 : 0) + (showFallback ? 1 : 0);

  function handleSort(key: SortKey) {
    setSortState((current) =>
      current.key === key
        ? {
            direction: current.direction === "asc" ? "desc" : "asc",
            key,
          }
        : { direction: "desc", key },
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
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
            onClick={() => setQuickFilter(filter.id)}
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
                practiceId={practiceId}
                showFallback={showFallback}
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
                <TableHead>
                  <SortButton sortKey="review" sortState={sortState} onSort={handleSort}>
                    Review
                  </SortButton>
                </TableHead>
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
                      <Link
                        href={`/admin/practices/${practiceId}/calls/${call.id}`}
                        className="whitespace-nowrap hover:underline"
                      >
                        {formatLocalTime(call.startedAt)}
                      </Link>
                    </TableCell>
                    <TableCell>{formatPhone(call.callerPhone)}</TableCell>
                    <TableCell>
                      <div className="max-w-40">
                        <p className="truncate font-medium">{getOfficeLabel(call)}</p>
                        {getOfficeSubLabel(call) && (
                          <p className="truncate text-xs text-muted-foreground">
                            {getOfficeSubLabel(call)}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{formatDuration(call.durationSec)}</TableCell>
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
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={pageIndex === 0}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
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
