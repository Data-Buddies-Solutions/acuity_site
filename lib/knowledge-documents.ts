import { revalidatePath } from "next/cache";

import { requireAdminSession } from "@/lib/admin-auth";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const ABITA_SPRING_HILL_MARKDOWN = `# Knowledge Base: Abita Eye Group, Spring Hill

## Emergency Notice

If this is a medical emergency, please hang up and dial 911 or go to the nearest emergency room immediately.

## Urgency Screening

To determine urgency:

1. Is the patient experiencing new flashes or floaters?
2. How long has the symptom been present?
3. Any sudden or gradual vision loss?

New flashes or floaters -> treat as urgent, offer the next available appointment. If unchanged or not new, continue with standard scheduling.

## Location + Contact

Practice Name: Abita Eye Group
Address: 10495 SpringHill Drive, Springhill, FL 34608
Email: newpatient@abitaeye.com
Fax: (305)-675-3370

Hours: Monday-Friday 8:30 AM - 4:30 PM. Closed Saturday and Sunday.

**Other Location:** We also have an office in Crystal River - Eye Radiance, 1100 N Lyle Avenue, Crystal River, FL 34429. That location only sees Dr. Licht (Tuesday-Thursday, 12-5 PM).

## Scope of Services

This is an **ophthalmology** practice - not optometry. We see patients for medical and surgical eye conditions: cataract evaluation, glaucoma evaluation, retina care, uveitis care, pediatric ophthalmology, adult strabismus (eye misalignment), double vision evaluation, and oculoplastic (eyelid) procedures. We do **not** perform routine eye exams or vision-only checkups. If a caller is looking for a routine eye exam or glasses prescription, let them know we're an ophthalmology office and they'd want to see an optometrist for that.

## Providers - Spring Hill

**Dr. Bach** (NPI: 16-59706588) - Pediatrics, Adult Strabismus, Double Vision. Limited schedule - only at Spring Hill a couple times per month. Availability may be several weeks out.

**Dr. Noel** (NPI: 16-59998482) - Comprehensive Ophthalmology, Retina, Uveitis, Glaucoma.

**Dr. Licht** (NPI: 14-97147680) - Comprehensive Ophthalmology, Oculoplastic (Eyelid Surgery), Glaucoma.
- STT often misrecognizes as: "Lee", "Licked", "Lit", "Lisht", "Lich", "Lish", "Liked". If a caller asks for any of these, assume they mean Dr. Licht.

## Glasses Warranty

Patients should bring their glasses into the Spring Hill location - staff will review and determine options in person.

## What to Bring

Photo ID, insurance card, list of current medications, previous eye records (if available).

## Appointment Expectations

New patient visits may take 1-2 hours. Eye dilation may occur, causing temporary blurry vision and light sensitivity. The practice typically sends an email confirmation after scheduling.`;

