import {
  guessPracticeNameFromWebsite,
  type PracticeTypeValue,
  type PracticeWebsiteScanKnowledgeHints,
  type PracticeWebsiteScanLocation,
  type PracticeWebsiteScanProvider,
  type PracticeWebsiteScanResult,
} from "./practice-records";

const SPECIALTY_KEYWORDS = [
  "ophthalmology",
  "optometry",
  "retina",
  "glaucoma",
  "uveitis",
  "pediatric ophthalmology",
  "adult strabismus",
  "double vision",
  "oculoplastic",
  "cataract",
  "cornea",
  "dry eye",
] as const;

const WHAT_TO_BRING_KEYWORDS = [
  "photo id",
  "insurance card",
  "current medications",
  "medication list",
  "previous eye records",
] as const;

const APPOINTMENT_EXPECTATION_KEYWORDS = [
  "eye dilation",
  "dilation",
  "temporary blurry vision",
  "light sensitivity",
  "1-2 hours",
  "1–2 hours",
  "email confirmation",
] as const;

function cleanupWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(html: string) {
  return cleanupWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function unique(values: Array<string | undefined | null>) {
  return Array.from(
    new Set(
      values
        .map((value) => cleanupWhitespace(String(value || "")))
        .filter(Boolean)
    )
  );
}

function matchAll(content: string, pattern: RegExp) {
  return Array.from(content.matchAll(pattern), (match) => cleanupWhitespace(match[0]));
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanupWhitespace(decodeHtmlEntities(match[1])) : undefined;
}

function extractMetaContent(html: string, names: string[]) {
  for (const name of names) {
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        "i"
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["'][^>]*>`,
        "i"
      ),
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);

      if (match) {
        return cleanupWhitespace(decodeHtmlEntities(match[1]));
      }
    }
  }

  return undefined;
}

function extractJsonLdBlocks(html: string) {
  const blocks = Array.from(
    html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ),
    (match) => match[1]
  );

  const parsed: unknown[] = [];

  for (const block of blocks) {
    try {
      parsed.push(JSON.parse(block.trim()));
    } catch {
      continue;
    }
  }

  return parsed;
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenJsonLd(entry));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const graphValues = record["@graph"];

    return [record, ...flattenJsonLd(graphValues)];
  }

  return [];
}

function readType(node: Record<string, unknown>) {
  const rawType = node["@type"];
  const values = Array.isArray(rawType) ? rawType : [rawType];

  return values
    .map((value) => String(value || "").toLowerCase())
    .filter(Boolean);
}

function readString(value: unknown) {
  return typeof value === "string" ? cleanupWhitespace(value) : undefined;
}

function readAddress(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const street = readString(record.streetAddress);
  const city = readString(record.addressLocality);
  const state = readString(record.addressRegion);
  const postalCode = readString(record.postalCode);

  return unique([street, city && state ? `${city}, ${state}` : city, postalCode]).join(" ");
}

function readOpeningHours(value: unknown) {
  if (Array.isArray(value)) {
    return cleanupWhitespace(
      value
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return String(entry || "");
          }

          const record = entry as Record<string, unknown>;
          const day = Array.isArray(record.dayOfWeek)
            ? record.dayOfWeek.map((item) => String(item).replace("https://schema.org/", "")).join(", ")
            : String(record.dayOfWeek || "").replace("https://schema.org/", "");

          return cleanupWhitespace(
            [day, readString(record.opens), readString(record.closes)].filter(Boolean).join(" ")
          );
        })
        .filter(Boolean)
        .join("; ")
    );
  }

  return readString(value);
}

function pickPracticeType(text: string): PracticeTypeValue {
  const lower = text.toLowerCase();
  const hasOphthalmology = lower.includes("ophthalmology");
  const hasOptometry = lower.includes("optometry");

  if (hasOphthalmology && hasOptometry) {
    return "MIXED";
  }

  if (hasOphthalmology) {
    return "OPHTHALMOLOGY";
  }

  if (hasOptometry) {
    return "OPTOMETRY";
  }

  return "OTHER";
}

