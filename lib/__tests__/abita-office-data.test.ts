import { describe, expect, it } from "bun:test";

import { findAbitaNewOfficeByLocation } from "@/lib/abita-office-data";

describe("Abita office data", () => {
  it("maps Brightview scheduler labels to the North Miami Beach Optical profile", () => {
    for (const name of ["Brightview", "Bright View"]) {
      const office = findAbitaNewOfficeByLocation({ address: null, name });

      expect(office?.name).toBe("North Miami Beach Optical");
      expect(office?.address).toBe("633 NE 167th Street, North Miami Beach, FL 33162");
      expect(office?.primaryPhone).toBe("+13055095333");
      expect(office?.insuranceTitle).toBeNull();
      expect(office?.ruleSlug).toBeNull();
      expect(office?.knowledgeMarkdown).toContain("Dr. Miriam Bach");
      expect(office?.knowledgeMarkdown).toContain("routine vision and optical only");
      expect(office?.knowledgeMarkdown).toContain("does not accept medical insurance");
    }
  });
});