const ABITA_CRYSTAL_RIVER_MARKDOWN = `# Knowledge Base: Eye Radiance powered by Abeeta Eye Group

## Emergency Notice

If this is a medical emergency, please hang up and dial 911 or go to the nearest emergency room immediately.

## Urgency Screening

To determine urgency:

1. Is the patient experiencing new flashes or floaters?
2. How long has the symptom been present?
3. Any sudden or gradual vision loss?

New flashes or floaters -> treat as urgent, offer the next available appointment. If unchanged or not new, continue with standard scheduling.

## Location + Contact

Practice Name: Eye Radiance
Address: 1100 N Lyle Avenue Crystal River, FL 34429
Email: newpatient@abitaeye.com
Fax: (352)-228-4315

Hours:
- Tuesday - Thursday: 12:00 PM - 5:00 PM
- Closed Monday, Friday, Saturday and Sunday

**Other Location:** We also have an office in Spring Hill - Abita Eye Group, 10495 SpringHill Drive, Springhill, FL 34608 (Monday-Friday, 8:30 AM - 4:30 PM). That location also sees Dr. Bach, Dr. Noel, and Dr. Licht. Dr. Licht practices at both locations.

## Scope of Services

This is an **ophthalmology** practice - not optometry. Crystal River sees medical eye conditions such as glaucoma, eyelid concerns, and flashes/floaters. Crystal River does **not** see pediatric ophthalmology and does **not** schedule cataract evaluations or cataract surgery workups there. For pediatrics or cataract-related visits, schedule the patient at Spring Hill. We do **not** perform routine eye exams or vision-only checkups. If a caller is looking for a routine eye exam or glasses prescription, let them know we're an ophthalmology office and they'd want to see an optometrist for that.

## Providers

### Dr. Licht (pronounced "Likt")
- NPI: 14-97147680
- Comprehensive Ophthalmology
- Oculoplastic (Eyelid Surgery)
- Glaucoma
- STT often misrecognizes as: "Lee", "Licked", "Lit", "Lisht", "Lich", "Lish", "Liked". If a caller asks for any of these, assume they mean Dr. Licht.

## Glasses Warranty or Broken Glasses

If a patient asks whether their glasses are under warranty or reports broken glasses:
- Patients should bring their glasses into the Spring Hill location.
- The staff will review the glasses and determine what options may be available.
- Warranty coverage or repair options are evaluated in person.

## Insurance & Referrals

- The practice works with most major insurance plans.
- Referral requirements depend on the patient's insurance policy.
- Insurance verification may be required prior to appointment confirmation.

## What to Bring

Photo ID, insurance card, list of current medications, previous eye records (if available).

## Appointment Expectations

- New patient visits may take 1-2 hours depending on testing.
- Eye dilation may occur during the visit.
- Dilation can temporarily cause blurry vision and light sensitivity.
- The practice typically sends an email confirmation after scheduling an appointment.

## Payment Information

- Visit costs vary based on insurance and type of appointment.
- Coverage details are determined after insurance verification.

## Scope Limitation

This knowledge base provides general practice information only.
It does not provide diagnosis, medical advice, or treatment recommendations.
All medical decisions must be made by a licensed physician during an in-person evaluation.`;

type KnowledgeDocumentRevisionStatus = "PENDING_APPROVAL" | "PUBLISHED" | "REJECTED";

type RawKnowledgeDocument = Awaited<
  ReturnType<typeof loadKnowledgeDocumentsForPractice>
>[number];

export type KnowledgeDocumentSummary = {
  id: string;
  locationName: string | null;
  pendingRevision: KnowledgeRevisionSummary | null;
  publishedRevision: KnowledgeRevisionSummary | null;
  slug: string;
  title: string;
};

export type KnowledgeRevisionSummary = {
  createdAt: Date;
  editedByUserId: string | null;
  id: string;
  markdown: string;
  publishedAt: Date | null;
  status: KnowledgeDocumentRevisionStatus;
};

export type PortalKnowledgeDocumentState = {
  documents: KnowledgeDocumentSummary[];
  selectedDocument: KnowledgeDocumentSummary | null;
};

function textValue(value: string | null | undefined) {
  return (value || "").trim();
}

function hasText(value: string | null | undefined) {
  return Boolean(textValue(value));
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "knowledge-base";
}

function locationSlugSuffix(location: { id: string; name: string }, index: number) {
  return slugify(`${location.name}-${location.id || index + 1}`);
}

function jsonStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && Boolean(item.trim()),
      )
    : [];
}

function formatListSection(title: string, items: string[]) {
  if (!items.length) {
    return "";
  }

  return [`## ${title}`, "", ...items.map((item) => `- ${item}`)].join("\n");
}