function extractPhones(text: string) {
  return unique(matchAll(text, /(?:\+?1[-.\s]*)?(?:\(\d{3}\)|\d{3})[-.\s]*\d{3}[-.\s]*\d{4}/g));
}

function extractEmails(text: string) {
  return unique(matchAll(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi));
}

function extractAddresses(text: string) {
  return unique(
    matchAll(
      text,
      /\d{1,6}\s+[A-Za-z0-9.'# -]+,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?/g
    )
  );
}

function extractHours(text: string) {
  return unique(
    matchAll(
      text,
      /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^.!?]{0,80}(?:AM|PM|am|pm)/g
    )
  );
}

function extractProviderNames(text: string) {
  return unique(matchAll(text, /(?:Dr\.?|Doctor)\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2}/g)).map(
    (value) => value.replace(/^Dr\.?\s+/i, "Dr. ")
  );
}

function extractNpiNumbers(text: string) {
  return unique(matchAll(text, /\b\d{10}\b/g));
}

function extractSpecialties(text: string) {
  const lower = text.toLowerCase();

  return SPECIALTY_KEYWORDS.filter((keyword) => lower.includes(keyword));
}

function extractKnowledgeHints(text: string, practiceType: PracticeTypeValue): PracticeWebsiteScanKnowledgeHints {
  const lower = text.toLowerCase();
  const excludedServices = [];

  if (lower.includes("do not perform routine eye exams")) {
    excludedServices.push("Routine eye exams");
  }

  if (lower.includes("glasses prescription")) {
    excludedServices.push("Glasses prescriptions");
  }

  const whatToBring = WHAT_TO_BRING_KEYWORDS.filter((keyword) =>
    lower.includes(keyword)
  ).map((keyword) => keyword.replace(/\b\w/g, (letter) => letter.toUpperCase()));

  const appointmentExpectations = APPOINTMENT_EXPECTATION_KEYWORDS.filter((keyword) =>
    lower.includes(keyword)
  );

  const emergencyNotice = lower.includes("dial 911") || lower.includes("nearest emergency room")
    ? "If this is a medical emergency, call 911 or go to the nearest emergency room immediately."
    : undefined;

  const specialties = extractSpecialties(text);
  const scopeSummary = specialties.length
    ? `${practiceType === "OPHTHALMOLOGY" ? "Ophthalmology" : practiceType === "OPTOMETRY" ? "Optometry" : "Eye care"} practice focused on ${specialties.join(", ")}.`
    : undefined;

  return {
    appointmentExpectations,
    emergencyNotice,
    excludedServices,
    scopeSummary,
    whatToBring,
  };
}

function buildProviderRecords(
  providerNames: string[],
  specialtySummary?: string,
  npiNumbers: string[] = []
) {
  return providerNames.slice(0, 4).map<PracticeWebsiteScanProvider>((displayName, index) => ({
    displayName,
    npi: npiNumbers[index],
    specialtySummary,
    speechAliases: [],
  }));
}

function extractLocationFromJsonLd(nodes: Record<string, unknown>[]) {
  const organizationNode =
    nodes.find((node) => {
      const types = readType(node);
      return types.some((type) =>
        ["medicalbusiness", "medicalclinic", "localbusiness", "organization"].includes(type)
      );
    }) || nodes[0];

  if (!organizationNode) {
    return undefined;
  }

  const address = readAddress(organizationNode.address);
  const phone = readString(organizationNode.telephone);
  const fax = readString(organizationNode.faxNumber);
  const email = readString(organizationNode.email);
  const hoursSummary = readOpeningHours(
    organizationNode.openingHoursSpecification || organizationNode.openingHours
  );
  const name = readString(organizationNode.name);

  if (!name && !address && !phone && !email && !hoursSummary) {
    return undefined;
  }

  return {
    address,
    email,
    fax,
    hoursSummary,
    name: name || "Main office",
    phone,
  } satisfies PracticeWebsiteScanLocation;
}

