import { describe, expect, it } from "bun:test";

import {
  buildCallCenterQueueScopeForProfile,
  getAllowedCallCenterOutboundPhoneNumbersForProfile,
  getCallCenterProfileLocations,
  getCallCenterProfileOutboundCallerNumbers,
  isSpecialAbitaCallCenterContext,
} from "@/lib/call-center-profiles";
import type { PortalPracticeAccessContext } from "@/lib/portal-access";

type TestPhoneNumber = {
  isPrimary: boolean;
  label: string | null;
  locationId: string | null;
  phoneNumber: string;
};

function profileContext({
  allowedPhoneNumbers,
  email,
  locations,
  phoneNumbers = allowedPhoneNumbers,
  practiceName = "Abita Eye Group",
}: {
  allowedPhoneNumbers: TestPhoneNumber[];
  email: string;
  locations: Array<{ id: string; name: string }>;
  phoneNumbers?: TestPhoneNumber[];
  practiceName?: string;
}) {
  return {
    allowedLocationIds: locations.map((location) => location.id),
    allowedPhoneNumbers,
    hasAllLocationAccess: false,
    membership: {},
    practice: {
      callCenterSettings: null,
      locations,
      name: practiceName,
      phoneNumbers,
    },
    session: {
      user: {
        email,
        id: "user-1",
        name: null,
      },
    },
  } as unknown as PortalPracticeAccessContext;
}

describe("call-center profiles", () => {
  it("recognizes only the configured Abita call-center users as special profiles", () => {
    const locations = [{ id: "hollywood-location", name: "Hollywood" }];
    const allowedPhoneNumbers: TestPhoneNumber[] = [];

    expect(
      isSpecialAbitaCallCenterContext(
        profileContext({
          allowedPhoneNumbers,
          email: "callcenter@abitaeye.com",
          locations,
        }),
      ),
    ).toBe(true);
    expect(
      isSpecialAbitaCallCenterContext(
        profileContext({
          allowedPhoneNumbers,
          email: "justin@abitaeye.com",
          locations,
        }),
      ),
    ).toBe(true);
    expect(
      isSpecialAbitaCallCenterContext(
        profileContext({
          allowedPhoneNumbers,
          email: "optical@abitaeye.com",
          locations,
        }),
      ),
    ).toBe(true);
    expect(
      isSpecialAbitaCallCenterContext(
        profileContext({
          allowedPhoneNumbers,
          email: "callcenter@abitaeye.com",
          locations,
          practiceName: "Other Eye Group",
        }),
      ),
    ).toBe(false);
  });

  it("combines Hollywood and Sweetwater into the Abita South Florida profile", () => {
    const allowedPhoneNumbers: TestPhoneNumber[] = [
      {
        isPrimary: true,
        label: "Hollywood",
        locationId: "hollywood-location",
        phoneNumber: "+19545550100",
      },
      {
        isPrimary: true,
        label: "Sweetwater",
        locationId: "sweetwater-location",
        phoneNumber: "+17864657479",
      },
    ];
    const context = profileContext({
      allowedPhoneNumbers,
      email: "callcenter@abitaeye.com",
      locations: [
        { id: "hollywood-location", name: "Hollywood" },
        { id: "sweetwater-location", name: "Sweetwater" },
        { id: "nmb-location", name: "North Miami Beach Optical" },
      ],
    });

    expect(
      getCallCenterProfileLocations({
        context,
        visibleLocations: context.practice.locations,
        visiblePhoneNumbers: context.allowedPhoneNumbers,
      }),
    ).toEqual([
      {
        id: "abita-south-florida",
        label: "Hollywood / Sweetwater",
        locationIds: ["hollywood-location", "sweetwater-location"],
        outboundNumber: "+19545550100",
      },
    ]);
  });

  it("keeps Sweetwater and North Miami Beach as optical profile locations", () => {
    const context = profileContext({
      allowedPhoneNumbers: [],
      email: "sweetwateropticals@abitaeye.com",
      locations: [
        { id: "nmb-location", name: "Brightview" },
        { id: "sweetwater-location", name: "Sweetwater" },
      ],
    });
    const locations = getCallCenterProfileLocations({
      context,
      visibleLocations: context.practice.locations,
      visiblePhoneNumbers: context.allowedPhoneNumbers,
    });

    expect(locations?.map((location) => location.label)).toEqual([
      "Sweetwater Optical",
      "North Miami Beach Optical",
    ]);
    expect(getCallCenterProfileOutboundCallerNumbers(locations?.[1] ?? null)).toEqual([
      {
        label: "North Miami Beach Optical",
        phoneNumber: "+17864657479",
      },
    ]);
  });

  it("keeps optical calls out of the South Florida queue scope", () => {
    const context = profileContext({
      allowedPhoneNumbers: [],
      email: "callcenter@abitaeye.com",
      locations: [
        { id: "hollywood-location", name: "Hollywood" },
        { id: "sweetwater-location", name: "Sweetwater" },
        { id: "nmb-location", name: "North Miami Beach Optical" },
      ],
    });
    const scope = buildCallCenterQueueScopeForProfile(context) as {
      OR: Array<{
        NOT?: { toPhone?: { in?: string[] } };
        locationId?: { in?: string[] };
        toPhone?: { in?: string[] };
      }>;
    };

    expect(scope.OR[0].toPhone?.in).toContain("+16184220360");
    expect(scope.OR[1].locationId?.in).toEqual([
      "hollywood-location",
      "sweetwater-location",
    ]);
    expect(scope.OR[1].NOT?.toPhone?.in).toContain("+13055095333");
  });

  it("returns profile-safe outbound caller numbers", () => {
    const allowedPhoneNumbers: TestPhoneNumber[] = [
      {
        isPrimary: true,
        label: "Hollywood",
        locationId: "hollywood-location",
        phoneNumber: "+19545550100",
      },
      {
        isPrimary: true,
        label: "North Miami Beach Optical",
        locationId: "nmb-location",
        phoneNumber: "+13055095333",
      },
    ];

    expect(
      getAllowedCallCenterOutboundPhoneNumbersForProfile(
        profileContext({
          allowedPhoneNumbers,
          email: "callcenter@abitaeye.com",
          locations: [
            { id: "hollywood-location", name: "Hollywood" },
            { id: "nmb-location", name: "North Miami Beach Optical" },
          ],
        }),
      ),
    ).toEqual([{ phoneNumber: "+19545550100" }]);
    expect(
      getAllowedCallCenterOutboundPhoneNumbersForProfile(
        profileContext({
          allowedPhoneNumbers,
          email: "sweetwateropticals@abitaeye.com",
          locations: [{ id: "sweetwater-location", name: "Sweetwater" }],
        }),
      ),
    ).toEqual([{ phoneNumber: "+17864657479" }]);
  });
});
