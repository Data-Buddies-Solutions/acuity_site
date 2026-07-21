import { describe, expect, it } from "bun:test";

import {
  parsePortalTaskCategory,
  portalTaskCategories,
  portalTaskCategoryLabels,
} from "@/lib/portal-tasks";

describe("portal task categories", () => {
  it("exposes every staff task bucket with a visible label", () => {
    expect(portalTaskCategories).toEqual([
      "billing",
      "appointments",
      "documentation",
      "optical",
      "medication",
      "referrals",
      "other",
    ]);
    expect(portalTaskCategoryLabels).toEqual({
      appointments: "Appointments",
      billing: "Billing",
      documentation: "Documentation",
      medication: "Medication",
      optical: "Optical",
      other: "Other",
      referrals: "Referrals",
    });

    for (const category of portalTaskCategories) {
      expect(parsePortalTaskCategory(category)).toBe(category);
    }
  });
});
