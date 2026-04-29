"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Button } from "@/app/components/ui/button";

import { saveInsuranceRuleDraftAction } from "./actions";

export function InsuranceRulesEditor({
  defaultRulesJson,
  ruleSetId,
  viewHref,
}: {
  defaultRulesJson: string;
  ruleSetId: string;
  viewHref: string;
}) {
  const [rulesJson, setRulesJson] = useState(defaultRulesJson);
  const jsonError = useMemo(() => {
    try {
      JSON.parse(rulesJson);
      return "";
    } catch {
      return "Invalid JSON";
    }
  }, [rulesJson]);

  return (
    <form action={saveInsuranceRuleDraftAction} className="space-y-4">
      <input type="hidden" name="ruleSetId" value={ruleSetId} />
      <label className="block space-y-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#6a7b7e]">
          Rules JSON
        </span>
        <textarea
          className="min-h-[680px] w-full rounded-[1.15rem] border border-black/8 bg-[#fbfdfc] px-4 py-3 font-mono text-sm leading-6 text-[#10272c] outline-none transition placeholder:text-[#90a0a2] focus:border-[#0d7377] focus:ring-2 focus:ring-[#0d7377]/12"
          name="rulesJson"
          required
          value={rulesJson}
          onChange={(event) => setRulesJson(event.target.value)}
        />
      </label>

      {jsonError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {jsonError}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button disabled={Boolean(jsonError)} type="submit" variant="primary">
          Send for admin review
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button asChild variant="secondary">
          <Link href={viewHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
