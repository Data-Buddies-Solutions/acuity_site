// Single-scroll specialty pages rendered by SpecialtyPage.tsx, styled to match
// the home page. `h1` leads with the specialty's own pain so a visitor feels
// understood immediately. Adding a specialty is a new entry here plus a small
// route folder.
export type SpecialtyPageContent = {
  slug: string;
  navLabel: string;
  title: string;
  description: string;
  keywords: string[];
  eyebrow: string;
  h1: string;
  intro: string;
  primaryCta: string;
  capabilitiesHeading: string;
  capabilities: Array<{ title: string; body: string }>;
  closingHeading: string;
  closingBody: string;
};

export const specialtyPages = [
  {
    slug: "specialties/ophthalmology",
    navLabel: "Ophthalmology",
    title: "AI Receptionist for Ophthalmology Practices",
    description:
      "Acuity is the AI receptionist built for ophthalmology. Flashes-and-floaters triage, medical vs. vision coverage, multi-office scheduling, and optical calls, answered instantly and booked into your EMR.",
    keywords: [
      "AI receptionist for ophthalmology",
      "ophthalmology answering service",
      "ophthalmology AI front desk",
      "ophthalmology appointment scheduling AI",
      "eye care AI receptionist",
    ],
    eyebrow: "Acuity for Ophthalmology",
    h1: "New floaters and a glasses pickup shouldn't wait in the same queue",
    intro:
      "Acuity tells them apart, escalates urgent symptoms on your rules, and books the right visit into your EMR across every office.",
    primaryCta: "Book an ophthalmology demo",
    capabilitiesHeading: "Built around how eye care actually runs.",
    capabilities: [
      {
        title: "Medical vs. vision, sorted",
        body: "The distinction that defines eye-care scheduling is handled in conversation, so every visit lands on the right coverage.",
      },
      {
        title: "Urgent symptoms move instantly",
        body: "Sudden vision changes, trauma, and post-op worries escalate on your rules, nights and weekends included.",
      },
      {
        title: "Every office, one front door",
        body: "Hours, providers, and appointment types are routed correctly across all of your locations.",
      },
      {
        title: "Optical and recalls off your desk",
        body: "Pickup calls, contact reorders, and annual-exam recalls stop interrupting check-in.",
      },
    ],
    closingHeading: "Hear it handle an eye-care call.",
    closingBody:
      "Book a demo and we'll run a live call on your appointment types, coverage rules, and locations.",
  },
  {
    slug: "specialties/dermatology",
    navLabel: "Dermatology",
    title: "AI Receptionist for Dermatology Practices",
    description:
      "Acuity is the AI receptionist built for dermatology. It tells a changing mole from a cosmetic consult, books the right visit type into your EMR, fills cancellations from the waitlist, and routes biopsy follow-ups.",
    keywords: [
      "AI receptionist for dermatology",
      "dermatology answering service",
      "dermatology AI front desk",
      "dermatology appointment scheduling AI",
      "cosmetic dermatology scheduling",
    ],
    eyebrow: "Acuity for Dermatology",
    h1: "A changing mole and a Botox consult shouldn't wait in the same queue",
    intro:
      "Acuity tells them apart, books the right visit into your EMR, and keeps a packed schedule full, nights and weekends included.",
    primaryCta: "Book a dermatology demo",
    capabilitiesHeading: "Built around how dermatology actually runs.",
    capabilities: [
      {
        title: "Medical vs. cosmetic, booked right",
        body: "Visit type, length, and prep are matched to the request, whether it's a rash, a skin check, or a consult.",
      },
      {
        title: "Lesion worries move fast",
        body: "Changing, bleeding, or growing lesions are prioritized on rules you set, every time.",
      },
      {
        title: "Cancellations don't stay empty",
        body: "Open slots go to waiting patients without staff working the phones.",
      },
      {
        title: "Follow-ups reach the right hands",
        body: "Biopsy results, wound-care questions, and follow-ups reach the right person directly.",
      },
    ],
    closingHeading: "Hear it handle a dermatology call.",
    closingBody:
      "Book a demo and we'll run a live call on your visit types, urgency rules, and waitlist.",
  },
] as const satisfies readonly SpecialtyPageContent[];

export type SpecialtySlug = (typeof specialtyPages)[number]["slug"];

export function getSpecialtyPage(slug: SpecialtySlug) {
  return specialtyPages.find((page) => page.slug === slug);
}
