"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PracticeProviderDraft } from "@/lib/practice-workspace";

import { PortalInputField } from "../PortalFields";
import { saveProviderSetupAction } from "../actions";

function emptyProviderDraft(): PracticeProviderDraft {
  return {
    providerHours: "",
    providerLocation: "",
    providerName: "",
    providerNpi: "",
    providerSchedulingNotes: "",
    providerSpecialty: "",
  };
}

function normalizeInitialProviders(providers: PracticeProviderDraft[]) {
  return providers.length ? providers : [emptyProviderDraft()];
}

export default function ProviderSetupForm({
  allowEmptyProviders = false,
  backHref,
  initialProviders,
  locationNames,
  submitLabel = "Save and continue",
}: Readonly<{
  allowEmptyProviders?: boolean;
  backHref: string;
  initialProviders: PracticeProviderDraft[];
  locationNames: string[];
  submitLabel?: string;
}>) {
  const [providers, setProviders] = useState(() =>
    normalizeInitialProviders(initialProviders).map((provider, index) => ({
      ...provider,
      rowKey: provider.id || `provider-${index}`,
    })),
  );
  const [nextProviderIndex, setNextProviderIndex] = useState(providers.length);
  const locationOptions = Array.from(new Set(locationNames.filter(Boolean)));

  return (
    <form action={saveProviderSetupAction} className="space-y-4">
      {providers.map((provider, index) => (
        <div
          key={provider.rowKey}
          className="rounded-[1.4rem] border border-black/6 bg-[#f7fbfa] p-4"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[#10272c]">Provider {index + 1}</p>
            {providers.length > 1 || allowEmptyProviders ? (
              <Button
                size="sm"
                type="button"
                variant="secondary"
                onClick={() =>
                  setProviders((current) =>
                    current.filter((candidate) => candidate.rowKey !== provider.rowKey),
                  )
                }
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Remove
              </Button>
            ) : null}
          </div>

          <input name="providerId" type="hidden" value={provider.id || ""} />
          <div className="grid gap-4 md:grid-cols-2">
            <PortalInputField
              defaultValue={provider.providerName}
              label="Provider name"
              name="providerName"
              placeholder="Dr. Jane Doe"
              required
            />
            <PortalInputField
              defaultValue={provider.providerSpecialty}
              label="Specialty"
              name="providerSpecialty"
              placeholder="Comprehensive ophthalmology"
            />
            <PortalInputField
              defaultValue={provider.providerNpi}
              label="NPI"
              name="providerNpi"
              placeholder="1234567890"
            />
            <label className="block space-y-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#6a7b7e]">
                Primary location
              </span>
              <select
                className="w-full rounded-[1.15rem] border border-black/8 bg-[#fbfdfc] px-4 py-3 text-sm text-[#10272c] outline-none transition focus:border-[#0d7377] focus:ring-2 focus:ring-[#0d7377]/12"
                defaultValue={provider.providerLocation}
                name="providerLocation"
              >
                <option value="">Select location</option>
                {provider.providerLocation &&
                !locationOptions.includes(provider.providerLocation) ? (
                  <option value={provider.providerLocation}>
                    {provider.providerLocation}
                  </option>
                ) : null}
                {locationOptions.map((locationName) => (
                  <option key={locationName} value={locationName}>
                    {locationName}
                  </option>
                ))}
              </select>
            </label>
            <PortalInputField
              defaultValue={provider.providerHours}
              label="Hours"
              name="providerHours"
              placeholder="Mon-Thu 8a-5p, Fri 8a-1p"
            />
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setProviders((current) => [
            ...current,
            {
              ...emptyProviderDraft(),
              rowKey: `provider-${nextProviderIndex}`,
            },
          ]);
          setNextProviderIndex((current) => current + 1);
        }}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add provider
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild variant="secondary">
          <Link href={backHref}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Link>
        </Button>
        <Button type="submit" variant="primary">
          {submitLabel}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}
