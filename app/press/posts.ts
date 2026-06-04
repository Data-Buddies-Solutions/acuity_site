export type PressRelease = {
  slug: string;
  dateline: string;
  date: string;
  headline: string;
  summary: string;
  image?: {
    src: string;
    alt: string;
  };
  body: {
    heading?: string;
    paragraphs: string[];
  }[];
  quote?: {
    text: string;
    attribution: string;
    role: string;
  };
  relatedUrl?: { label: string; href: string };
  contact: {
    name: string;
    email: string;
  };
};

const pressReleasePosts: PressRelease[] = [
  {
    slug: "acuity-health-dr-michael-venincasa-chief-medical-officer",
    dateline: "June 4, 2026",
    date: "2026-06-04",
    headline:
      "Acuity Health names Dr. Michael Venincasa as Chief Medical Officer",
    summary:
      "Dr. Michael Venincasa joins Acuity Health as Chief Medical Officer, strengthening the company's mission to build the leading AI receptionist for ophthalmology practices.",
    image: {
      src: "/michael-venincasa.jpg",
      alt: "Dr. Michael Venincasa, Chief Medical Officer at Acuity Health",
    },
    body: [
      {
        heading: "Clinical leadership for ophthalmology-specific AI",
        paragraphs: [
          "Dr. Venincasa is a comprehensive ophthalmologist at Loh Ophthalmology Associates in Miami. His clinical work spans cataract surgery, refractive cataract and premium lens replacement surgery, ocular surface disease, dry eye, glaucoma, diabetic eye exams, and routine eye care.",
          "Acuity is built around the reality of ophthalmology practices: high call volume, detailed scheduling rules, medical versus vision insurance, pediatric routing, urgent symptom triage, multilingual patient conversations, and direct EMR booking.",
          "Dr. Venincasa's role will focus on making those clinical and operational details core to the product, so practices can use AI at the front desk without flattening the nuance of patient care or practice workflows.",
        ],
      },
      {
        heading: "A step toward the best AI receptionist for eye care",
        paragraphs: [
          "The appointment marks another step in Acuity's goal of becoming the best AI receptionist for ophthalmology practices. The company is pairing engineering depth with clinical guidance to answer calls, book accurately, reduce staff burden, and capture demand that would otherwise be missed.",
          "Dr. Venincasa trained at the University of Miami Miller School of Medicine and completed his ophthalmology residency at Bascom Palmer Eye Institute. He brings direct experience from high-volume ophthalmology care to Acuity's work with practices across the country.",
        ],
      },
    ],
    quote: {
      text: "Ophthalmology deserves AI built around how eye care practices actually operate. Dr. Venincasa gives us the clinical judgment and workflow depth to keep raising that bar.",
      attribution: "Kyle Shechtman",
      role: "Co-founder & CEO, Acuity Health",
    },
    relatedUrl: { label: "Meet the Acuity Health team", href: "/about" },
    contact: {
      name: "Kyle Shechtman",
      email: "kyle@acuityhealth.io",
    },
  },
  {
    slug: "acuity-health-launches-ai-receptionist-ophthalmology",
    dateline: "January 1, 2026",
    date: "2026-01-01",
    headline:
      "Acuity Health launches the AI receptionist purpose-built for ophthalmology",
    summary:
      "Acuity Health introduces an AI receptionist designed for ophthalmology practices — answering every patient call, booking appointments directly into the EMR, and capturing after-hours demand without dropped calls.",
    body: [
      {
        paragraphs: [
          "Acuity Health today announced the general availability of its AI receptionist for ophthalmology practices. The platform answers every inbound patient call, books appointments directly into the practice's EMR, and captures after-hours demand that historically leaks to voicemail.",
          "Unlike generic AI phone systems or traditional human answering services, Acuity is built for the specific complexity of ophthalmology — pediatric routing, medical versus vision insurance, multilingual booking, and the volume of repetitive scheduling that consumes the front desk.",
        ],
      },
      {
        heading: "Why ophthalmology",
        paragraphs: [
          "Eye care practices field high call volumes against a workflow that most generic platforms were never designed for. Roughly 23% of patient calls go to voicemail and 15% of demand arrives after hours, according to recent practice operations data referenced by Acuity.",
          "Acuity is currently deployed across multi-location ophthalmology groups, handling 100+ concurrent calls, fully answering and booking in Spanish, and surfacing structured follow-up the front desk can act on.",
        ],
      },
      {
        heading: "Direct EMR booking",
        paragraphs: [
          "Appointments write directly into the practice's EMR with no double entry. Acuity is fully integrated with AdvancedMD today and is expanding to additional EMRs based on practice demand.",
        ],
      },
      {
        heading: "Early traction",
        paragraphs: [
          "In its first thirty days across six ophthalmology locations, Acuity has answered every inbound call (0 missed), booked 500+ appointments directly into the EMR, captured 2,000+ after-hours calls, and returned approximately 400 staff hours to the practice team.",
        ],
      },
    ],
    quote: {
      text: "Practices were burning four hours a day on repetitive phone work — and still missing calls. We built Acuity so ophthalmology teams never have to choose between answering the phone and running the practice.",
      attribution: "Kyle Shechtman",
      role: "Co-founder & CEO, Acuity Health",
    },
    relatedUrl: { label: "See how it works", href: "/#how-it-works" },
    contact: {
      name: "Kyle Shechtman",
      email: "kyle@acuityhealth.io",
    },
  },
  {
    slug: "acuity-health-advancedmd-marketplace-partnership",
    dateline: "May 20, 2026",
    date: "2026-05-20",
    headline:
      "Acuity Health joins the AdvancedMD Marketplace with an AI receptionist for ophthalmology",
    summary:
      "Acuity Health is now an official AdvancedMD Marketplace partner. Ophthalmology practices on AdvancedMD can deploy Acuity to answer every call and write appointments natively into AdvancedMD's scheduling backbone.",
    body: [
      {
        paragraphs: [
          "Acuity Health announced today that it has joined the AdvancedMD Marketplace as a verified integration partner. Ophthalmology practices already running AdvancedMD can plug in Acuity's AI receptionist without changing their scheduling backbone or retraining the front desk.",
        ],
      },
      {
        heading: "Native, two-way scheduling",
        paragraphs: [
          "Acuity reads AdvancedMD providers, locations, visit types, and scheduling rules in real time, and writes appointments back the moment a patient confirms. There is no overnight reconciliation and no double-booking risk.",
        ],
      },
      {
        heading: "Built for ophthalmology workflows",
        paragraphs: [
          "Acuity is trained on the workflow complexity that defines ophthalmology — medical versus vision insurance, pediatric routing, urgent visit triage, and the dozen other things a generic AI phone tool typically can't handle.",
        ],
      },
      {
        heading: "Time to value",
        paragraphs: [
          "Most AdvancedMD practices go live with Acuity in four to eight weeks. Configuration, routing logic, escalation rules, integration work, and go-live support are handled by the Acuity team.",
        ],
      },
    ],
    quote: {
      text: "AdvancedMD is the operational backbone for a huge number of eye care practices. Listing on the Marketplace means those practices can plug in an AI receptionist without rebuilding their workflows.",
      attribution: "Kyle Shechtman",
      role: "Co-founder & CEO, Acuity Health",
    },
    relatedUrl: {
      label: "See the AdvancedMD integration",
      href: "/partners/advancedmd",
    },
    contact: {
      name: "Kyle Shechtman",
      email: "kyle@acuityhealth.io",
    },
  },
];

export const pressReleases = [...pressReleasePosts].sort(
  (a, b) => Date.parse(b.date) - Date.parse(a.date),
);

export function getPressReleaseBySlug(slug: string) {
  return pressReleases.find((release) => release.slug === slug);
}
