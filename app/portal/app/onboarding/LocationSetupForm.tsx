"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PracticeLocationDraft } from "@/lib/practice-workspace";

import { PortalInputField } from "../PortalFields";
import { savePracticeBasicsAction } from "../actions";

function emptyLocationDraft(): PracticeLocationDraft {
  return {
    address: "",
    fax: "",
    hours: "",
    insuranceNotes: "",
    insuranceVaries: false,
    knowledgeNotes: "",
    knowledgeVaries: false,
    locationName: "",
    phone: "",
  };
}

function normalizeInitialLocations(locations: PracticeLocationDraft[]) {
  return locations.length ? locations : [emptyLocationDraft()];
}

export default function LocationSetupForm({
  backHref,
  initialLocations,
  practiceName,
  submitLabel = "Save and continue",
}: Readonly<{
  backHref?: string;
  initialLocations: PracticeLocationDraft[];
  practiceName: string;
  submitLabel?: string;
}>) {
  const [locations, setLocations] = useState(() =>
    normalizeInitialLocations(initialLocations).map((location, index) => ({
      ...location,
      rowKey: location.id || `location-${index}`,
    })),
  );
  const [nextLocationIndex, setNextLocationIndex] = useState(locations.length);

  return (
    <form action={savePracticeBasicsAction} className="space-y-4">
      <PortalInputField
        defaultValue={practiceName}
        label="Practice name"
        name="practiceName"
        placeholder="North Miami Beach Eye Center"
        required
      />

      {locations.map((location, index) => (
        <div
          key={location.rowKey}
          className="rounded-[1.4rem] border border-black/6 bg-[#f7fbfa] p-4"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[#10272c]">Location {index + 1}</p>
            {locations.length > 1 ? (
              <Button
                size="sm"
                type="button"
                variant="secondary"
                onClick={() =>
                  setLocations((current) =>
                    current.filter((candidate) => candidate.rowKey !== location.rowKey),
                  )
                }
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Remove
              </Button>
            ) : null}
          </div>

          <input name="locationId" type="hidden" value={location.id || ""} />
          <input name="insuranceVaries" type="hidden" value="false" />
          <input name="knowledgeVaries" type="hidden" value="false" />
          <input name="insuranceNotes" type="hidden" value={location.insuranceNotes} />
          <input name="knowledgeNotes" type="hidden" value={location.knowledgeNotes} />

          <div className="grid gap-4 md:grid-cols-2">
            <PortalInputField
              defaultValue={location.locationName}
              label="Location name"
              name="locationName"
              placeholder="Main office"
              required
            />
            <PortalInputField
              defaultValue={location.phone}
              label="Phone"
              name="phone"
              placeholder="(305) 555-0184"
              required
              type="tel"
            />
            <PortalInputField
              defaultValue={location.fax}
              label="Fax"
              name="fax"
              placeholder="(305) 555-0110"
              type="tel"
            />
            <PortalInputField
              defaultValue={location.hours}
              label="Hours"
              name="hours"
              placeholder="Mon-Thu 8a-5p, Fri 8a-1p"
            />
            <div className="md:col-span-2">
              <PortalInputField
                defaultValue={location.address}
                label="Address"
                name="address"
                placeholder="123 Main St, Suite 200"
                required
              />
            </div>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setLocations((current) => [
            ...current,
            {
              ...emptyLocationDraft(),
              rowKey: `location-${nextLocationIndex}`,
            },
          ]);
          setNextLocationIndex((current) => current + 1);
        }}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add location
      </Button>

      <div
        className={`flex flex-col gap-3 sm:flex-row sm:items-center ${
          backHref ? "sm:justify-between" : "sm:justify-end"
        }`}
      >
        {backHref ? (
          <Button asChild variant="secondary">
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Link>
          </Button>
        ) : null}
        <Button type="submit" variant="primary">
          {submitLabel}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}
