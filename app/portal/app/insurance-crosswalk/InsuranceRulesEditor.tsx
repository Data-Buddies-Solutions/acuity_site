"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PortalCodeTextareaField } from "@/app/portal/app/PortalFields";

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
      <PortalCodeTextareaField
        label="Rules JSON"
        minHeightClassName="min-h-[680px]"
        name="rulesJson"
        onChange={(event) => setRulesJson(event.target.value)}
        required
        value={rulesJson}
      />

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