function extractPracticeName(
  nodes: Record<string, unknown>[],
  title: string | undefined,
  sourceUrl: string
) {
  const candidate =
    nodes
      .map((node) => readString(node.name))
      .find(Boolean) ||
    title?.split("|")[0]?.split("-")[0];

  return candidate ? cleanupWhitespace(candidate) : guessPracticeNameFromWebsite(sourceUrl);
}

export async function scanPracticeWebsite(url: string): Promise<PracticeWebsiteScanResult> {
  const sourceUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  try {
    const response = await fetch(sourceUrl, {
      cache: "no-store",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "AcuityPracticePortalScanner/1.0",
      },
      redirect: "follow",
    });

    const html = await response.text();
    const finalUrl = response.url || sourceUrl;
    const text = stripHtml(html);
    const title = extractTitle(html);
    const metaDescription = extractMetaContent(html, ["description", "og:description"]);
    const nodes = extractJsonLdBlocks(html).flatMap((entry) => flattenJsonLd(entry));
    const phones = unique([
      ...extractPhones(text),
      ...nodes.map((node) => readString(node.telephone)),
    ]);
    const emails = unique([
      ...extractEmails(text),
      ...nodes.map((node) => readString(node.email)),
    ]);
    const addresses = unique([
      ...extractAddresses(text),
      ...nodes.map((node) => readAddress(node.address)),
    ]);
    const hours = unique([
      ...extractHours(text),
      ...nodes.map((node) =>
        readOpeningHours(node.openingHoursSpecification || node.openingHours)
      ),
    ]);
    const providerNames = unique([
      ...extractProviderNames(text),
      ...nodes
        .filter((node) => readType(node).includes("physician"))
        .map((node) => readString(node.name)),
    ]);
    const specialties = unique([
      ...extractSpecialties(text),
      ...nodes.map((node) => readString(node.medicalSpecialty)),
    ]);
    const npiNumbers = extractNpiNumbers(text);
    const practiceType = pickPracticeType(
      [title, metaDescription, specialties.join(" "), text.slice(0, 4000)].join(" ")
    );
    const practiceName = extractPracticeName(nodes, title, sourceUrl);
    const primaryLocation =
      extractLocationFromJsonLd(nodes) ||
      (addresses.length || phones.length || emails.length || hours.length
        ? {
            address: addresses[0],
            email: emails[0],
            fax: phones[1],
            hoursSummary: hours[0],
            name: practiceName || "Main office",
            phone: phones[0],
          }
        : undefined);
    const providers = buildProviderRecords(providerNames, specialties.join(", "), npiNumbers);

    return {
      extractedSignals: {
        addresses,
        emails,
        hours,
        npiNumbers,
        phones,
        providerNames,
        specialties,
      },
      finalUrl,
      knowledgeHints: extractKnowledgeHints(text, practiceType),
      metaDescription,
      practiceName,
      practiceType,
      primaryLocation,
      providers,
      sourceUrl,
      status: response.ok ? "SUCCESS" : "FAILED",
      title,
      ...(response.ok
        ? {}
        : { errorMessage: `Website responded with status ${response.status}.` }),
    };
  } catch (error) {
    return {
      errorMessage: error instanceof Error ? error.message : "Unable to scan that website.",
      extractedSignals: {
        addresses: [],
        emails: [],
        hours: [],
        npiNumbers: [],
        phones: [],
        providerNames: [],
        specialties: [],
      },
      finalUrl: sourceUrl,
      knowledgeHints: {
        appointmentExpectations: [],
        excludedServices: [],
        whatToBring: [],
      },
      practiceName: guessPracticeNameFromWebsite(sourceUrl),
      practiceType: "OTHER",
      providers: [],
      sourceUrl,
      status: "FAILED",
    };
  }
}
