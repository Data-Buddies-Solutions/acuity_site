export type SolutionPageContent = {
  slug: string;
  navLabel: string;
  title: string;
  description: string;
  keywords: string[];
  h1: string;
  intro: string;
  primaryCta: string;
  secondaryCta?: {
    label: string;
    href: string;
  };
  proof: string[];
  sections: Array<{
    title: string;
    body: string;
  }>;
  workflow: Array<{
    title: string;
    body: string;
  }>;
  comparison: Array<{
    traditional: string;
    acuity: string;
  }>;
  faqs: Array<{
    question: string;
    answer: string;
  }>;
};

export const solutionPages = [
  {
    slug: "ai-receptionist-for-ophthalmology",
    navLabel: "AI Receptionist for Ophthalmology",
    title: "AI Receptionist for Ophthalmology",
    description:
      "Acuity helps ophthalmology practices answer patient calls, book visits, route requests, and reduce front-desk overload with an AI receptionist built for eye care.",
    keywords: [
      "AI receptionist for ophthalmology",
      "ophthalmology AI receptionist",
      "eye care AI receptionist",
      "ophthalmology phone automation",
    ],
    h1: "AI receptionist for ophthalmology practices",
    intro:
      "Acuity helps your practice pick up, understand what the patient needs, and move the call toward the right outcome: booked visit, clear answer, staff transfer, or escalation.",
    primaryCta: "Book an ophthalmology demo",
    secondaryCta: { label: "Try the AI receptionist", href: "tel:+14843989071" },
    proof: [
      "Built around eye care workflows",
      "Books, routes, or transfers with context",
      "Tracks outcomes across locations",
    ],
    sections: [
      {
        title: "Answer calls without adding front-desk load",
        body: "Handle routine scheduling, location questions, insurance questions, and common requests before they become staff interruptions.",
      },
      {
        title: "Built for eye care workflows",
        body: "Support medical vs. vision routing, provider rules, appointment types, pediatric flows, location logic, and urgent escalation paths.",
      },
      {
        title: "Book, route, or transfer with context",
        body: "When the call can be completed, Acuity completes it. When staff needs to step in, they receive the context.",
      },
      {
        title: "Make patient access measurable",
        body: "Track call volume, booking outcomes, after-hours activity, transfers, and unresolved cases across the practice.",
      },
    ],
    workflow: [
      {
        title: "Answer",
        body: "Acuity picks up immediately and identifies the patient request.",
      },
      {
        title: "Resolve",
        body: "The call moves through approved scheduling, routing, FAQ, or handoff logic.",
      },
      {
        title: "Report",
        body: "Operators can review outcomes, transfers, and follow-up needs in the portal.",
      },
    ],
    comparison: [
      {
        traditional: "Generic phone coverage takes a message.",
        acuity:
          "Acuity tries to complete the workflow while the patient is still on the line.",
      },
      {
        traditional: "Staff reconstructs what happened from voicemail.",
        acuity: "Staff sees the call outcome and handoff context.",
      },
      {
        traditional: "Scheduling nuance is handled manually.",
        acuity: "Practice rules drive scheduling, routing, and escalation.",
      },
    ],
    faqs: [
      {
        question: "Can Acuity book directly into our scheduling system?",
        answer:
          "Yes, where integration and scheduling rules are configured. Acuity is already built around AdvancedMD workflows and can be scoped to your locations, providers, visit types, and rules.",
      },
      {
        question: "How does Acuity know when to transfer a call?",
        answer:
          "Transfer logic is configured around your practice rules, urgent symptoms, staff-only requests, and patient preference. When a call transfers, the goal is to pass useful context with it.",
      },
      {
        question: "Can it handle medical and vision insurance questions?",
        answer:
          "Acuity can support approved insurance workflows and routing logic, including medical vs. vision distinctions that matter in eye care.",
      },
    ],
  },
  {
    slug: "ophthalmology-answering-service",
    navLabel: "Ophthalmology Answering Service",
    title: "Ophthalmology Answering Service Alternative",
    description:
      "Compare traditional ophthalmology answering services with Acuity, an AI receptionist that answers calls, routes patients, and helps complete scheduling workflows.",
    keywords: [
      "ophthalmology answering service",
      "eye doctor answering service",
      "ophthalmology call answering",
      "answering service alternative",
    ],
    h1: "More than an ophthalmology answering service",
    intro:
      "A traditional answering service can take a message. Acuity is built to move the patient forward while the intent is still live.",
    primaryCta: "Compare your answering service",
    proof: [
      "Answers overflow and after-hours calls",
      "Routes requests by practice rules",
      "Reduces callback backlog",
    ],
    sections: [
      {
        title: "Replace message-taking with action",
        body: "Acuity can answer, identify the request, schedule when configured, answer approved FAQs, or transfer to staff.",
      },
      {
        title: "Reduce next-day callback backlog",
        body: "After-hours and overflow calls do not have to become voicemail piles for the morning team.",
      },
      {
        title: "Handle eye care complexity",
        body: "Ophthalmology calls are not generic. Acuity supports appointment rules, insurance nuance, language needs, and escalation logic.",
      },
      {
        title: "Know what happened on every call",
        body: "Review outcomes, transfers, booked visits, and calls that need follow-up.",
      },
    ],
    workflow: [
      {
        title: "Capture",
        body: "Answer the call and understand the request without sending the patient to voicemail.",
      },
      {
        title: "Act",
        body: "Schedule, answer approved questions, transfer, or create a follow-up path.",
      },
      {
        title: "Summarize",
        body: "Give the practice visibility into the call outcome and next step.",
      },
    ],
    comparison: [
      {
        traditional: "Messages wait for staff to return them later.",
        acuity: "Routine calls can be resolved while the patient is engaged.",
      },
      {
        traditional: "Coverage is separated from scheduling rules.",
        acuity: "Call handling can use practice-specific rules and workflows.",
      },
      {
        traditional: "Operators get limited performance visibility.",
        acuity: "Acuity reports call outcomes, transfers, bookings, and follow-up needs.",
      },
    ],
    faqs: [
      {
        question: "How is Acuity different from a traditional answering service?",
        answer:
          "Acuity is software that can answer, understand intent, follow configured workflows, and report outcomes instead of only taking messages.",
      },
      {
        question: "Can Acuity handle after-hours calls?",
        answer:
          "Yes. Acuity is designed for after-hours and overflow coverage so patient demand does not automatically become voicemail.",
      },
      {
        question: "Does Acuity take messages or book appointments?",
        answer:
          "Both can be configured. The goal is to complete the highest-value action safely: booking, answering, routing, transferring, or capturing a useful follow-up.",
      },
    ],
  },
  {
    slug: "advancedmd-ai-receptionist",
    navLabel: "AdvancedMD AI Receptionist",
    title: "AdvancedMD AI Receptionist Integration",
    description:
      "Acuity is an AI receptionist for AdvancedMD ophthalmology practices, built to answer calls and book appointments through the AdvancedMD workflow.",
    keywords: [
      "AdvancedMD AI receptionist",
      "AdvancedMD receptionist integration",
      "AdvancedMD scheduling AI",
      "AdvancedMD ophthalmology integration",
    ],
    h1: "AI receptionist for AdvancedMD practices",
    intro:
      "If AdvancedMD runs your schedule, Acuity can become the front-door layer that answers patient calls and helps turn them into clean scheduling outcomes.",
    primaryCta: "Book an AdvancedMD demo",
    secondaryCta: { label: "View partner page", href: "/partners/advancedmd" },
    proof: [
      "AdvancedMD stays the source of truth",
      "Official marketplace path",
      "Ophthalmology scheduling logic",
    ],
    sections: [
      {
        title: "AdvancedMD stays the source of truth",
        body: "Acuity is built around your providers, locations, visit types, and scheduling rules.",
      },
      {
        title: "Calls become appointments, not notes",
        body: "When the workflow allows it, Acuity books directly into AdvancedMD instead of handing staff another callback.",
      },
      {
        title: "Built for ophthalmology on AdvancedMD",
        body: "Support the routing details that matter in eye care: insurance, appointment type, urgency, provider, and location.",
      },
      {
        title: "Official marketplace path",
        body: "Acuity is listed as an AdvancedMD Marketplace partner for practices that want an integration-led implementation.",
      },
    ],
    workflow: [
      {
        title: "Read rules",
        body: "Acuity uses your configured AdvancedMD scheduling context and practice rules.",
      },
      {
        title: "Book cleanly",
        body: "Eligible calls can move into a confirmed appointment workflow.",
      },
      {
        title: "Hand off exceptions",
        body: "Staff-only cases transfer with the patient need and call context.",
      },
    ],
    comparison: [
      {
        traditional: "Schedulers manually turn calls into AdvancedMD appointments.",
        acuity: "Acuity can book through the configured AdvancedMD workflow.",
      },
      {
        traditional: "AI tools sit outside the scheduling source of truth.",
        acuity: "Acuity treats AdvancedMD as the scheduling backbone.",
      },
      {
        traditional: "Generic call agents miss eye care routing nuance.",
        acuity: "Acuity is tuned around ophthalmology operations.",
      },
    ],
    faqs: [
      {
        question: "Does Acuity integrate with AdvancedMD?",
        answer:
          "Yes. Acuity has an AdvancedMD-focused implementation path and is listed as an AdvancedMD Marketplace partner.",
      },
      {
        question: "Can Acuity write appointments back into AdvancedMD?",
        answer:
          "Yes, when the practice workflow and scheduling rules are configured for booking.",
      },
      {
        question: "What does implementation require from our team?",
        answer:
          "Acuity reviews providers, locations, appointment types, routing rules, insurance workflows, and go-live preferences with your team.",
      },
    ],
  },
  {
    slug: "after-hours-answering-service-ophthalmology",
    navLabel: "After-Hours Answering",
    title: "After-Hours Answering Service for Ophthalmology",
    description:
      "Acuity helps ophthalmology practices capture after-hours calls, route urgent issues, and reduce voicemail backlog with AI receptionist coverage.",
    keywords: [
      "after-hours answering service ophthalmology",
      "ophthalmology after-hours calls",
      "after-hours eye care answering",
      "ophthalmology voicemail alternative",
    ],
    h1: "After-hours answering for ophthalmology calls",
    intro:
      "Patients call after work, on weekends, and when the front desk is offline. Acuity helps your practice respond without turning every call into tomorrow's voicemail.",
    primaryCta: "Review your after-hours flow",
    proof: [
      "Captures demand outside office hours",
      "Routes urgent calls by rule",
      "Shows overnight outcomes",
    ],
    sections: [
      {
        title: "Capture demand when patients are ready",
        body: "Let patients schedule, ask approved questions, or get routed while they are still on the line.",
      },
      {
        title: "Escalate the right calls",
        body: "Urgent symptoms and exception-heavy requests can be routed to staff based on your rules.",
      },
      {
        title: "Avoid morning voicemail cleanup",
        body: "After-hours coverage should reduce follow-up work, not create a longer callback queue.",
      },
      {
        title: "Measure after-hours performance",
        body: "Track volume, booked visits, transfers, unresolved calls, and patterns by day and hour.",
      },
    ],
    workflow: [
      {
        title: "Answer after hours",
        body: "Patients reach a live conversational receptionist when staff is offline.",
      },
      {
        title: "Apply rules",
        body: "Acuity follows your scheduling, routing, urgent escalation, and transfer policy.",
      },
      {
        title: "Surface follow-up",
        body: "The portal shows what happened overnight and which calls still need staff attention.",
      },
    ],
    comparison: [
      {
        traditional: "After-hours calls become voicemail or message slips.",
        acuity: "Acuity can resolve or route many calls immediately.",
      },
      {
        traditional: "Urgent and routine requests are mixed together.",
        acuity: "Acuity can separate urgent routing from routine requests.",
      },
      {
        traditional: "The morning team starts with an unclear queue.",
        acuity: "Staff sees outcomes and follow-up needs.",
      },
    ],
    faqs: [
      {
        question: "Can Acuity answer calls when the office is closed?",
        answer:
          "Yes. Acuity can be configured for after-hours, weekend, overflow, or full-time call coverage.",
      },
      {
        question: "Can it route urgent symptoms to staff?",
        answer:
          "Yes, based on your escalation policy. Acuity does not replace clinical judgment, but it can route urgent calls instead of burying them in voicemail.",
      },
      {
        question: "Can patients book appointments after hours?",
        answer:
          "Yes, when scheduling workflows and appointment rules are configured for booking.",
      },
    ],
  },
  {
    slug: "medical-answering-service-alternative",
    navLabel: "Medical Answering Alternative",
    title: "Medical Answering Service Alternative for Eye Care",
    description:
      "Acuity gives eye care practices an alternative to generic medical answering services by answering, routing, scheduling, and handing off calls with context.",
    keywords: [
      "medical answering service alternative",
      "AI medical answering service",
      "eye care answering service alternative",
      "medical receptionist AI",
    ],
    h1: "A medical answering service alternative built for eye care",
    intro:
      "Generic medical answering services are built for coverage. Acuity is built for patient access: answering the call, understanding the request, and moving the patient forward.",
    primaryCta: "Book a comparison call",
    proof: [
      "More than message-taking",
      "Eye care operating logic",
      "Human handoff when needed",
    ],
    sections: [
      {
        title: "Do more than collect messages",
        body: "Acuity can handle routine requests, scheduling workflows, approved FAQs, and transfers based on practice rules.",
      },
      {
        title: "Fit ophthalmology operations",
        body: "Eye care calls involve insurance, visit type, location, provider, urgency, language, and patient status. Acuity is built around that complexity.",
      },
      {
        title: "Keep humans in the right place",
        body: "Staff stay involved for clinical judgment, sensitive cases, exceptions, and escalations.",
      },
      {
        title: "Give operators visibility",
        body: "See call outcomes, handoffs, after-hours demand, and follow-up needs in one operational view.",
      },
    ],
    workflow: [
      {
        title: "Understand",
        body: "Acuity captures the patient's request before deciding the next action.",
      },
      {
        title: "Execute",
        body: "Approved workflows can schedule, answer, route, or transfer the call.",
      },
      {
        title: "Escalate",
        body: "Clinical, sensitive, or exception-heavy requests stay with your team.",
      },
    ],
    comparison: [
      {
        traditional: "A generic answering service maximizes coverage.",
        acuity: "Acuity focuses on patient access and completed outcomes.",
      },
      {
        traditional: "Staff still owns most next steps.",
        acuity: "Acuity can complete configured routine work.",
      },
      {
        traditional: "Reporting is limited to messages and call logs.",
        acuity: "Acuity reports outcomes, transfers, unresolved calls, and trends.",
      },
    ],
    faqs: [
      {
        question: "Is Acuity a replacement for a medical answering service?",
        answer:
          "It can replace or reduce parts of answering-service work depending on your call mix, workflow rules, and human escalation needs.",
      },
      {
        question: "Can Acuity handle clinical triage?",
        answer:
          "Acuity can route urgent or clinical-sounding requests according to practice rules, but clinical judgment remains with licensed staff.",
      },
      {
        question: "What happens when a call needs staff?",
        answer:
          "Acuity transfers or captures follow-up context so the team knows why the patient called.",
      },
    ],
  },
  {
    slug: "spanish-ai-receptionist-eye-care",
    navLabel: "Spanish AI Receptionist",
    title: "Spanish AI Receptionist for Eye Care",
    description:
      "Acuity helps eye care practices support Spanish-speaking patients with AI call answering, scheduling workflows, and staff handoffs.",
    keywords: [
      "Spanish AI receptionist eye care",
      "Spanish answering service eye care",
      "bilingual ophthalmology receptionist",
      "Spanish medical receptionist AI",
    ],
    h1: "Spanish AI receptionist for eye care practices",
    intro:
      "Spanish-speaking patients should be able to call, understand their options, and complete the next step without waiting for a bilingual staff member to become available.",
    primaryCta: "Test Spanish call workflows",
    proof: [
      "Spanish patient calls",
      "Same scheduling rules",
      "Context-rich human handoff",
    ],
    sections: [
      {
        title: "Support Spanish patient calls",
        body: "Acuity can answer in Spanish, gather the request, and guide the patient through approved workflows.",
      },
      {
        title: "Keep scheduling consistent",
        body: "Spanish-language calls can follow the same appointment, insurance, location, and escalation rules as English calls.",
      },
      {
        title: "Reduce bilingual bottlenecks",
        body: "Staff can focus on exceptions and in-office needs instead of serving as the only path for every Spanish caller.",
      },
      {
        title: "Hand off with context",
        body: "When a person needs to step in, Acuity can transfer the call with the reason, patient need, and relevant call context.",
      },
    ],
    workflow: [
      {
        title: "Detect",
        body: "Acuity can support Spanish-language conversations in the same front-door call flow.",
      },
      {
        title: "Follow rules",
        body: "Appointment, insurance, office, and escalation rules remain consistent.",
      },
      {
        title: "Transfer cleanly",
        body: "When staff is needed, the handoff includes context instead of starting over.",
      },
    ],
    comparison: [
      {
        traditional: "Spanish callers wait for a bilingual staff member.",
        acuity: "Acuity can start helping in Spanish immediately.",
      },
      {
        traditional: "Language support is separated from scheduling rules.",
        acuity: "Spanish calls follow the same configured workflows.",
      },
      {
        traditional: "Handoffs lose context.",
        acuity: "Staff gets the patient need and transfer reason.",
      },
    ],
    faqs: [
      {
        question: "Can Acuity answer and book in Spanish?",
        answer:
          "Yes, when the practice workflow is configured for Spanish-language call handling and booking.",
      },
      {
        question: "Can it switch between English and Spanish?",
        answer:
          "Acuity can support multilingual call flows, including Spanish conversations and handoffs.",
      },
      {
        question: "Can Spanish calls follow our same scheduling and insurance rules?",
        answer: "Yes. The goal is consistent operations regardless of call language.",
      },
    ],
  },
] as const satisfies readonly SolutionPageContent[];

export type SolutionPageSlug = (typeof solutionPages)[number]["slug"];

export function getSolutionPage(slug: SolutionPageSlug) {
  return solutionPages.find((page) => page.slug === slug);
}
