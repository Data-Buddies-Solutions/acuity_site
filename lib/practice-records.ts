export type PracticeTypeValue = "OPHTHALMOLOGY" | "OPTOMETRY" | "MIXED" | "OTHER";

export type WebsiteScanStatusValue = "SUCCESS" | "FAILED";

export type PracticeWebsiteScanLocation = {
  address?: string;
  email?: string;
  fax?: string;
  hoursSummary?: string;
  name: string;
  phone?: string;
};

export type PracticeWebsiteScanProvider = {
  displayName: string;
  npi?: string;
  specialtySummary?: string;
  speechAliases: string[];
};

export type PracticeWebsiteScanKnowledgeHints = {
  appointmentExpectations: string[];
  emergencyNotice?: string;
  excludedServices: string[];
  scopeSummary?: string;
  whatToBring: string[];
};

export type PracticeWebsiteScanSignals = {
  addresses: string[];
  emails: string[];
  hours: string[];
  npiNumbers: string[];
  phones: string[];
  providerNames: string[];
  specialties: string[];
};

export type PracticeWebsiteScanResult = {
  errorMessage?: string;
  extractedSignals: PracticeWebsiteScanSignals;
  finalUrl: string;
  knowledgeHints: PracticeWebsiteScanKnowledgeHints;
  metaDescription?: string;
  practiceName?: string;
  practiceType: PracticeTypeValue;
  primaryLocation?: PracticeWebsiteScanLocation;
  providers: PracticeWebsiteScanProvider[];
  sourceUrl: string;
  status: WebsiteScanStatusValue;
  title?: string;
};

export function guessPracticeNameFromWebsite(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const [rawName] = hostname.split(".");

    return rawName
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}
