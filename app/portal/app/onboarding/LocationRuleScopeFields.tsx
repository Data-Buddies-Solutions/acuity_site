"use client";

import { useState } from "react";

import type { PracticeLocationDraft } from "@/lib/practice-workspace";

import { PortalTextareaField } from "../PortalFields";

export default function LocationRuleScopeFields({
  byLocationLabel,
  defaultByLocation,
  locationNotesKey,
  locations,
  placeholder,
  scopeName,
  sectionTitle,
  sharedLabel,
  variesKey,
}: Readonly<{
  byLocationLabel: string;
  defaultByLocation: boolean;
  locationNotesKey: "insuranceNotes" | "knowledgeNotes";
  locations: PracticeLocationDraft[];
  placeholder: string;
  scopeName: "insuranceRulesScope" | "knowledgeRulesScope";
  sectionTitle: string;
  sharedLabel: string;
  variesKey: "insuranceVaries" | "knowledgeVaries";
}>) {
  const [usesLocationRules, setUsesLocationRules] = useState(defaultByLocation);

  if (locations.length <= 1) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-[1.4rem] border border-black/6 bg-[#f7fbfa] p-4">
      <p className="text-sm font-semibold text-[#10272c]">{sectionTitle}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-start gap-3 rounded-[1rem] border border-black/6 bg-white px-4 py-3 text-sm text-[#10272c]">
          <input
            className="mt-1 h-4 w-4 accent-[#0d7377]"
            checked={!usesLocationRules}
            name={scopeName}
            type="radio"
            value="shared"
            onChange={() => setUsesLocationRules(false)}
          />
          <span>{sharedLabel}</span>
        </label>
        <label className="flex items-start gap-3 rounded-[1rem] border border-black/6 bg-white px-4 py-3 text-sm text-[#10272c]">
          <input
            className="mt-1 h-4 w-4 accent-[#0d7377]"
            checked={usesLocationRules}
            name={scopeName}
            type="radio"
            value="byLocation"
            onChange={() => setUsesLocationRules(true)}
          />
          <span>{byLocationLabel}</span>
        </label>
      </div>

      {usesLocationRules ? (
        <div className="space-y-3 pt-1">
          {locations.map((location) => (
            <div
              key={location.id || location.locationName}
              className="rounded-[1rem] border border-black/6 bg-white p-4"
            >
              <input name="locationId" type="hidden" value={location.id || ""} />
              <input name="locationName" type="hidden" value={location.locationName} />
              <input name={variesKey} type="hidden" value="true" />
              <PortalTextareaField
                defaultValue={location[locationNotesKey]}
                label={`${location.locationName} notes`}
                name={locationNotesKey}
                placeholder={placeholder}
                rows={3}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