function buildLegacyMarkdown(
  practice: {
    insuranceCrosswalk: {
      transferRules: string | null;
    } | null;
    knowledgeBase: {
      appointmentExpectations: unknown;
      appointmentPrep: string | null;
      commonQuestions: string | null;
      emergencyNotice: string | null;
      excludedServices: unknown;
      officePolicies: string | null;
      scopeSummary: string | null;
      urgencyDisposition: string | null;
      urgencyScreeningQuestions: unknown;
      whatToBring: unknown;
      afterHoursRules: string | null;
      phrasingRules: string | null;
    } | null;
    locations: Array<{
      address: string | null;
      email: string | null;
      fax: string | null;
      hoursSummary: string | null;
      name: string;
      phone: string | null;
    }>;
    name: string;
  },
  locationOverride?: {
    address: string | null;
    email: string | null;
    fax: string | null;
    hoursSummary: string | null;
    name: string;
    phone: string | null;
  },
) {
  const knowledgeBase = practice.knowledgeBase;
  const primaryLocation = locationOverride ?? practice.locations[0] ?? null;
  const sections = [
    primaryLocation
      ? `# Knowledge Base: ${practice.name}, ${primaryLocation.name}`
      : `# Knowledge Base: ${practice.name}`,
    "",
    "## Emergency Notice",
    "",
    textValue(knowledgeBase?.emergencyNotice) ||
      "If this is a medical emergency, please hang up and dial 911 or go to the nearest emergency room immediately.",
  ];

  const urgencyQuestions = jsonStringList(knowledgeBase?.urgencyScreeningQuestions);

  if (urgencyQuestions.length || hasText(knowledgeBase?.urgencyDisposition)) {
    sections.push(
      "",
      "## Urgency Screening",
      "",
      ...urgencyQuestions.map((question, index) => `${index + 1}. ${question}`),
    );

    if (hasText(knowledgeBase?.urgencyDisposition)) {
      sections.push("", textValue(knowledgeBase?.urgencyDisposition));
    }
  }

  if (primaryLocation) {
    sections.push(
      "",
      "## Location + Contact",
      "",
      `Practice Name: ${practice.name}`,
      `Address: ${textValue(primaryLocation.address) || "Not provided"}`,
      `Phone: ${textValue(primaryLocation.phone) || "Not provided"}`,
      `Email: ${textValue(primaryLocation.email) || "Not provided"}`,
      `Fax: ${textValue(primaryLocation.fax) || "Not provided"}`,
      "",
      `Hours: ${textValue(primaryLocation.hoursSummary) || "Not provided"}`,
    );
  }

  const optionalSections = [
    ["Scope of Services", knowledgeBase?.scopeSummary],
    ["Common Questions", knowledgeBase?.commonQuestions],
    ["Appointment Prep", knowledgeBase?.appointmentPrep],
    ["Office Policies", knowledgeBase?.officePolicies],
    ["After-Hours Rules", knowledgeBase?.afterHoursRules],
    ["Transfer to Staff When", practice.insuranceCrosswalk?.transferRules],
    ["Always Say / Never Say", knowledgeBase?.phrasingRules],
  ] as const;

  for (const [title, value] of optionalSections) {
    if (hasText(value)) {
      sections.push("", `## ${title}`, "", textValue(value));
    }
  }

  for (const section of [
    formatListSection(
      "Excluded Services",
      jsonStringList(knowledgeBase?.excludedServices),
    ),
    formatListSection("What to Bring", jsonStringList(knowledgeBase?.whatToBring)),
    formatListSection(
      "Appointment Expectations",
      jsonStringList(knowledgeBase?.appointmentExpectations),
    ),
  ]) {
    if (section) {
      sections.push("", section);
    }
  }

  return sections.join("\n").trim();
}

