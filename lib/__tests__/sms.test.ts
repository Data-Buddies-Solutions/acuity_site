import { describe, expect, it } from "bun:test";

import { filterSmsPhoneNumbersForContext } from "@/lib/sms/service";
import type { PortalPracticeAccessContext } from "@/lib/portal-access";

type SmsPhoneNumber = Parameters<typeof filterSmsPhoneNumbersForContext>[1][number];

function contextFor({
  allowedLocationIds,
  hasAllLocationAccess = false,
  practiceName = "Abita Eye Group",
}: {
  allowedLocationIds: string[];
  hasAllLocationAccess?: boolean;
  practiceName?: string;
}) {
  return {
    allowedLocationIds,
    hasAllLocationAccess,
    practice: {
      id: "practice-1",
      name: practiceName,
    },
    session: {
      user: {
        email: "member@abitaeyegroup.com",
        id: "user-1",
      },
    },
  } as unknown as PortalPracticeAccessContext;
}

function smsPhone({
  id,
  isPrimary,
  locationId,
  locationName,
  phoneNumber,
}: {
  id: string;
  isPrimary: boolean;
  locationId: string | null;
  locationName: string | null;
  phoneNumber: string;
}) {
  return {
    id,
    isPrimary,
    location: locationId ? { id: locationId, name: locationName } : null,
    locationId,
    phoneNumber,
    practice: {
      id: "practice-1",
      name: "Abita Eye Group",
    },
  } as unknown as SmsPhoneNumber;
}

describe("SMS inbox scoping", () => {
  it("uses Abita portal location access instead of email allowlists", () => {
    const context = contextFor({
      allowedLocationIds: ["hollywood-location", "sweetwater-location"],
    });
    const phoneNumbers = [
      smsPhone({
        id: "spring",
        isPrimary: true,
        locationId: "spring-location",
        locationName: "Spring Hill",
        phoneNumber: "+17275919997",
      }),
      smsPhone({
        id: "hollywood",
        isPrimary: true,
        locationId: "hollywood-location",
        locationName: "Hollywood",
        phoneNumber: "+19545550100",
      }),
      smsPhone({
        id: "sweetwater",
        isPrimary: true,
        locationId: "sweetwater-location",
        locationName: "Sweetwater",
        phoneNumber: "+17865550100",
      }),
      smsPhone({
        id: "optical",
        isPrimary: true,
        locationId: "optical-location",
        locationName: "North Miami Beach Optical",
        phoneNumber: "+13055550100",
      }),
    ];

    expect(
      filterSmsPhoneNumbersForContext(context, phoneNumbers).map((phone) => phone.id),
    ).toEqual(["hollywood", "sweetwater"]);
  });
});
