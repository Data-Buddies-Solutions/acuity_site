import { describe, expect, it } from "bun:test";

import {
  buildPortalAgentCallScopeWhere,
  canAccessPortalLocation,
  filterPortalPhoneNumbersForAccess,
  type PortalPracticeAccessContext,
} from "@/lib/portal-access";

function contextFor({
  allowedLocationIds,
  hasAllLocationAccess = false,
}: {
  allowedLocationIds: string[];
  hasAllLocationAccess?: boolean;
}) {
  const phoneNumbers = [
    { locationId: "spring", phoneNumber: "+17275919997" },
    { locationId: "hollywood", phoneNumber: "+19542872010" },
    { locationId: "sweetwater", phoneNumber: "+17864654836" },
    { locationId: null, phoneNumber: "+18005550199" },
  ];

  return {
    allowedLocationIds,
    allowedPhoneNumbers: hasAllLocationAccess
      ? phoneNumbers
      : phoneNumbers.filter(
          (phone) => phone.locationId && allowedLocationIds.includes(phone.locationId),
        ),
    hasAllLocationAccess,
  } as unknown as PortalPracticeAccessContext;
}

describe("portal access scoping", () => {
  it("filters phone numbers to the selected membership locations", () => {
    const context = contextFor({
      allowedLocationIds: ["hollywood", "sweetwater"],
    });

    expect(
      filterPortalPhoneNumbersForAccess(context, [
        { label: "Spring Hill", locationId: "spring", phoneNumber: "+17275919997" },
        { label: "Hollywood", locationId: "hollywood", phoneNumber: "+19542872010" },
        { label: "Shared", locationId: null, phoneNumber: "+18005550199" },
      ]),
    ).toEqual([
      { label: "Hollywood", locationId: "hollywood", phoneNumber: "+19542872010" },
    ]);
  });

  it("adds both location and phone safeguards for legacy call rows", () => {
    const where = buildPortalAgentCallScopeWhere(
      contextFor({ allowedLocationIds: ["spring"] }),
    );

    expect(where).toEqual({
      OR: [
        { locationId: { in: ["spring"] } },
        { officePhone: { in: ["7275919997", "17275919997", "+17275919997"] } },
      ],
    });
  });

  it("does not grant null-location rows to selected-location users", () => {
    const scoped = contextFor({ allowedLocationIds: ["spring"] });
    const all = contextFor({ allowedLocationIds: [], hasAllLocationAccess: true });

    expect(canAccessPortalLocation(scoped, null)).toBe(false);
    expect(canAccessPortalLocation(scoped, "spring")).toBe(true);
    expect(canAccessPortalLocation(scoped, "sweetwater")).toBe(false);
    expect(canAccessPortalLocation(all, null)).toBe(true);
  });
});