function getSeedDocumentsForPractice(practice: {
  id: string;
  insuranceCrosswalk: {
    transferRules: string | null;
  } | null;
  knowledgeBase: {
    appointmentExpectations: unknown;
    appointmentPrep: string | null;
    commonQuestions: string | null;
    emergencyNotice: string | null;
    excludedServices: unknown;
    officePolicies: string | null;
    scopeSummary: string | null;
    urgencyDisposition: string | null;
    urgencyScreeningQuestions: unknown;
    whatToBring: unknown;
    afterHoursRules: string | null;
    phrasingRules: string | null;
  } | null;
  locations: Array<{
    address: string | null;
    email: string | null;
    fax: string | null;
    hoursSummary: string | null;
    id: string;
    isPrimary: boolean;
    name: string;
    phone: string | null;
  }>;
  name: string;
}) {
  const springHillLocation =
    practice.locations.find((location) =>
      `${location.name} ${location.address || ""}`.toLowerCase().includes("spring"),
    ) ?? null;
  const crystalRiverLocation =
    practice.locations.find((location) =>
      `${location.name} ${location.address || ""}`.toLowerCase().includes("crystal"),
    ) ??
    practice.locations.find((location) =>
      `${location.name} ${location.address || ""}`.toLowerCase().includes("lyle"),
    ) ??
    null;
  const isAbita = practice.name.toLowerCase().includes("abita");

  if (isAbita) {
    return [
      {
        locationId: springHillLocation?.id ?? null,
        markdown: ABITA_SPRING_HILL_MARKDOWN,
        slug: "abita-eye-group-spring-hill",
        title: "Knowledge Base: Abita Eye Group, Spring Hill",
      },
      {
        locationId: crystalRiverLocation?.id ?? null,
        markdown: ABITA_CRYSTAL_RIVER_MARKDOWN,
        slug: "eye-radiance-crystal-river",
        title: "Knowledge Base: Eye Radiance powered by Abeeta Eye Group",
      },
    ];
  }

  const locations = practice.locations.length
    ? practice.locations
    : [
        {
          address: null,
          email: null,
          fax: null,
          hoursSummary: null,
          id: "",
          isPrimary: true,
          name: practice.name,
          phone: null,
        },
      ];

  return locations.map((location, index) => {
    const title = `Knowledge Base: ${practice.name}, ${location.name}`;

    return {
      locationId: location.id || null,
      markdown: buildLegacyMarkdown(practice, location),
      slug: slugify(`${title}-${locationSlugSuffix(location, index)}`),
      title,
    };
  });
}

async function loadKnowledgeDocumentsForPractice(practiceId: string) {
  return prisma.practiceKnowledgeDocument.findMany({
    include: {
      location: {
        select: {
          name: true,
        },
      },
      revisions: {
        orderBy: {
          createdAt: "desc",
        },
        take: 25,
      },
    },
    orderBy: [{ createdAt: "asc" }],
    where: {
      practiceId,
      status: "ACTIVE",
    },
  });
}

function summarizeRevision(
  revision: RawKnowledgeDocument["revisions"][number] | undefined,
): KnowledgeRevisionSummary | null {
  if (!revision) {
    return null;
  }

  return {
    createdAt: revision.createdAt,
    editedByUserId: revision.editedByUserId,
    id: revision.id,
    markdown: revision.markdown,
    publishedAt: revision.publishedAt,
    status: revision.status,
  };
}

function summarizeDocument(document: RawKnowledgeDocument): KnowledgeDocumentSummary {
  const publishedRevision = document.revisions.find(
    (revision) => revision.status === "PUBLISHED",
  );
  const pendingRevision = document.revisions.find(
    (revision) => revision.status === "PENDING_APPROVAL",
  );

  return {
    id: document.id,
    locationName: document.location?.name ?? null,
    pendingRevision: summarizeRevision(pendingRevision),
    publishedRevision: summarizeRevision(publishedRevision),
    slug: document.slug,
    title: document.title,
  };
}

