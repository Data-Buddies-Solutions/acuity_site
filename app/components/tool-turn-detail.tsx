"use client";

import { useState } from "react";
import type { ToolCallRecord } from "@/lib/types";
import { formatLatencyMs } from "@/lib/format";
import { CopyButton } from "@/app/components/copy-button";

function formatToolLabel(name: string): string {
  switch (name) {
    case "book_appt":
      return "Book";
    case "confirm_appt":
      return "Confirm";
    case "cancel_appt":
      return "Cancel";
    case "transfer_call":
      return "Transfer";
    default:
      return name.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

function CollapsibleJson({
  label,
  content,
  defaultOpen,
  isError,
}: {
  label: string;
  content: string;
  defaultOpen?: boolean;
  isError?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const formatted = formatJson(content);

  return (
    <div className="mt-2">
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <svg
            className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {label}
        </button>
        {open && <CopyButton text={formatted} />}
      </div>
      {open && (
        <pre
          className={`mt-1 overflow-x-auto rounded border p-2 text-xs ${
            isError
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400"
              : "border-gray-200 bg-white text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
          }`}
        >
          {formatted}
        </pre>
      )}
    </div>
  );
}

function ToolBlock({ tc }: { tc: ToolCallRecord }) {
  return (
    <div>
      {/* Header: name + status + latency */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`text-xs font-semibold ${
            tc.isError
              ? "text-red-600 dark:text-red-400"
              : "text-gray-700 dark:text-gray-300"
          }`}
        >
          {tc.isError ? "\u2717" : "\u2713"} {formatToolLabel(tc.name)}
        </span>
        {tc.durationMs > 0 && (
          <span className="rounded border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400">
            Exec {formatLatencyMs(tc.durationMs)}
          </span>
        )}
      </div>

      {/* Request (tool args) */}
      {tc.args && <CollapsibleJson label="Request" content={tc.args} />}

      {/* Response (tool result) */}
      {tc.result && (
        <CollapsibleJson
          label={tc.isError ? "Error" : "Response"}
          content={tc.result}
          defaultOpen={tc.isError}
          isError={tc.isError}
        />
      )}
    </div>
  );
}

export function ToolTurnDetail({ toolCalls }: { toolCalls: ToolCallRecord[] }) {
  if (toolCalls.length === 0) return null;

  return (
    <div className="my-1 max-w-full rounded-md bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 px-3 py-2 sm:max-w-[80%]">
      <div className="space-y-2">
        {toolCalls.map((tc, i) => (
          <ToolBlock key={i} tc={tc} />
        ))}
      </div>
    </div>
  );
}
