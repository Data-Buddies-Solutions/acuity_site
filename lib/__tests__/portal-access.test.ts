import { describe, expect, it } from "bun:test";

import {
  buildPortalAgentCallScopeSql,
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

  it("returns an impossible where clause when a scoped user has no locations or phones", () => {
    const where = buildPortalAgentCallScopeWhere(contextFor({ allowedLocationIds: [] }));

    expect(where).toEqual({ id: { in: [] } });
  });

  it("builds raw SQL scope that mirrors the Prisma-where clauses", () => {
    const all = buildPortalAgentCallScopeSql(
      contextFor({ allowedLocationIds: [], hasAllLocationAccess: true }),
    );
    expect(all.sql).toBe("TRUE");
    expect(all.values).toEqual([]);

    const scoped = buildPortalAgentCallScopeSql(
      contextFor({ allowedLocationIds: ["spring"] }),
    );
    expect(scoped.sql).toBe('("locationId" IN (?) OR "officePhone" IN (?,?,?))');
    expect(scoped.values).toEqual([
      "spring",
      "7275919997",
      "17275919997",
      "+17275919997",
    ]);

    const empty = buildPortalAgentCallScopeSql(contextFor({ allowedLocationIds: [] }));
    expect(empty.sql).toBe("FALSE");
    expect(empty.values).toEqual([]);
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