async function ensureDefaultKnowledgeDocument(practiceId: string) {
  const existingDocuments = await prisma.practiceKnowledgeDocument.findMany({
    select: {
      locationId: true,
      slug: true,
    },
    where: {
      practiceId,
      status: "ACTIVE",
    },
  });
  const existingSlugs = new Set(existingDocuments.map((document) => document.slug));
  const existingLocationIds = new Set(
    existingDocuments
      .map((document) => document.locationId)
      .filter((locationId): locationId is string => Boolean(locationId)),
  );

  const practice = await prisma.practice.findUnique({
    include: {
      insuranceCrosswalk: true,
      knowledgeBase: true,
      locations: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    },
    where: {
      id: practiceId,
    },
  });

  if (!practice) {
    return;
  }

  const seedDocuments = getSeedDocumentsForPractice(practice).filter((document) => {
    if (existingSlugs.has(document.slug)) {
      return false;
    }
    return !document.locationId || !existingLocationIds.has(document.locationId);
  });

  for (const seedDocument of seedDocuments) {
    await prisma.practiceKnowledgeDocument.create({
      data: {
        locationId: seedDocument.locationId,
        practiceId,
        revisions: {
          create: {
            markdown: seedDocument.markdown,
            publishedAt: new Date(),
            source: "IMPORT",
            status: "PUBLISHED",
          },
        },
        slug: seedDocument.slug,
        title: seedDocument.title,
      },
    });
  }
}

export async function getPortalKnowledgeDocumentState(
  selectedSlug?: string,
): Promise<PortalKnowledgeDocumentState | null> {
  const session = await getAuthSession();

  if (!session) {
    return null;
  }

  const membership = await prisma.practiceMembership.findFirst({
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: {
      practiceId: true,
    },
    where: {
      userId: session.user.id,
    },
  });

  if (!membership) {
    return null;
  }

  await ensureDefaultKnowledgeDocument(membership.practiceId);

  const documents = (await loadKnowledgeDocumentsForPractice(membership.practiceId)).map(
    summarizeDocument,
  );
  const selectedDocument =
    documents.find((document) => document.slug === selectedSlug) ?? documents[0] ?? null;

  return {
    documents,
    selectedDocument,
  };
}

export async function submitKnowledgeDocumentDraftForReview({
  documentId,
  markdown,
}: {
  documentId: string;
  markdown: string;
}) {
  const session = await getAuthSession();

  if (!session) {
    return null;
  }

  const document = await prisma.practiceKnowledgeDocument.findFirst({
    include: {
      practice: {
        select: {
          name: true,
        },
      },
      revisions: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        where: {
          status: "PUBLISHED",
        },
      },
    },
    where: {
      id: documentId,
      practice: {
        memberships: {
          some: {
            userId: session.user.id,
          },
        },
      },
      status: "ACTIVE",
    },
  });

  if (!document) {
    return null;
  }

  const normalizedMarkdown = markdown.trim();
  const latestPublished = document.revisions[0]?.markdown.trim() ?? "";

  if (!normalizedMarkdown || normalizedMarkdown === latestPublished) {
    return {
      changed: false,
      slug: document.slug,
    };
  }

  await prisma.$transaction(async (tx) => {
    const now = new Date();

    await tx.practiceKnowledgeDocumentRevision.updateMany({
      data: {
        reviewNote: "Superseded by a newer practice draft.",
        reviewedAt: now,
        status: "REJECTED",
      },
      where: {
        documentId: document.id,
        status: "PENDING_APPROVAL",
      },
    });

    await tx.adminAlert.updateMany({
      data: {
        resolvedAt: now,
        status: "RESOLVED",
      },
      where: {
        documentId: document.id,
        status: {
          in: ["UNREAD", "REVIEWING"],
        },
        type: "KNOWLEDGE_BASE_EDITED",
      },
    });

    const revision = await tx.practiceKnowledgeDocumentRevision.create({
      data: {
        documentId: document.id,
        editedByUserId: session.user.id,
        markdown: normalizedMarkdown,
        source: "PRACTICE",
        status: "PENDING_APPROVAL",
      },
    });

    await tx.adminAlert.create({
      data: {
        documentId: document.id,
        message: `${document.practice.name} edited ${document.title}.`,
        practiceId: document.practiceId,
        revisionId: revision.id,
        type: "KNOWLEDGE_BASE_EDITED",
      },
    });
  });

  revalidatePath("/portal/app/knowledge-base");
  revalidatePath("/admin/knowledge-base");

  return {
    changed: true,
    slug: document.slug,
  };
}

export async function getPendingKnowledgeDocumentReviews() {
  return prisma.adminAlert.findMany({
    include: {
      document: {
        include: {
          location: {
            select: {
              name: true,
            },
          },
          revisions: {
            orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
            take: 1,
            where: {
              status: "PUBLISHED",
            },
          },
        },
      },
      practice: {
        select: {
          id: true,
          name: true,
        },
      },
      revision: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    where: {
      revision: {
        status: "PENDING_APPROVAL",
      },
      status: {
        in: ["UNREAD", "REVIEWING"],
      },
      type: "KNOWLEDGE_BASE_EDITED",
    },
  });
}

export async function approveKnowledgeDocumentRevision(alertId: string) {
  const session = await requireAdminSession();

  await prisma.$transaction(async (tx) => {
    const alert = await tx.adminAlert.findUnique({
      include: {
        document: true,
        revision: true,
      },
      where: {
        id: alertId,
      },
    });

    if (
      !alert?.document ||
      !alert.revision ||
      alert.type !== "KNOWLEDGE_BASE_EDITED" ||
      !["UNREAD", "REVIEWING"].includes(alert.status) ||
      alert.revision.status !== "PENDING_APPROVAL"
    ) {
      return;
    }

    const now = new Date();

    const updatedRevision = await tx.practiceKnowledgeDocumentRevision.updateMany({
      data: {
        publishedAt: now,
        reviewedAt: now,
        reviewedByUserId: session.user.id,
        status: "PUBLISHED",
      },
      where: {
        id: alert.revision.id,
        status: "PENDING_APPROVAL",
      },
    });

    if (updatedRevision.count === 0) {
      return;
    }

    await tx.practiceKnowledgeDocumentRevision.updateMany({
      data: {
        reviewNote: "Superseded by a newer approved draft.",
        reviewedAt: now,
        reviewedByUserId: session.user.id,
        status: "REJECTED",
      },
      where: {
        documentId: alert.document.id,
        id: {
          not: alert.revision.id,
        },
        status: "PENDING_APPROVAL",
      },
    });

    await tx.practiceKnowledgeDocument.update({
      data: {
        updatedAt: now,
      },
      where: {
        id: alert.document.id,
      },
    });

    await tx.adminAlert.updateMany({
      data: {
        resolvedAt: now,
        status: "RESOLVED",
      },
      where: {
        documentId: alert.document.id,
        status: {
          in: ["UNREAD", "REVIEWING"],
        },
        type: "KNOWLEDGE_BASE_EDITED",
      },
    });
  });

  revalidatePath("/admin/knowledge-base");
  revalidatePath("/portal/app/knowledge-base");
}

export async function rejectKnowledgeDocumentRevision(
  alertId: string,
  reviewNote: string,
) {
  const session = await requireAdminSession();

  await prisma.$transaction(async (tx) => {
    const alert = await tx.adminAlert.findUnique({
      include: {
        revision: true,
      },
      where: {
        id: alertId,
      },
    });

    if (
      !alert?.revision ||
      alert.type !== "KNOWLEDGE_BASE_EDITED" ||
      !["UNREAD", "REVIEWING"].includes(alert.status) ||
      alert.revision.status !== "PENDING_APPROVAL"
    ) {
      return;
    }

    const now = new Date();

    const updatedRevision = await tx.practiceKnowledgeDocumentRevision.updateMany({
      data: {
        reviewNote: reviewNote.trim() || null,
        reviewedAt: now,
        reviewedByUserId: session.user.id,
        status: "REJECTED",
      },
      where: {
        id: alert.revision.id,
        status: "PENDING_APPROVAL",
      },
    });

    if (updatedRevision.count === 0) {
      return;
    }

    await tx.adminAlert.updateMany({
      data: {
        resolvedAt: now,
        status: "RESOLVED",
      },
      where: {
        revisionId: alert.revision.id,
      },
    });
  });

  revalidatePath("/admin/knowledge-base");
  revalidatePath("/portal/app/knowledge-base");
}
